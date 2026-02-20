import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectFilter, ProjectList } from "./components/ProjectList";
import TitleBar from "./components/TitleBar";
import { type EmbeddedTerminalHandle } from "./components/EmbeddedTerminal";
import { TerminalStage } from "./components/App/TerminalStage";
import { GitCommitModal } from "./components/App/GitCommitModal";
import { QuotaCenterPanel, QuotaMetricCard } from "./components/App/QuotaCenter";
import { desktopApiAvailable, electronApi } from "./services/electronApi";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useProjects } from "./hooks/useProjects";
import { useTerminalSessions } from "./hooks/useTerminalSessions";
import { useTerminalLaunches } from "./hooks/useTerminalLaunches";
import { useGitOperations } from "./hooks/useGitOperations";
import { useEmbeddedSessionActions } from "./hooks/useEmbeddedSessionActions";
import { useQuotaStatus } from "./hooks/useQuotaStatus";
import type {
  TerminalApprovalRequest,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionInputStateValue,
  GitRemoteHistoryResult,
  ProjectItem,
  ToolType
} from "./types/ipc";
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

const buildGitSyncHint = (
  history: Extract<GitRemoteHistoryResult, { ok: true }>
): { level: "ok" | "warn"; text: string } => {
  if (history.canPush && history.behindCount > 0) {
    return {
      level: "warn",
      text: `Local branch has ${history.aheadCount} commit(s) to push and is behind ${history.behindCount} commit(s). Sync before push.`
    };
  }
  if (history.canPush) {
    return {
      level: "warn",
      text: `You have ${history.aheadCount} local commit(s) not pushed to ${history.upstreamRef}. You can push now.`
    };
  }
  if (history.hasLocalChanges) {
    return {
      level: "warn",
      text: "You have local file changes not committed yet. Commit first, then push."
    };
  }
  if (history.behindCount > 0) {
    return {
      level: "warn",
      text: `Remote has ${history.behindCount} newer commit(s). Sync before pushing.`
    };
  }
  return {
    level: "ok",
    text: "Local and remote are synced."
  };
};

