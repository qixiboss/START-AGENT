import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectFilter, ProjectList } from "./components/ProjectList";
import TitleBar from "./components/TitleBar";
import EmbeddedTerminal, { type EmbeddedTerminalHandle } from "./components/EmbeddedTerminal";
import { electronApi } from "./services/electronApi";
import type {
  TerminalApprovalRequest,
  TerminalSessionInputState,
  TerminalSessionInputStateValue,
  GitBranchesResult,
  GitUntrackedFilesResult,
  GitRemoteHistoryResult,
  ProjectItem,
  TerminalLaunchRecord,
  TerminalSessionInfo,
  TerminalSessionSnapshot,
  ToolType
} from "./types/ipc";

type EditorMode = "note" | "github" | "commit";
const SIDEBAR_COLLAPSE_KEY = "ui.sidebarCollapsed";
const EXTERNAL_TERMINAL_KEY = "ui.useExternalTerminal";
const TERMINAL_OUTPUT_MAX_CHARS = 200000;
const TERMINAL_OUTPUT_TRIM_BATCH = 50000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer));
  });

const appendTerminalOutput = (prev: string, next: string): string => {
  const merged = `${prev}${next}`;
  if (merged.length <= TERMINAL_OUTPUT_MAX_CHARS + TERMINAL_OUTPUT_TRIM_BATCH) {
    return merged;
  }
  return merged.slice(-TERMINAL_OUTPUT_MAX_CHARS);
};

const sanitizeTerminalChunk = (text: string): string => {
  return text.replace(/\u0000/g, "");
};

const sessionStatusPillClass = (status: TerminalSessionInfo["status"]): string => {
  if (status === "running") {
    return "ok";
  }
  if (status === "starting") {
    return "warn";
  }
  if (status === "error") {
    return "err";
  }
  return "tag";
};

const inputStateLabel = (state: TerminalSessionInputStateValue): string => {
  if (state === "sending") {
    return "Input...";
  }
  if (state === "blocked") {
    return "Blocked";
  }
  if (state === "error") {
    return "Input Error";
  }
  return "Idle";
};

