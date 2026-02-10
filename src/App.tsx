import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { TerminalTabs } from "./components/TerminalTabs";
import { TerminalSessionPane } from "./components/TerminalSessionPane";
import { electronApi } from "./services/electronApi";
import type {
  ConversationEntry,
  GitRemoteHistoryResult,
  ProjectHealthItem,
  ProjectItem,
  TerminalSessionInfo,
  ToolType
} from "./types/ipc";

type TerminalLayoutMode = "tabs" | "vertical" | "horizontal" | "grid";
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
  const [healthItems, setHealthItems] = useState<ProjectHealthItem[]>([]);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthGeneratedAt, setHealthGeneratedAt] = useState<number | null>(null);
  const [rootPath, setRootPath] = useState<string>("Loading...");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<TerminalLayoutMode>("tabs");
  const [conversationProject, setConversationProject] = useState<ProjectItem | null>(null);
  const [conversationRows, setConversationRows] = useState<ConversationEntry[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editorProject, setEditorProject] = useState<ProjectItem | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [remoteHistory, setRemoteHistory] = useState<GitRemoteHistoryResult | null>(null);
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState<boolean>(false);
  const healthRequestIdRef = useRef(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const clearHealthState = useCallback(() => {
    healthRequestIdRef.current += 1;
    setHealthItems([]);
    setHealthLoading(false);
    setHealthError(null);
    setHealthGeneratedAt(null);
  }, []);

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
        clearHealthState();
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return;
      }
      setProjects(result.projects);
      clearHealthState();
      setStatus(`Found ${result.projects.length} directories`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      setProjects([]);
      clearHealthState();
      setError(`Scan failed: ${message}`);
      setStatus("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [clearHealthState]);

  useEffect(() => {
    void scanProjects();
  }, [scanProjects]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, isSidebarCollapsed ? "1" : "0");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isSidebarCollapsed]);

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
        clearHealthState();
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return;
      }
      setError(null);
      setProjects(result.projects);
      clearHealthState();
      setStatus(`Root changed. Found ${result.projects.length} directories`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown directory selection error";
      setStatus(`Failed to change root: ${message}`);
    }
  }, [clearHealthState]);

  const refreshProjectHealth = useCallback(async () => {
    if (projects.length === 0) {
      setHealthItems([]);
      setHealthLoading(false);
      setHealthError(null);
      setHealthGeneratedAt(null);
      setStatus("No projects available for health scan.");
      return;
    }

    const requestId = healthRequestIdRef.current + 1;
    healthRequestIdRef.current = requestId;
    setHealthLoading(true);
    setHealthError(null);
    setStatus(`Checking health for ${projects.length} projects...`);

    try {
      const result = await withTimeout(
        electronApi.getProjectHealth({
          projectPaths: projects.map((project) => project.path),
          includeBuildCheck: true
        }),
        180000,
        "Project health scan timed out."
      );
      if (healthRequestIdRef.current !== requestId) {
        return;
      }
      setHealthGeneratedAt(result.generatedAt);
      setHealthItems(result.items);
      if (!result.ok) {
        setHealthError(result.message);
        setStatus(`Health scan failed: ${result.message}`);
        return;
      }
      setStatus(`Health scan complete (${result.items.length} projects).`);
    } catch (error) {
      if (healthRequestIdRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown health scan error";
      setHealthError(message);
      setStatus(`Health scan failed: ${message}`);
    } finally {
      if (healthRequestIdRef.current === requestId) {
        setHealthLoading(false);
      }
    }
  }, [projects]);

  const launchTerminal = useCallback(async (project: ProjectItem, tool: ToolType) => {
    try {
      setStatus(`Opening ${tool} for ${project.name}...`);
      const result = await withTimeout(
        electronApi.createTerminal({ projectPath: project.path, tool }),
        7000,
        `Timed out while creating ${tool} terminal session.`
      );
      if (!result.ok) {
        setStatus(`Failed to launch ${tool}: ${result.message}`);
        return;
      }
      setSessions((prev) => [...prev, result.session]);
      setActiveSessionId(result.session.id);
      setStatus(`Opened ${result.session.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown launch error";
      setStatus(`Failed to launch ${tool}: ${message}`);
    }
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    electronApi.closeTerminal(sessionId);
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== sessionId);
      setActiveSessionId((active) => {
        if (active !== sessionId) {
          return active;
        }
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      return next;
    });
  }, []);

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
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown remote history error";
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown remote history error";
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown action error";
      setStatus(`Action failed: ${message}`);
    }
  }, [closeEditor, editorMode, editorProject, editorValue, patchProjectMetaInList, remoteHistory]);

  const openConversation = useCallback(async (project: ProjectItem) => {
    try {
      const rows = await electronApi.listConversation(project.path);
      setConversationProject(project);
      setConversationRows(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown conversation read error";
      setStatus(`Failed to load conversation: ${message}`);
    }
  }, []);

  const clearConversation = useCallback(async () => {
    if (!conversationProject) {
      return;
    }
    try {
      await electronApi.clearConversation(conversationProject.path);
      setConversationRows([]);
      setStatus(`Cleared conversation logs for ${conversationProject.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown clear error";
      setStatus(`Failed to clear conversation: ${message}`);
    }
  }, [conversationProject]);

  const emptyTerminal = useMemo(
    () => (
      <div className="terminal-empty">
        <h3>No Terminal Session</h3>
        <p>Choose a project, then click Open Codex or Open Claude to start.</p>
      </div>
    ),
    []
  );

  const commitBlocked =
    editorMode === "commit" &&
    remoteHistory?.ok &&
    remoteHistory.isUpToDate &&
    !remoteHistory.hasLocalChanges;

  return (
    <main className={`layout ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <ProjectList
        collapsed={isSidebarCollapsed}
        rootPath={rootPath}
        projects={projects}
        loading={loading}
        error={error}
        healthItems={healthItems}
        healthLoading={healthLoading}
        healthError={healthError}
        healthGeneratedAt={healthGeneratedAt}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onChooseFolder={() => void chooseFolder()}
        onRefresh={() => void scanProjects()}
        onRefreshHealth={() => void refreshProjectHealth()}
        onLaunch={launchTerminal}
        onEditNote={(project) => openEditor("note", project)}
        onEditGithub={(project) => openEditor("github", project)}
        onCommitPush={(project) => openEditor("commit", project)}
        onViewConversation={(project) => void openConversation(project)}
      />

      <section className="panel terminal-panel">
        <header className="panel-header">
          <div>
            <h2>Embedded Terminal</h2>
            <p className="hint">{status}</p>
          </div>
          <div className="header-actions">
            <button
              className={`btn secondary ${layoutMode === "tabs" ? "selected" : ""}`}
              onClick={() => setLayoutMode("tabs")}
            >
              Tabs
            </button>
            <button
              className={`btn secondary ${layoutMode === "vertical" ? "selected" : ""}`}
              onClick={() => setLayoutMode("vertical")}
            >
              Vertical
            </button>
            <button
              className={`btn secondary ${layoutMode === "horizontal" ? "selected" : ""}`}
              onClick={() => setLayoutMode("horizontal")}
            >
              Horizontal
            </button>
            <button
              className={`btn secondary ${layoutMode === "grid" ? "selected" : ""}`}
              onClick={() => setLayoutMode("grid")}
            >
              Grid
            </button>
          </div>
        </header>

        <TerminalTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onClose={closeSession}
        />

        <div className={`terminal-area mode-${layoutMode}`}>
          {sessions.length === 0
            ? emptyTerminal
            : sessions.map((session) => (
                <TerminalSessionPane
                  key={session.id}
                  sessionId={session.id}
                  active={activeSessionId === session.id}
                  hidden={layoutMode === "tabs" && activeSessionId !== session.id}
                  title={session.title}
                  showHeader={layoutMode !== "tabs"}
                  onActivate={() => setActiveSessionId(session.id)}
                  onClose={() => closeSession(session.id)}
                />
              ))}
        </div>
      </section>

      {conversationProject ? (
        <div className="modal-overlay" onClick={() => setConversationProject(null)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>Conversation Inputs</h3>
                <p className="hint">{conversationProject.name}</p>
              </div>
              <div className="header-actions">
                <button className="btn secondary" onClick={() => void clearConversation()}>
                  Clear
                </button>
                <button className="btn secondary" onClick={() => setConversationProject(null)}>
                  Close
                </button>
              </div>
            </header>
            <div className="conversation-list">
              {conversationRows.length === 0 ? (
                <div className="empty">No captured input lines yet.</div>
              ) : (
                conversationRows.map((row) => (
                  <article className="conversation-item" key={row.id}>
                    <div className="conversation-meta">
                      <span>{new Date(row.createdAt).toLocaleString()}</span>
                      <span>{row.tool}</span>
                    </div>
                    <pre>{row.input}</pre>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

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
