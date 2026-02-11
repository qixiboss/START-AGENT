import { Dispatch, RefObject, SetStateAction, memo } from "react";
import { LaunchRecordsPanel } from "./LaunchRecordsPanel";
import { EmbeddedSessionsPanel } from "./EmbeddedSessionsPanel";
import type {
  ProjectItem,
  TerminalApprovalRequest,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionInputStateValue,
  TerminalSessionSnapshot
} from "../../types/ipc";
import { EmbeddedTerminalHandle } from "../EmbeddedTerminal";

type TerminalStageProps = {
  useExternalTerminal: boolean;
  setUseExternalTerminal: Dispatch<SetStateAction<boolean>>;
  loadTerminalLaunches: () => Promise<void>;
  loadTerminalSessions: () => Promise<void>;
  selectedProject: ProjectItem | null;
  createEmbeddedSession: (project: ProjectItem, tool: "codex" | "claude" | "shell") => Promise<void>;
  launchRecords: Parameters<typeof LaunchRecordsPanel>[0]["launchRecords"];
  focusLaunchRecord: Parameters<typeof LaunchRecordsPanel>[0]["focusLaunchRecord"];
  editingLaunchNoteId: Parameters<typeof LaunchRecordsPanel>[0]["editingLaunchNoteId"];
  launchNoteDraft: Parameters<typeof LaunchRecordsPanel>[0]["launchNoteDraft"];
  setLaunchNoteDraft: Parameters<typeof LaunchRecordsPanel>[0]["setLaunchNoteDraft"];
  saveLaunchNote: Parameters<typeof LaunchRecordsPanel>[0]["saveLaunchNote"];
  cancelEditLaunchNote: Parameters<typeof LaunchRecordsPanel>[0]["cancelEditLaunchNote"];
  relaunchRecord: Parameters<typeof LaunchRecordsPanel>[0]["relaunchRecord"];
  startEditLaunchNote: Parameters<typeof LaunchRecordsPanel>[0]["startEditLaunchNote"];
  removeLaunchRecord: Parameters<typeof LaunchRecordsPanel>[0]["removeLaunchRecord"];
  terminalSessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  sessionStatusPillClass: (status: TerminalSessionInfo["status"]) => string;
  activeSession: TerminalSessionInfo | null;
  activeInputState: TerminalSessionInputState;
  inputStateLabel: (state: TerminalSessionInputStateValue) => string;
  scrollActiveTerminalToBottom: () => void;
  approvalBySession: Record<string, TerminalApprovalRequest>;
  submitApproval: (sessionId: string, decision: "allow_once" | "allow_session" | "deny") => Promise<void>;
  terminalHandleRef: RefObject<EmbeddedTerminalHandle | null>;
  terminalOutputBySession: Record<string, string>;
  sendTerminalData: (data: string) => void;
  resizeEmbeddedSession: (sessionId: string, cols: number, rows: number) => Promise<void>;
  closeEmbeddedSession: (sessionId: string) => Promise<void>;
  terminalSnapshots: TerminalSessionSnapshot[];
};

export const TerminalStage = memo((props: TerminalStageProps): JSX.Element => {
  const {
    useExternalTerminal,
    setUseExternalTerminal,
    loadTerminalLaunches,
    loadTerminalSessions,
    selectedProject,
    createEmbeddedSession,
    launchRecords,
    focusLaunchRecord,
    editingLaunchNoteId,
    launchNoteDraft,
    setLaunchNoteDraft,
    saveLaunchNote,
    cancelEditLaunchNote,
    relaunchRecord,
    startEditLaunchNote,
    removeLaunchRecord,
    terminalSessions,
    activeSessionId,
    setActiveSessionId,
    sessionStatusPillClass,
    activeSession,
    activeInputState,
    inputStateLabel,
    scrollActiveTerminalToBottom,
    approvalBySession,
    submitApproval,
    terminalHandleRef,
    terminalOutputBySession,
    sendTerminalData,
    resizeEmbeddedSession,
    closeEmbeddedSession,
    terminalSnapshots
  } = props;

  return (
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
          <button className="btn secondary" onClick={() => setUseExternalTerminal((prev) => !prev)}>
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
                <button className="btn secondary" onClick={() => void createEmbeddedSession(selectedProject, "shell")}>
                  Open Shell
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      <div className="launch-stage">
        {useExternalTerminal ? (
          <LaunchRecordsPanel
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
          />
        ) : (
          <EmbeddedSessionsPanel
            terminalSessions={terminalSessions}
            activeSessionId={activeSessionId}
            setActiveSessionId={setActiveSessionId}
            sessionStatusPillClass={sessionStatusPillClass}
            closeEmbeddedSession={closeEmbeddedSession}
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
            terminalSnapshots={terminalSnapshots}
          />
        )}
      </div>
    </section>
  );
});