type GitWorkflowAction = "add" | "pull" | "refresh" | "publish" | null;

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
  const [gitBranches, setGitBranches] = useState<GitBranchesResult | null>(null);
  const [gitUntrackedFiles, setGitUntrackedFiles] = useState<GitUntrackedFilesResult | null>(null);
  const [gitAddMode, setGitAddMode] = useState<"all" | "selected_new">("all");
  const [selectedNewFiles, setSelectedNewFiles] = useState<string[]>([]);
  const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>("");
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState<boolean>(false);
  const [gitWorkflowAction, setGitWorkflowAction] = useState<GitWorkflowAction>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [terminalSnapshots, setTerminalSnapshots] = useState<TerminalSessionSnapshot[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [terminalOutputBySession, setTerminalOutputBySession] = useState<Record<string, string>>({});
  const [approvalBySession, setApprovalBySession] = useState<Record<string, TerminalApprovalRequest>>({});
  const [inputStateBySession, setInputStateBySession] = useState<Record<string, TerminalSessionInputState>>({});
  const terminalHandleRef = useRef<EmbeddedTerminalHandle | null>(null);
  const [useExternalTerminal, setUseExternalTerminal] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(EXTERNAL_TERMINAL_KEY) === "1";
    } catch {
      return false;
    }
  });
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

  const loadTerminalSessions = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalSessions(),
        7000,
        "Timed out while loading terminal sessions."
      );
      if (!result.ok) {
        setStatus(`Failed to load sessions: ${result.message}`);
        return;
      }
      setTerminalSessions(result.sessions);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : "Unknown session list error";
      setStatus(`Failed to load sessions: ${message}`);
    }
  }, []);

  const loadTerminalSnapshots = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalSessionSnapshots(),
        7000,
        "Timed out while loading terminal snapshots."
      );
      if (!result.ok) {
        setStatus(`Failed to load session snapshots: ${result.message}`);
        return;
      }
      setTerminalSnapshots(result.snapshots);
    } catch (snapshotError) {
      const message =
        snapshotError instanceof Error ? snapshotError.message : "Unknown terminal snapshot error";
      setStatus(`Failed to load session snapshots: ${message}`);
    }
  }, []);

  useEffect(() => {
    void scanProjects();
    void loadTerminalLaunches();
    void loadTerminalSessions();
    void loadTerminalSnapshots();
  }, [loadTerminalLaunches, loadTerminalSessions, loadTerminalSnapshots, scanProjects]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTerminalLaunches();
      void loadTerminalSnapshots();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadTerminalLaunches, loadTerminalSnapshots]);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(EXTERNAL_TERMINAL_KEY, useExternalTerminal ? "1" : "0");
    } catch {
      // Ignore localStorage failures.
    }
  }, [useExternalTerminal]);

  useEffect(() => {
    const offOutput = electronApi.onTerminalSessionOutput((chunk) => {
      const normalized = sanitizeTerminalChunk(chunk.data);
      if (!normalized) {
        return;
      }
      setTerminalOutputBySession((prev) => ({
        ...prev,
        [chunk.sessionId]: appendTerminalOutput(prev[chunk.sessionId] ?? "", normalized)
      }));
    });
    const offStatus = electronApi.onTerminalSessionStatus((event) => {
      setTerminalSessions((prev) =>
        prev.map((session) =>
          session.id === event.sessionId ? { ...session, status: event.status } : session
        )
      );
      if (event.message) {
        setStatus(event.message);
      }
      if (event.status === "exited" || event.status === "error") {
        void loadTerminalSessions();
        void loadTerminalSnapshots();
      }
    });
    const offApproval = electronApi.onTerminalApprovalRequired((event) => {
      setApprovalBySession((prev) => ({ ...prev, [event.sessionId]: event }));
      setStatus(`Approval required for command in session ${event.sessionId.slice(0, 8)}`);
    });
    const offInputState = electronApi.onTerminalSessionInputState((event) => {
      setInputStateBySession((prev) => ({ ...prev, [event.sessionId]: event }));
    });
    return () => {
      offOutput();
      offStatus();
      offApproval();
      offInputState();
    };
  }, [loadTerminalSessions, loadTerminalSnapshots]);

  useEffect(() => {
    if (terminalSessions.length === 0) {
      setActiveSessionId(null);
      return;
    }
    if (!activeSessionId || !terminalSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(terminalSessions[0].id);
    }
  }, [activeSessionId, terminalSessions]);

  useEffect(() => {
    const alive = new Set(terminalSessions.map((session) => session.id));
    setTerminalOutputBySession((prev) => {
      const next: Record<string, string> = {};
      for (const [sessionId, output] of Object.entries(prev)) {
        if (alive.has(sessionId)) {
          next[sessionId] = output;
        }
      }
      return next;
    });
    setApprovalBySession((prev) => {
      const next: Record<string, TerminalApprovalRequest> = {};
      for (const [sessionId, pending] of Object.entries(prev)) {
        if (alive.has(sessionId)) {
          next[sessionId] = pending;
        }
      }
      return next;
    });
    setInputStateBySession((prev) => {
      const next: Record<string, TerminalSessionInputState> = {};
      for (const [sessionId, inputState] of Object.entries(prev)) {
        if (alive.has(sessionId)) {
          next[sessionId] = inputState;
        }
      }
      return next;
    });
  }, [terminalSessions]);

  const filteredProjects = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const recentLaunchPaths = new Set<string>();
    for (const item of launchRecords) {
      recentLaunchPaths.add(item.projectPath);
    }
    for (const session of terminalSessions) {
      recentLaunchPaths.add(session.projectPath);
    }
    for (const snapshot of terminalSnapshots) {
      recentLaunchPaths.add(snapshot.projectPath);
    }
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
  }, [launchRecords, projectFilter, projects, searchQuery, terminalSessions, terminalSnapshots]);

  const selectedProject = useMemo(
    () => filteredProjects.find((project) => project.path === selectedProjectPath) ?? null,
    [filteredProjects, selectedProjectPath]
  );

  const activeSession = useMemo(
    () => terminalSessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, terminalSessions]
  );

  const activeInputState = useMemo<TerminalSessionInputState>(() => {
    if (!activeSessionId) {
      return {
        sessionId: "",
        state: "idle",
        queueLength: 0,
        timestamp: Date.now()
      };
    }
    return (
      inputStateBySession[activeSessionId] ?? {
        sessionId: activeSessionId,
        state: "idle",
        queueLength: 0,
        timestamp: Date.now()
      }
    );
  }, [activeSessionId, inputStateBySession]);

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

  const createEmbeddedSession = useCallback(
    async (project: ProjectItem, tool: "codex" | "claude" | "shell") => {
      try {
        setStatus(`Starting ${tool} session for ${project.name}...`);
        const result = await withTimeout(
          electronApi.createTerminalSession({
            projectPath: project.path,
            projectName: project.name,
            tool
          }),
          7000,
          `Timed out while creating ${tool} session.`
        );
        if (!result.ok) {
          setStatus(`Failed to create session: ${result.message}`);
          return;
        }
        setTerminalSessions((prev) => [result.session, ...prev.filter((item) => item.id !== result.session.id)]);
        setActiveSessionId(result.session.id);
        setTerminalOutputBySession((prev) => ({ ...prev, [result.session.id]: prev[result.session.id] ?? "" }));
        setStatus(`Started ${tool} session for ${project.name}`);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : "Unknown create session error";
        setStatus(`Failed to create session: ${message}`);
      }
    },
    []
  );

  const sendTerminalData = useCallback(
    (data: string) => {
      if (!activeSessionId) {
        return;
      }
      void electronApi.inputTerminalSession(activeSessionId, data).then((result) => {
        if (!result.ok && result.code !== "APPROVAL_REQUIRED") {
          setStatus(`Failed to send terminal input: ${result.message}`);
        }
      });
    },
    [activeSessionId]
  );

  const scrollActiveTerminalToBottom = useCallback(() => {
    terminalHandleRef.current?.scrollToBottom();
    terminalHandleRef.current?.focus();
  }, []);

  const closeEmbeddedSession = useCallback(async (sessionId: string) => {
    try {
      const result = await electronApi.closeTerminalSession(sessionId, true);
      if (!result.ok) {
        setStatus(`Failed to close session: ${result.message}`);
        return;
      }
      setTerminalSessions((prev) => prev.filter((session) => session.id !== sessionId));
      setTerminalOutputBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setApprovalBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setInputStateBySession((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setStatus("Session closed.");
      void loadTerminalSessions();
      void loadTerminalSnapshots();
    } catch (closeError) {
      const message = closeError instanceof Error ? closeError.message : "Unknown close session error";
      setStatus(`Failed to close session: ${message}`);
    }
  }, [loadTerminalSessions, loadTerminalSnapshots]);

  const submitApproval = useCallback(
    async (sessionId: string, decision: "allow_once" | "allow_session" | "deny") => {
      const request = approvalBySession[sessionId];
      if (!request) {
        return;
      }
      try {
        const result = await electronApi.submitTerminalApproval(sessionId, request.requestId, decision);
        if (!result.ok) {
          setStatus(`Approval action failed: ${result.message}`);
          return;
        }
        setApprovalBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setStatus(`Approval submitted: ${decision}`);
      } catch (approvalError) {
        const message = approvalError instanceof Error ? approvalError.message : "Unknown approval error";
        setStatus(`Approval action failed: ${message}`);
      }
    },
    [approvalBySession]
  );

  const resizeEmbeddedSession = useCallback(
    async (sessionId: string, cols: number, rows: number) => {
      const result = await electronApi.resizeTerminalSession(sessionId, cols, rows);
      if (!result.ok) {
        setStatus(`Failed to resize terminal: ${result.message}`);
      }
    },
    []
  );

  const launchTerminal = useCallback(async (project: ProjectItem, tool: ToolType) => {
    if (!useExternalTerminal) {
      await createEmbeddedSession(project, tool);
      return;
    }
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
  }, [createEmbeddedSession, useExternalTerminal]);

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

  const loadCommitContext = useCallback(
    async (project: ProjectItem, showSuccessStatus: boolean) => {
      setRemoteHistoryLoading(true);
      try {
        const [historyResult, branchesResult, untrackedResult] = await Promise.all([
          electronApi.getRemoteHistory(project.path),
          electronApi.listGitBranches(project.path),
          electronApi.listGitUntrackedFiles(project.path)
        ]);
        setRemoteHistory(historyResult);
        setGitBranches(branchesResult);
        setGitUntrackedFiles(untrackedResult);
        if (branchesResult.ok) {
          setSelectedRemoteBranch((prev) =>
            prev.trim().length > 0 ? prev : branchesResult.currentBranch || branchesResult.branches[0] || ""
          );
        }
        if (untrackedResult.ok) {
          setSelectedNewFiles((prev) => prev.filter((item) => untrackedResult.files.includes(item)));
        }

        if (!historyResult.ok) {
          setStatus(`Remote history failed: ${historyResult.message}`);
        } else if (!branchesResult.ok) {
          setStatus(`Branch list failed: ${branchesResult.message}`);
        } else if (!untrackedResult.ok) {
          setStatus(`Untracked files failed: ${untrackedResult.message}`);
        } else if (showSuccessStatus) {
          setStatus(`Git context refreshed for ${project.name}`);
        }
      } catch (historyError) {
        const message = historyError instanceof Error ? historyError.message : "Unknown git context error";
        setRemoteHistory({ ok: false, message });
        setGitBranches({ ok: false, message, currentBranch: "", branches: [] });
        setGitUntrackedFiles({ ok: false, message, files: [] });
        setStatus(`Git context failed: ${message}`);
      } finally {
        setRemoteHistoryLoading(false);
      }
    },
    []
  );

  const openEditor = useCallback((mode: EditorMode, project: ProjectItem) => {
    setEditorMode(mode);
    setEditorProject(project);
    setEditorValue(
      mode === "note" ? project.meta?.note ?? "" : mode === "github" ? project.meta?.githubUrl ?? "" : ""
    );
    setRemoteHistory(null);
    setGitBranches(null);
    setGitUntrackedFiles(null);
    setGitAddMode("all");
    setSelectedNewFiles([]);
    setSelectedRemoteBranch("");
    setGitWorkflowAction(null);
    if (mode === "commit") {
      void loadCommitContext(project, false);
    }
  }, [loadCommitContext]);

  const closeEditor = useCallback(() => {
    setEditorMode(null);
    setEditorProject(null);
    setEditorValue("");
    setRemoteHistory(null);
    setGitBranches(null);
    setGitUntrackedFiles(null);
    setGitAddMode("all");
    setSelectedNewFiles([]);
    setSelectedRemoteBranch("");
    setRemoteHistoryLoading(false);
    setGitWorkflowAction(null);
  }, []);

  const loadRemoteHistory = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    setGitWorkflowAction("refresh");
    setStatus(`Refreshing git context for ${editorProject.name}...`);
    try {
      await loadCommitContext(editorProject, true);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, loadCommitContext]);

  const runGitAdd = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    if (gitAddMode === "selected_new" && selectedNewFiles.length === 0) {
      setStatus("Please select at least one new file before Git Add.");
      return;
    }
    setGitWorkflowAction("add");
    setStatus(
      gitAddMode === "all"
        ? `Running git add . for ${editorProject.name}...`
        : `Running git add for ${selectedNewFiles.length} selected file(s)...`
    );
    try {
      const result = await electronApi.gitAdd({
        projectPath: editorProject.path,
        mode: gitAddMode,
        files: gitAddMode === "selected_new" ? selectedNewFiles : undefined
      });
      if (!result.ok) {
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(`Git Add failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
        return;
      }
      setStatus(`Git Add success: ${result.message}`);
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git add error";
      setStatus(`Git Add failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, gitAddMode, loadCommitContext, selectedNewFiles]);

  const runGitPull = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    const remoteBranch = selectedRemoteBranch.trim();
    if (!remoteBranch) {
      setStatus("Please select a remote branch before Git Pull.");
      return;
    }
    setGitWorkflowAction("pull");
    setStatus(`Running git pull origin ${remoteBranch} for ${editorProject.name}...`);
    try {
      const result = await electronApi.gitPull({
        projectPath: editorProject.path,
        remoteBranch
      });
      if (!result.ok) {
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(`Git Pull failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
        return;
      }
      setStatus(`Git Pull success: ${result.message}`);
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git pull error";
      setStatus(`Git Pull failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, loadCommitContext, selectedRemoteBranch]);

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
        const remoteBranch = selectedRemoteBranch.trim();
        if (!remoteBranch) {
          setStatus("Please select a remote branch.");
          return;
        }
        setGitWorkflowAction("publish");
        setStatus(`Running git commit and git push for ${editorProject.name}...`);
        const result = await electronApi.commitAndPush({
          projectPath: editorProject.path,
          message,
          remoteBranch
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
    } finally {
      setGitWorkflowAction(null);
    }
  }, [closeEditor, editorMode, editorProject, editorValue, patchProjectMetaInList, selectedRemoteBranch]);

  const gitWorkflowBusy = gitWorkflowAction !== null;
  const isAdding = gitWorkflowAction === "add";
  const isPulling = gitWorkflowAction === "pull";
  const isRefreshingGit = gitWorkflowAction === "refresh";
  const isPublishing = gitWorkflowAction === "publish";

  return (
    <main className="app-shell">
      <TitleBar />
      <header className="hero-bar">
        <div>
          <p className="eyebrow">START-AGENT</p>
          <h1>Workspace Command Center</h1>
          <p className="hint">
            {useExternalTerminal
              ? launchRecords.length === 0
                ? "Open Codex or Claude to launch Windows PowerShell sessions."
                : `Recent external launches: ${launchRecords.length}`
              : terminalSessions.length === 0
                ? "Open Codex / Claude / Shell to start embedded sessions."
                : `Active embedded sessions: ${terminalSessions.length}`}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-card">
            <span>Projects</span>
            <strong>{projects.length}</strong>
          </div>
          <div className="metric-card">
            <span>{useExternalTerminal ? "Launches" : "Sessions"}</span>
            <strong>{useExternalTerminal ? launchRecords.length : terminalSessions.length}</strong>
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
              <h2>{useExternalTerminal ? "Windows PowerShell Stage" : "Embedded Session Stage"}</h2>
              <p className="hint">
                {useExternalTerminal
                  ? "External PowerShell windows are launched per action."
                  : "Run Codex / Claude / Shell directly in this workspace."}
              </p>
            </div>
            <div className="header-actions">
              <button
                className="btn secondary"
                onClick={() => setUseExternalTerminal((prev) => !prev)}
              >
                {useExternalTerminal ? "Switch to Embedded" : "Switch to External"}
              </button>
              {useExternalTerminal ? (
                <button className="btn secondary" onClick={() => void loadTerminalLaunches()}>
                  Refresh Launches
                </button>
              ) : (
                <>
                  <button className="btn secondary" onClick={() => void loadTerminalSessions()}>
                    Refresh Sessions
                  </button>
                  {selectedProject ? (
                    <button
                      className="btn secondary"
                      onClick={() => void createEmbeddedSession(selectedProject, "shell")}
                    >
                      Open Shell
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </header>

          <div className="launch-stage">
            {useExternalTerminal ? (
              launchRecords.length === 0 ? (
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
              )
            ) : (
              <div className="embedded-terminal">
                <div className="session-tabs">
                  {terminalSessions.length === 0 ? (
                    <span className="hint">No active embedded sessions.</span>
                  ) : (
                    terminalSessions.map((session) => (
                      <button
                        key={session.id}
                        className={`session-tab ${activeSessionId === session.id ? "active" : ""}`}
                        onClick={() => setActiveSessionId(session.id)}
                      >
                        <span>{session.projectName} - {session.tool}</span>
                        <span className={`pill ${sessionStatusPillClass(session.status)}`}>
                          {session.status}
                        </span>
                        <span
                          className="session-tab-close"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void closeEmbeddedSession(session.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void closeEmbeddedSession(session.id);
                            }
                          }}
                        >
                          x
                        </span>
                      </button>
                    ))
                  )}
                </div>

                {activeSession ? (
                  <>
                    <div className="terminal-toolbar">
                      <div className="terminal-toolbar-left">
                        <strong>{activeSession.projectName} - {activeSession.tool}</strong>
                        <span className={`pill ${sessionStatusPillClass(activeSession.status)}`}>
                          {activeSession.status}
                        </span>
                        <span className={`terminal-input-state state-${activeInputState.state}`}>
                          {inputStateLabel(activeInputState.state)}
                          {activeInputState.queueLength > 0 ? ` (${activeInputState.queueLength})` : ""}
                        </span>
                      </div>
                      <div className="terminal-toolbar-actions">
                        <button className="btn secondary tiny" onClick={scrollActiveTerminalToBottom}>
                          Bottom
                        </button>
                      </div>
                    </div>

                    {approvalBySession[activeSession.id] ? (
                      <div className="approval-banner">
                        <div>
                          <strong>Approval required</strong>
                          <p>{approvalBySession[activeSession.id].command}</p>
                        </div>
                        <div className="actions">
                          <button
                            className="btn secondary"
                            onClick={() => void submitApproval(activeSession.id, "allow_once")}
                          >
                            Allow Once
                          </button>
                          <button
                            className="btn secondary"
                            onClick={() => void submitApproval(activeSession.id, "allow_session")}
                          >
                            Allow Session
                          </button>
                          <button
                            className="btn secondary"
                            onClick={() => void submitApproval(activeSession.id, "deny")}
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {(activeInputState.state === "blocked" || activeInputState.state === "error") &&
                    !approvalBySession[activeSession.id] ? (
                      <div className={`input-state-banner state-${activeInputState.state}`}>
                        <strong>{inputStateLabel(activeInputState.state)}</strong>
                        {activeInputState.message ? <p>{activeInputState.message}</p> : null}
                      </div>
                    ) : null}

                    <EmbeddedTerminal
                      ref={terminalHandleRef}
                      sessionId={activeSession.id}
                      content={terminalOutputBySession[activeSession.id] || ""}
                      inputState={activeInputState.state}
                      onData={sendTerminalData}
                      onResize={(cols, rows) => {
                        void resizeEmbeddedSession(activeSession.id, cols, rows);
                      }}
                    />
                  </>
                ) : (
                  <div className="terminal-empty">
                    <h3>No Active Session</h3>
                    <p>Open Codex / Claude from project actions, or open a Shell session.</p>
                    {terminalSnapshots.length > 0 ? (
                      <div className="session-snapshot-list">
                        {terminalSnapshots.slice(0, 5).map((snapshot) => (
                          <article key={snapshot.id} className="session-snapshot-item">
                            <strong>{snapshot.title}</strong>
                            <span>{new Date(snapshot.updatedAt).toLocaleString()}</span>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
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
                      : "Git Publish Flow"}
                </h3>
                <p className="hint">{editorProject.name}</p>
              </div>
              <div className="header-actions">
                {editorMode === "commit" ? (
                  <>
                    <button
                      className={`btn git-action-btn ${isPulling ? "primary" : "secondary"}`}
                      onClick={() => void runGitPull()}
                      disabled={remoteHistoryLoading || gitWorkflowBusy}
                    >
                      {isPulling ? "Pulling..." : "Git Pull"}
                    </button>
                    <button
                      className={`btn git-action-btn ${isRefreshingGit ? "primary" : "secondary"}`}
                      onClick={() => void loadRemoteHistory()}
                      disabled={remoteHistoryLoading || gitWorkflowBusy}
                    >
                      {remoteHistoryLoading || isRefreshingGit ? "Refreshing..." : "Refresh Git Data"}
                    </button>
                  </>
                ) : null}
                <button className="btn secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  className="btn primary git-action-btn publish-btn"
                  onClick={() => void submitEditor()}
                  disabled={remoteHistoryLoading || gitWorkflowBusy}
                >
                  {isPublishing
                    ? "Publishing..."
                    : editorMode === "commit"
                      ? "Publish"
                      : "Save"}
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
              ) : editorMode === "github" ? (
                <input
                  className="editor-input"
                  value={editorValue}
                  onChange={(event) => setEditorValue(event.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                />
              ) : (
                <>
                  <section className="git-add-panel">
                    <div className="git-add-head">
                      <strong>Git Add</strong>
                      <div className="git-add-mode">
                        <button
                          className={`btn tiny ${gitAddMode === "all" ? "selected" : "secondary"}`}
                          onClick={() => setGitAddMode("all")}
                          type="button"
                        >
                          git add .
                        </button>
                        <button
                          className={`btn tiny ${gitAddMode === "selected_new" ? "selected" : "secondary"}`}
                          onClick={() => setGitAddMode("selected_new")}
                          type="button"
                        >
                          Select New Files
                        </button>
                        <button
                          className={`btn tiny git-action-btn ${isAdding ? "primary" : "secondary"}`}
                          onClick={() => void runGitAdd()}
                          disabled={remoteHistoryLoading || gitWorkflowBusy}
                          type="button"
                        >
                          {isAdding ? "Adding..." : "Run Git Add"}
                        </button>
                      </div>
                    </div>
                    {gitAddMode === "selected_new" ? (
                      <div className="git-file-list">
                        {gitUntrackedFiles?.ok && gitUntrackedFiles.files.length > 0 ? (
                          gitUntrackedFiles.files.map((file) => (
                            <label key={file} className="git-file-item">
                              <input
                                type="checkbox"
                                checked={selectedNewFiles.includes(file)}
                                onChange={(event) => {
                                  setSelectedNewFiles((prev) =>
                                    event.target.checked
                                      ? Array.from(new Set([...prev, file]))
                                      : prev.filter((item) => item !== file)
                                  );
                                }}
                              />
                              <span>{file}</span>
                            </label>
                          ))
                        ) : (
                          <p className="hint">
                            {gitUntrackedFiles?.ok
                              ? "No new files to select."
                              : gitUntrackedFiles
                                ? `Failed to load new files: ${gitUntrackedFiles.message}`
                                : "Loading new files..."}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </section>

                  <textarea
                    className="editor-input multiline"
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    placeholder="Enter your commit message"
                  />
                  <label className="editor-label">
                    Remote Branch
                    <select
                      className="editor-input"
                      value={selectedRemoteBranch}
                      onChange={(event) => setSelectedRemoteBranch(event.target.value)}
                      disabled={remoteHistoryLoading || !gitBranches?.ok || gitBranches.branches.length === 0}
                    >
                      {gitBranches?.ok && gitBranches.branches.length > 0 ? (
                        gitBranches.branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))
                      ) : (
                        <option value="">
                          {remoteHistoryLoading ? "Loading branches..." : "No branch available"}
                        </option>
                      )}
                    </select>
                  </label>
                </>
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

              {editorMode === "commit" && gitBranches && !gitBranches.ok ? (
                <div className="warn-box">
                  Failed to load branches: {gitBranches.message}
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

