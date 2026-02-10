import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { TerminalTabs } from "./components/TerminalTabs";
import { TerminalSessionPane } from "./components/TerminalSessionPane";
import { electronApi } from "./services/electronApi";
import type { ConversationEntry, ProjectItem, TerminalSessionInfo, ToolType } from "./types/ipc";

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      setProjects([]);
      setError(`Scan failed: ${message}`);
      setStatus("Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

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
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return;
      }
      setError(null);
      setProjects(result.projects);
      setStatus(`Root changed. Found ${result.projects.length} directories`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown directory selection error";
      setStatus(`Failed to change root: ${message}`);
    }
  }, []);

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
  }, []);

  const closeEditor = useCallback(() => {
    setEditorMode(null);
    setEditorProject(null);
    setEditorValue("");
  }, []);

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
        const result = await electronApi.commitAndPush({
          projectPath: editorProject.path,
          message
        });
        if (!result.ok) {
          setStatus(`Commit failed at ${result.step}: ${result.message}`);
          return;
        }
        setStatus(`Commit+push completed for ${editorProject.name}`);
      }
      closeEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown action error";
      setStatus(`Action failed: ${message}`);
    }
  }, [closeEditor, editorMode, editorProject, editorValue, patchProjectMetaInList]);

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

  return (
    <main className={`layout ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <ProjectList
        collapsed={isSidebarCollapsed}
        rootPath={rootPath}
        projects={projects}
        loading={loading}
        error={error}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onChooseFolder={() => void chooseFolder()}
        onRefresh={() => void scanProjects()}
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
                <button className="btn secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => void submitEditor()}>
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
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default App;
