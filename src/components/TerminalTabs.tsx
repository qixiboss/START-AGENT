import type { TerminalSessionInfo } from "../types/ipc";

type TerminalTabsProps = {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
};

export const TerminalTabs = ({
  sessions,
  activeSessionId,
  onSelect,
  onClose
}: TerminalTabsProps): JSX.Element => {
  if (sessions.length === 0) {
    return <div className="tabs empty-tabs">No sessions yet</div>;
  }

  return (
    <div className="tabs">
      {sessions.map((session) => (
        <div key={session.id} className={`tab ${activeSessionId === session.id ? "active" : ""}`}>
          <button type="button" className="tab-select" onClick={() => onSelect(session.id)}>
            <span className="tab-title">{session.title}</span>
          </button>
          <button type="button" className="close" aria-label={`Close ${session.title}`} onClick={() => onClose(session.id)}>
            close
          </button>
        </div>
      ))}
    </div>
  );
};
