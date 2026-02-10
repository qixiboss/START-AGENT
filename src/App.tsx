import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectFilter, ProjectList } from "./components/ProjectList";
import { electronApi } from "./services/electronApi";
import type {
  GitRemoteHistoryResult,
  ProjectItem,
  TerminalLaunchRecord,
  ToolType
} from "./types/ipc";

type EditorMode = "note" | "github" | "commit";
const SIDEBAR_COLLAPSE_KEY = "ui.sidebarCollapsed";

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer));
  });

const App = (): JSX.Element => {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [rootPath, setRootPath] = useState<string>("Loading...");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [launchRecords, setLaunchRecords] = useState<TerminalLaunchRecord[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [editingLaunchNoteId, setEditingLaunchNoteId] = useState<string | null>(null);
  const [launchNoteDraft, setLaunchNoteDraft] = useState<string>("");
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editorProject, setEditorProject] = useState<ProjectItem | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [remoteHistory, setRemoteHistory] = useState<GitRemoteHistoryResult | null>(null);
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const scanProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withTimeout(
        electronApi.listProjects(),
        7000,
        "Project scan request timed out. Check Electron main/preload startup."
      );
      setRootPath(result.rootPath);
      if (!result.ok) {
        setProjects([]);
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return;
      }
      setProjects(result.projects);
      setStatus(`Found ${result.projects.length} directories`);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "Unknown scan error";
      setProjects([]);
      setError(`Scan failed: ${message}`);
      setStatus("Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTerminalLaunches = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalLaunches(),
        7000,
        "Timed out while loading Windows PowerShell launches."
      );
      if (!result.ok) {
        setStatus(`Failed to load launches: ${result.message}`);
        return;
      }
      setLaunchRecords(result.launches);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : "Unknown launch list error";
      setStatus(`Failed to load launches: ${message}`);
    }
  }, []);

  useEffect(() => {
    void scanProjects();
    void loadTerminalLaunches();
  }, [loadTerminalLaunches, scanProjects]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTerminalLaunches();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadTerminalLaunches]);

  useEffect(() => {
    if (!editingLaunchNoteId) {
      return;
    }
    if (!launchRecords.some((item) => item.id === editingLaunchNoteId)) {
      setEditingLaunchNoteId(null);
      setLaunchNoteDraft("");
    }
  }, [editingLaunchNoteId, launchRecords]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, isSidebarCollapsed ? "1" : "0");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isSidebarCollapsed]);

  const filteredProjects = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const recentLaunchPaths = new Set(launchRecords.map((item) => item.projectPath));
    return projects.filter((project) => {
      const matchesKeyword =
        keyword.length === 0 ||
        project.name.toLowerCase().includes(keyword) ||
        project.path.toLowerCase().includes(keyword);
      if (!matchesKeyword) {
        return false;
      }
      if (projectFilter === "recent") {
        return recentLaunchPaths.has(project.path);
      }
      return true;
    });
  }, [launchRecords, projectFilter, projects, searchQuery]);

  useEffect(() => {
    if (filteredProjects.length === 0) {
      setSelectedProjectPath(null);
      return;
    }
    if (!selectedProjectPath || !filteredProjects.some((project) => project.path === selectedProjectPath)) {
      setSelectedProjectPath(filteredProjects[0].path);
    }
  }, [filteredProjects, selectedProjectPath]);

  const chooseFolder = useCallback(async () => {
    try {
      setStatus("Waiting for folder selection...");
      const picked = await withTimeout(
        electronApi.pickDirectory(),
        7000,
        "Timed out while opening directory picker."
      );
      if (!picked.ok) {
        if ("cancelled" in picked && picked.cancelled) {
          setStatus("Folder selection cancelled");
          return;
        }
        const message = "message" in picked ? picked.message : "Failed to choose directory.";
        setStatus(message);
        return;
      }
      const result = await withTimeout(
        electronApi.setRootPath(picked.path),
        7000,
        "Timed out while setting project root."
      );
      setRootPath(result.rootPath);
      if (!result.ok) {
        setProjects([]);
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return;
      }
      setError(null);
      setProjects(result.projects);
      setStatus(`Root changed. Found ${result.projects.length} directories`);
    } catch (chooseError) {
      const message = chooseError instanceof Error ? chooseError.message : "Unknown directory selection error";
      setStatus(`Failed to change root: ${message}`);
    }
  }, []);

  const launchTerminal = useCallback(async (project: ProjectItem, tool: ToolType) => {
    try {
      setStatus(`Launching ${tool} in Windows PowerShell for ${project.name}...`);
      const result = await withTimeout(
        electronApi.launchTerminal({ projectPath: project.path, projectName: project.name, tool }),
        7000,
        `Timed out while launching ${tool}.`
      );
      if (!result.ok) {
        setStatus(`Failed to launch ${tool}: ${result.message}`);
        return;
      }
      setLaunchRecords((prev) => [result.record, ...prev.filter((item) => item.id !== result.record.id)]);
      setStatus(`Launched ${project.name} (${tool}) in Windows PowerShell`);
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : "Unknown launch error";
      setStatus(`Failed to launch ${tool}: ${message}`);
    }
  }, []);

  const relaunchRecord = useCallback(async (record: TerminalLaunchRecord) => {
    await launchTerminal(
      {
        name: record.projectName,
        path: record.projectPath
      },
      record.tool
    );
  }, [launchTerminal]);

  const removeLaunchRecord = useCallback(async (recordId: string) => {
    try {
      const result = await electronApi.removeTerminalLaunch(recordId);
      if (!result.ok) {
        setStatus(`Failed to remove launch record: ${result.message}`);
        return;
      }
      setEditingLaunchNoteId(null);
      setLaunchNoteDraft("");
      setLaunchRecords((prev) => prev.filter((item) => item.id !== recordId));
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Unknown remove error";
      setStatus(`Failed to remove launch record: ${message}`);
    }
  }, []);

  const focusLaunchRecord = useCallback(async (recordId: string) => {
    try {
      const result = await electronApi.focusTerminalLaunch(recordId);
      if (!result.ok) {
        setStatus(`Failed to focus launch: ${result.message}`);
        if (result.message.includes("already exited")) {
          setLaunchRecords((prev) => prev.filter((item) => item.id !== recordId));
        }
        return;
      }
      setStatus("Brought PowerShell window to front.");
    } catch (focusError) {
      const message = focusError instanceof Error ? focusError.message : "Unknown focus error";
      setStatus(`Failed to focus launch: ${message}`);
    }
  }, []);

  const startEditLaunchNote = useCallback((record: TerminalLaunchRecord) => {
    setEditingLaunchNoteId(record.id);
    setLaunchNoteDraft(record.note ?? "");
  }, []);

  const cancelEditLaunchNote = useCallback(() => {
    setEditingLaunchNoteId(null);
    setLaunchNoteDraft("");
  }, []);

  const saveLaunchNote = useCallback(async () => {
    if (!editingLaunchNoteId) {
      return;
    }
    try {
      const result = await electronApi.setTerminalLaunchNote(editingLaunchNoteId, launchNoteDraft);
      if (!result.ok) {
        setStatus(`Failed to save launch note: ${result.message}`);
        return;
      }
      setLaunchRecords((prev) =>
        prev.map((item) => (item.id === result.record.id ? result.record : item))
      );
      setStatus("Launch note saved.");
      setEditingLaunchNoteId(null);
      setLaunchNoteDraft("");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unknown save note error";
      setStatus(`Failed to save launch note: ${message}`);
    }
  }, [editingLaunchNoteId, launchNoteDraft]);

  const patchProjectMetaInList = useCallback((projectPath: string, meta: ProjectItem["meta"]) => {
    setProjects((prev) =>
      prev.map((project) => (project.path === projectPath ? { ...project, meta } : project))
    );
  }, []);

  const openEditor = useCallback((mode: EditorMode, project: ProjectItem) => {
    setEditorMode(mode);
    setEditorProject(project);
    setEditorValue(
      mode === "note" ? project.meta?.note ?? "" : mode === "github" ? project.meta?.githubUrl ?? "" : ""
    );
    setRemoteHistory(null);
    if (mode === "commit") {
      void (async () => {
        setRemoteHistoryLoading(true);
        try {
          const result = await electronApi.getRemoteHistory(project.path);
          setRemoteHistory(result);
          if (!result.ok) {
            setStatus(`Remote history failed: ${result.message}`);
          }
        } catch (historyError) {
          const message = historyError instanceof Error ? historyError.message : "Unknown remote history error";
          setRemoteHistory({ ok: false, message });
          setStatus(`Remote history failed: ${message}`);
        } finally {
          setRemoteHistoryLoading(false);
        }
      })();
    }
  }, []);

  const closeEditor = useCallback(() => {
    setEditorMode(null);
    setEditorProject(null);
    setEditorValue("");
    setRemoteHistory(null);
    setRemoteHistoryLoading(false);
  }, []);

  const loadRemoteHistory = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    setRemoteHistoryLoading(true);
    try {
      const result = await electronApi.getRemoteHistory(editorProject.path);
      setRemoteHistory(result);
      if (!result.ok) {
        setStatus(`Remote history failed: ${result.message}`);
      } else {
        setStatus(
          result.isUpToDate
            ? `Remote is up to date (${editorProject.name})`
            : `Remote has different head (${editorProject.name})`
        );
      }
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : "Unknown remote history error";
      setRemoteHistory({ ok: false, message });
      setStatus(`Remote history failed: ${message}`);
    } finally {
      setRemoteHistoryLoading(false);
    }
  }, [editorProject]);

  const submitEditor = useCallback(async () => {
    if (!editorMode || !editorProject) {
      return;
    }
    try {
      if (editorMode === "note") {
        const result = await electronApi.setProjectMeta({
          projectPath: editorProject.path,
          note: editorValue
        });
        if (!result.ok) {
          setStatus(`Failed to save note: ${result.message}`);
          return;
        }
        patchProjectMetaInList(editorProject.path, result.meta);
        setStatus(`Saved note for ${editorProject.name}`);
      } else if (editorMode === "github") {
        const result = await electronApi.setProjectMeta({
          projectPath: editorProject.path,
          githubUrl: editorValue
        });
        if (!result.ok) {
          setStatus(`Failed to save GitHub URL: ${result.message}`);
          return;
        }
        patchProjectMetaInList(editorProject.path, result.meta);
        setStatus(
          result.warning
            ? `Saved URL with warning: ${result.warning}`
            : `Saved GitHub URL for ${editorProject.name}`
        );
      } else {
        const message = editorValue.trim();
        if (!message) {
          setStatus("Commit message is required.");
          return;
        }
        if (remoteHistory?.ok && remoteHistory.isUpToDate && !remoteHistory.hasLocalChanges) {
          setStatus("Already up to date and no local changes. Commit+Push is disabled.");
          return;
        }
        const result = await electronApi.commitAndPush({
          projectPath: editorProject.path,
          message
        });
        if (!result.ok) {
          const errLine =
            result.stderr
              ?.split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line.length > 0) ?? "";
          setStatus(
            `Commit failed at ${result.step}: ${result.message}${errLine ? ` | ${errLine}` : ""}`
          );
          return;
        }
        setStatus(`${result.message} (${editorProject.name})`);
      }
      closeEditor();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unknown action error";
      setStatus(`Action failed: ${message}`);
    }
  }, [closeEditor, editorMode, editorProject, editorValue, patchProjectMetaInList, remoteHistory]);

  const commitBlocked =
    editorMode === "commit" &&
    remoteHistory?.ok &&
    remoteHistory.isUpToDate &&
    !remoteHistory.hasLocalChanges;

  return (
    <main className="app-shell">
      <header className="hero-bar">
        <div>
          <p className="eyebrow">START-AGENT</p>
          <h1>Workspace Command Center</h1>
          <p className="hint">
            {launchRecords.length === 0
              ? "Open Codex or Claude to launch Windows PowerShell sessions."
              : `Recent launches: ${launchRecords.length}`}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-card">
            <span>Projects</span>
            <strong>{projects.length}</strong>
          </div>
          <div className="metric-card">
            <span>Launches</span>
            <strong>{launchRecords.length}</strong>
          </div>
          <div className="metric-card status-card">
            <span>Status</span>
            <strong title={status}>{status}</strong>
          </div>
        </div>
      </header>

      <section className={`workspace-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <section className="panel terminal-stage">
          <header className="panel-header terminal-stage-header">
            <div>
              <h2>Windows PowerShell Stage</h2>
              <p className="hint">External PowerShell windows are launched per action.</p>
            </div>
            <div className="header-actions">
              <button className="btn secondary" onClick={() => void loadTerminalLaunches()}>
                Refresh Launches
              </button>
            </div>
          </header>

          <div className="launch-stage">
            {launchRecords.length === 0 ? (
              <div className="terminal-empty">
                <h3>No Windows PowerShell Launches</h3>
                <p>Choose a project on the right and open Codex or Claude.</p>
              </div>
            ) : (
              <div className="launch-grid">
                {launchRecords.map((record) => (
                  <article
                    className="launch-card clickable"
                    key={record.id}
                    onClick={() => void focusLaunchRecord(record.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void focusLaunchRecord(record.id);
                      }
                    }}
                  >
                    <div className="launch-card-head">
                      <strong>{record.projectName}</strong>
                      <span className="pill tag accent">{record.tool.toUpperCase()}</span>
                    </div>
                    <div className="launch-card-meta">
                      <span>{new Date(record.createdAt).toLocaleString()}</span>
                      <span>{record.projectPath}</span>
                    </div>
                    <pre className="launch-command">{record.command}</pre>
                    {editingLaunchNoteId === record.id ? (
                      <div
                        className="launch-note-editor"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <textarea
                          className="editor-input multiline launch-note-input"
                          value={launchNoteDraft}
                          onChange={(event) => setLaunchNoteDraft(event.target.value)}
                          placeholder="Add context: what this terminal is working on..."
                        />
                        <div className="actions">
                          <button className="btn secondary" onClick={() => void saveLaunchNote()}>
                            Save Note
                          </button>
                          <button className="btn secondary" onClick={cancelEditLaunchNote}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="launch-note-display">
                        <span className="launch-note-label">Note</span>
                        <p>{record.note?.trim() ? record.note : "No note yet."}</p>
                      </div>
                    )}
                    <div className="actions">
                      <button
                        className="btn secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void relaunchRecord(record);
                        }}
                      >
                        Relaunch
                      </button>
                      <button
                        className="btn secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (editingLaunchNoteId === record.id) {
                            void saveLaunchNote();
                            return;
                          }
                          startEditLaunchNote(record);
                        }}
                      >
                        {editingLaunchNoteId === record.id ? "Save" : "Note"}
                      </button>
                      <button
                        className="btn secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeLaunchRecord(record.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`context-rail ${isSidebarCollapsed ? "collapsed" : ""}`}>
          <ProjectList
            collapsed={isSidebarCollapsed}
            rootPath={rootPath}
            projects={filteredProjects}
            loading={loading}
            error={error}
            selectedProjectPath={selectedProjectPath}
            searchQuery={searchQuery}
            filter={projectFilter}
            launchRecords={launchRecords}
            onSelectProject={setSelectedProjectPath}
            onSearchChange={setSearchQuery}
            onFilterChange={setProjectFilter}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
            onChooseFolder={() => void chooseFolder()}
            onRefresh={() => void scanProjects()}
            onLaunch={launchTerminal}
            onEditNote={(project) => openEditor("note", project)}
            onEditGithub={(project) => openEditor("github", project)}
            onCommitPush={(project) => openEditor("commit", project)}
          />
        </section>
      </section>

      {editorMode && editorProject ? (
        <div className="modal-overlay" onClick={closeEditor}>
          <div className="modal-panel small" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>
                  {editorMode === "note"
                    ? "Edit Note"
                    : editorMode === "github"
                      ? "Set GitHub URL"
                      : "Commit Message"}
                </h3>
                <p className="hint">{editorProject.name}</p>
              </div>
              <div className="header-actions">
                {editorMode === "commit" ? (
                  <button
                    className="btn secondary"
                    onClick={() => void loadRemoteHistory()}
                    disabled={remoteHistoryLoading}
                  >
                    {remoteHistoryLoading ? "Loading..." : "View Remote History"}
                  </button>
                ) : null}
                <button className="btn secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={() => void submitEditor()}
                  disabled={remoteHistoryLoading || !!commitBlocked}
                >
                  Save
                </button>
              </div>
            </header>
            <div className="editor-body">
              {editorMode === "note" ? (
                <textarea
                  className="editor-input multiline"
                  value={editorValue}
                  onChange={(event) => setEditorValue(event.target.value)}
                  placeholder="Write note for this project..."
                />
              ) : (
                <input
                  className="editor-input"
                  value={editorValue}
                  onChange={(event) => setEditorValue(event.target.value)}
                  placeholder={
                    editorMode === "github"
                      ? "https://github.com/owner/repo.git"
                      : "feat: update implementation"
                  }
                />
              )}

              {editorMode === "commit" && remoteHistory ? (
                <section className="remote-history">
                  <div className="remote-history-head">
                    {remoteHistory.ok ? (
                      <>
                        <span className={`pill ${remoteHistory.isUpToDate ? "ok" : "warn"}`}>
                          {remoteHistory.isUpToDate ? "Up to date" : "Not synced"}
                        </span>
                        <span className="hint">{remoteHistory.upstreamRef}</span>
                      </>
                    ) : (
                      <span className="pill err">Error</span>
                    )}
                  </div>

                  {remoteHistory.ok ? (
                    <div className="remote-history-list">
                      {remoteHistory.commits.map((commit) => (
                        <article className="remote-history-item" key={commit.hash}>
                          <div className="remote-history-meta">
                            <span>{commit.shortHash}</span>
                            <span>{commit.author}</span>
                            <span>{commit.date}</span>
                          </div>
                          <div>{commit.subject}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="error-box">Failed: {remoteHistory.message}</div>
                  )}
                </section>
              ) : null}

              {editorMode === "commit" && commitBlocked ? (
                <div className="warn-box">
                  Remote and local are already synced, and there are no local changes. Commit+Push is
                  disabled to prevent duplicate push.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default App;