const App = (): JSX.Element => {
  const [status, setStatus] = useState<string>("Ready");
  const {
    projects,
    rootPath,
    loading,
    error,
    scanProjects,
    applyRootChangeResult,
    patchProjectMetaInList
  } = useProjects({ withTimeout, setStatus });
  const {
    editorMode,
    editorProject,
    editorValue,
    setEditorValue,
    remoteHistory,
    gitBranches,
    gitUntrackedFiles,
    gitPolicy,
    publishPrecheck,
    lastSyncResult,
    gitGraph,
    stashEntries,
    stashMessage,
    setStashMessage,
    stashIncludeUntracked,
    setStashIncludeUntracked,
    allowProtectedPush,
    setAllowProtectedPush,
    allowBehindPush,
    setAllowBehindPush,
    gitSyncStrategy,
    setGitSyncStrategy,
    gitAddMode,
    setGitAddMode,
    selectedNewFiles,
    setSelectedNewFiles,
    selectedRemoteBranch,
    setSelectedRemoteBranch,
    remoteHistoryLoading,
    gitWorkflowBusy,
    isAdding,
    isPulling,
    isRefreshingGit,
    isPublishing,
    isRunningPrecheck,
    isStashing,
    openEditor,
    closeEditor,
    loadRemoteHistory,
    runPublishPrecheck,
    runGitAdd,
    runGitPull,
    runGitStashPush,
    runGitStashPop,
    submitEditor
  } = useGitOperations({ setStatus, patchProjectMetaInList });
  const {
    launchRecords,
    loadTerminalLaunches,
    launchTerminal: launchExternalTerminal,
    relaunchRecord,
    removeLaunchRecord,
    focusLaunchRecord,
    editingLaunchNoteId,
    launchNoteDraft,
    setLaunchNoteDraft,
    startEditLaunchNote,
    cancelEditLaunchNote,
    saveLaunchNote
  } = useTerminalLaunches({ withTimeout, setStatus });
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const {
    terminalSessions,
    setTerminalSessions,
    terminalSnapshots,
    activeSessionId,
    setActiveSessionId,
    terminalOutputBySession,
    setTerminalOutputBySession,
    approvalBySession,
    setApprovalBySession,
    inputStateBySession,
    setInputStateBySession,
    loadTerminalSessions,
    loadTerminalSnapshots
  } = useTerminalSessions({ withTimeout, setStatus });
  const {
    createEmbeddedSession,
    sendTerminalData,
    closeEmbeddedSession,
    submitApproval,
    resizeEmbeddedSession
  } = useEmbeddedSessionActions({
    withTimeout,
    setStatus,
    activeSessionId,
    setTerminalSessions,
    setActiveSessionId,
    setTerminalOutputBySession,
    approvalBySession,
    setApprovalBySession,
    setInputStateBySession,
    loadTerminalSessions,
    loadTerminalSnapshots
  });
  const terminalHandleRef = useRef<EmbeddedTerminalHandle>(null);
  const pendingOutputBySessionRef = useRef<Record<string, string[]>>({});
  const outputFlushRafRef = useRef<number | null>(null);
  const [useExternalTerminal, setUseExternalTerminal] = useLocalStorage<boolean>(
    EXTERNAL_TERMINAL_KEY,
    false,
    (raw) => raw === "1",
    (value) => (value ? "1" : "0")
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>(
    SIDEBAR_COLLAPSE_KEY,
    false,
    (raw) => raw === "1",
    (value) => (value ? "1" : "0")
  );
  const {
    quotaItems,
    quotaLoading,
    quotaError,
    showQuotaPanel,
    setShowQuotaPanel,
    quotaCheckedAt,
    quotaSummary,
    quotaStatusCounts,
    refreshQuotas,
    openQuotaConsole,
    quotaAuthConfigs,
    quotaAuthLoading,
    quotaAuthError,
    quotaSecretStorageMode,
    refreshQuotaAuthConfigs,
    saveQuotaAuthConfig,
    importQuotaAuthFromBrowser,
    authorizeQuotaInApp
  } = useQuotaStatus({ withTimeout, setStatus });

  const flushPendingTerminalOutput = useCallback(() => {
    outputFlushRafRef.current = null;
    const pending = pendingOutputBySessionRef.current;
    const entries = Object.entries(pending);
    if (entries.length === 0) {
      return;
    }
    pendingOutputBySessionRef.current = {};
    setTerminalOutputBySession((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      for (const [sessionId, chunks] of entries) {
        const mergedChunk = chunks.join("");
        if (!mergedChunk) {
          continue;
        }
        const previousOutput = next[sessionId] ?? "";
        const mergedOutput = appendTerminalOutput(previousOutput, mergedChunk);
        if (mergedOutput !== previousOutput) {
          next[sessionId] = mergedOutput;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [setTerminalOutputBySession]);

  const enqueueTerminalOutput = useCallback((sessionId: string, data: string) => {
    if (!data) {
      return;
    }
    const bucket = pendingOutputBySessionRef.current[sessionId];
    if (bucket) {
      bucket.push(data);
    } else {
      pendingOutputBySessionRef.current[sessionId] = [data];
    }
    if (outputFlushRafRef.current === null) {
      outputFlushRafRef.current = window.requestAnimationFrame(flushPendingTerminalOutput);
    }
  }, [flushPendingTerminalOutput]);

  useEffect(() => {
    void scanProjects();
    if (!desktopApiAvailable) {
      return;
    }
    void loadTerminalLaunches();
    void loadTerminalSessions();
    void loadTerminalSnapshots();
  }, [desktopApiAvailable, loadTerminalLaunches, loadTerminalSessions, loadTerminalSnapshots, scanProjects]);

  useEffect(() => {
    if (!desktopApiAvailable) {
      return;
    }
    const timer = window.setInterval(() => {
      if (useExternalTerminal) {
        void loadTerminalLaunches();
      } else {
        void loadTerminalSnapshots();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [desktopApiAvailable, loadTerminalLaunches, loadTerminalSnapshots, useExternalTerminal]);

  useEffect(() => {
    if (!desktopApiAvailable) {
      return;
    }
    const offOutput = electronApi.onTerminalSessionOutput((chunk) => {
      const normalized = sanitizeTerminalChunk(chunk.data);
      if (!normalized) {
        return;
      }
      enqueueTerminalOutput(chunk.sessionId, normalized);
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
      pendingOutputBySessionRef.current = {};
      if (outputFlushRafRef.current !== null) {
        window.cancelAnimationFrame(outputFlushRafRef.current);
        outputFlushRafRef.current = null;
      }
    };
  }, [desktopApiAvailable, enqueueTerminalOutput, loadTerminalSessions, loadTerminalSnapshots]);

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
      applyRootChangeResult(result);
    } catch (chooseError) {
      const message = chooseError instanceof Error ? chooseError.message : "Unknown directory selection error";
      setStatus(`Failed to change root: ${message}`);
    }
  }, [applyRootChangeResult]);

  const scrollActiveTerminalToBottom = useCallback(() => {
    terminalHandleRef.current?.scrollToBottom();
    terminalHandleRef.current?.focus();
  }, []);

  const launchTerminal = useCallback(async (project: ProjectItem, tool: ToolType) => {
    if (!useExternalTerminal) {
      await createEmbeddedSession(project, tool);
      return;
    }
    await launchExternalTerminal(project, tool);
  }, [createEmbeddedSession, launchExternalTerminal, useExternalTerminal]);

  return (
    <main className="app-shell">
      <TitleBar />
      <header className="hero-bar">
        <div>
          <p className="eyebrow">START-AGENT</p>
          <h1>Workspace Command Center</h1>
          <p className="hint">
            {!desktopApiAvailable
              ? "Browser preview mode. Launch the Electron app to enable terminal, Git, and filesystem actions."
              : useExternalTerminal
              ? launchRecords.length === 0
                ? "Open Codex, Claude, or OpenCode to launch Windows PowerShell sessions."
                : `Recent external launches: ${launchRecords.length}`
              : terminalSessions.length === 0
                ? "Open Codex / Claude / OpenCode / Shell to start embedded sessions."
                : `Active embedded sessions: ${terminalSessions.length}`}
          </p>
          {!desktopApiAvailable ? (
            <p className="preview-pill">Preview Mode: desktop actions are disabled in browser.</p>
          ) : null}
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
          <QuotaMetricCard
            quotaLoading={quotaLoading}
            quotaSummary={quotaSummary}
            quotaCheckedAt={quotaCheckedAt}
            quotaStatusCounts={quotaStatusCounts}
            showQuotaPanel={showQuotaPanel}
            onRefresh={() => void refreshQuotas()}
            onTogglePanel={() => setShowQuotaPanel((prev) => !prev)}
          />
        </div>
      </header>
      <QuotaCenterPanel
        show={showQuotaPanel}
        quotaItems={quotaItems}
        quotaLoading={quotaLoading}
        quotaError={quotaError}
        quotaCheckedAt={quotaCheckedAt}
        quotaAuthConfigs={quotaAuthConfigs}
        quotaAuthLoading={quotaAuthLoading}
        quotaAuthError={quotaAuthError}
        quotaSecretStorageMode={quotaSecretStorageMode}
        onRefresh={() => void refreshQuotas()}
        onRefreshAuth={() => void refreshQuotaAuthConfigs()}
        onSaveAuth={(request) => saveQuotaAuthConfig(request)}
        onImportAuthFromBrowser={(provider, browser) => importQuotaAuthFromBrowser(provider, browser)}
        onAuthorizeInApp={(provider) => authorizeQuotaInApp(provider)}
        onClose={() => setShowQuotaPanel(false)}
        onOpenConsole={(url) => void openQuotaConsole(url)}
      />

      <section className={`workspace-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <TerminalStage
          desktopApiAvailable={desktopApiAvailable}
          useExternalTerminal={useExternalTerminal}
          setUseExternalTerminal={setUseExternalTerminal}
          loadTerminalLaunches={loadTerminalLaunches}
          loadTerminalSessions={loadTerminalSessions}
          selectedProject={selectedProject}
          createEmbeddedSession={createEmbeddedSession}
          launchRecords={launchRecords}
          focusLaunchRecord={focusLaunchRecord}
          editingLaunchNoteId={editingLaunchNoteId}
          launchNoteDraft={launchNoteDraft}
          setLaunchNoteDraft={setLaunchNoteDraft}
          saveLaunchNote={saveLaunchNote}
          cancelEditLaunchNote={cancelEditLaunchNote}
          relaunchRecord={relaunchRecord}
          startEditLaunchNote={startEditLaunchNote}
          removeLaunchRecord={removeLaunchRecord}
          terminalSessions={terminalSessions}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          sessionStatusPillClass={sessionStatusPillClass}
          activeSession={activeSession}
          activeInputState={activeInputState}
          inputStateLabel={inputStateLabel}
          scrollActiveTerminalToBottom={scrollActiveTerminalToBottom}
          approvalBySession={approvalBySession}
          submitApproval={submitApproval}
          terminalHandleRef={terminalHandleRef}
          terminalOutputBySession={terminalOutputBySession}
          sendTerminalData={sendTerminalData}
          resizeEmbeddedSession={resizeEmbeddedSession}
          closeEmbeddedSession={closeEmbeddedSession}
          terminalSnapshots={terminalSnapshots}
        />

        <section className={`context-rail ${isSidebarCollapsed ? "collapsed" : ""}`}>
          <ProjectList
            collapsed={isSidebarCollapsed}
            desktopApiAvailable={desktopApiAvailable}
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
        <GitCommitModal
          editorMode={editorMode}
          editorProject={editorProject}
          closeEditor={closeEditor}
          isPulling={isPulling}
          isRefreshingGit={isRefreshingGit}
          isPublishing={isPublishing}
          isAdding={isAdding}
          isRunningPrecheck={isRunningPrecheck}
          isStashing={isStashing}
          remoteHistoryLoading={remoteHistoryLoading}
          gitWorkflowBusy={gitWorkflowBusy}
          runGitPull={runGitPull}
          runPublishPrecheck={runPublishPrecheck}
          runGitStashPush={runGitStashPush}
          runGitStashPop={runGitStashPop}
          loadRemoteHistory={loadRemoteHistory}
          submitEditor={submitEditor}
          sendTerminalData={sendTerminalData}
          editorValue={editorValue}
          setEditorValue={setEditorValue}
          gitAddMode={gitAddMode}
          setGitAddMode={setGitAddMode}
          runGitAdd={runGitAdd}
          gitUntrackedFiles={gitUntrackedFiles}
          selectedNewFiles={selectedNewFiles}
          setSelectedNewFiles={setSelectedNewFiles}
          selectedRemoteBranch={selectedRemoteBranch}
          setSelectedRemoteBranch={setSelectedRemoteBranch}
          gitBranches={gitBranches}
          remoteHistory={remoteHistory}
          gitPolicy={gitPolicy}
          publishPrecheck={publishPrecheck}
          lastSyncResult={lastSyncResult}
          gitGraph={gitGraph}
          stashEntries={stashEntries}
          stashMessage={stashMessage}
          setStashMessage={setStashMessage}
          stashIncludeUntracked={stashIncludeUntracked}
          setStashIncludeUntracked={setStashIncludeUntracked}
          allowProtectedPush={allowProtectedPush}
          setAllowProtectedPush={setAllowProtectedPush}
          allowBehindPush={allowBehindPush}
          setAllowBehindPush={setAllowBehindPush}
          gitSyncStrategy={gitSyncStrategy}
          setGitSyncStrategy={setGitSyncStrategy}
          buildGitSyncHint={buildGitSyncHint}
        />
      ) : null}
    </main>
  );
};

export default App;

