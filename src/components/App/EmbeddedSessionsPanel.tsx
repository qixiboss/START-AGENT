import { Dispatch, RefObject, SetStateAction, memo } from "react";
import EmbeddedTerminal, { EmbeddedTerminalHandle } from "../EmbeddedTerminal";
import type {
  TerminalApprovalRequest,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionInputStateValue,
  TerminalSessionSnapshot
} from "../../types/ipc";

type EmbeddedSessionsPanelProps = {
  terminalSessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  sessionStatusPillClass: (status: TerminalSessionInfo["status"]) => string;
  closeEmbeddedSession: (sessionId: string) => Promise<void>;
  activeSession: TerminalSessionInfo | null;
  activeInputState: TerminalSessionInputState;
  inputStateLabel: (state: TerminalSessionInputStateValue) => string;
  scrollActiveTerminalToBottom: () => void;
  approvalBySession: Record<string, TerminalApprovalRequest>;
  submitApproval: (sessionId: string, decision: "allow_once" | "allow_session" | "deny") => Promise<void>;
  terminalHandleRef: RefObject<EmbeddedTerminalHandle>;
  terminalOutputBySession: Record<string, string>;
  sendTerminalData: (data: string) => void;
  resizeEmbeddedSession: (sessionId: string, cols: number, rows: number) => Promise<void>;
  terminalSnapshots: TerminalSessionSnapshot[];
};

export const EmbeddedSessionsPanel = memo((props: EmbeddedSessionsPanelProps): JSX.Element => {
  const {
    terminalSessions,
    activeSessionId,
    setActiveSessionId,
    sessionStatusPillClass,
    closeEmbeddedSession,
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
    terminalSnapshots
  } = props;

  return (
    <div className="embedded-terminal">
      <div className="session-tabs">
        {terminalSessions.length === 0 ? (
          <span className="hint">No active embedded sessions.</span>
        ) : (
          terminalSessions.map((session) => (
            <button
              key={session.id}
              className={`session-tab state-${session.status} ${activeSessionId === session.id ? "active" : ""}`}
              title={`${session.projectName} (${session.tool})`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span>
                {session.projectName} - {session.tool}
              </span>
              <span className={`pill ${sessionStatusPillClass(session.status)}`}>{session.status}</span>
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
                ×
              </span>
            </button>
          ))
        )}
      </div>

      {activeSession ? (
        <>
            <div className="terminal-toolbar">
              <div className="terminal-toolbar-left">
                <strong>
                  {activeSession.projectName} - {activeSession.tool}
                </strong>
                <span className="terminal-toolbar-meta">{activeSession.id.slice(0, 8)}</span>
                <span className={`pill ${sessionStatusPillClass(activeSession.status)}`}>{activeSession.status}</span>
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
                <button className="btn secondary" onClick={() => void submitApproval(activeSession.id, "allow_once")}>
                  Allow Once
                </button>
                <button className="btn secondary" onClick={() => void submitApproval(activeSession.id, "allow_session")}>
                  Allow Session
                </button>
                <button className="btn secondary" onClick={() => void submitApproval(activeSession.id, "deny")}>
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
          <p>Open Codex / Claude / OpenCode from project actions, or open a Shell session.</p>
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
  );
});
