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
  return (
    <div className="tabs">
      {sessions.map((session) => (
        <button
          key={session.id}
          className={`tab ${activeSessionId === session.id ? "active" : ""}`}
          onClick={() => onSelect(session.id)}
        >
          <span>{session.title}</span>
          <span
            className="close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(session.id);
            }}
          >
            x
          </span>
        </button>
      ))}
    </div>
  );
};
