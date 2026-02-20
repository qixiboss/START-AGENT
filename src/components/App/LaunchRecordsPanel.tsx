import { Dispatch, SetStateAction, memo } from "react";
import type { TerminalLaunchRecord } from "../../types/ipc";

type LaunchRecordsPanelProps = {
  launchRecords: TerminalLaunchRecord[];
  focusLaunchRecord: (recordId: string) => Promise<void>;
  editingLaunchNoteId: string | null;
  launchNoteDraft: string;
  setLaunchNoteDraft: Dispatch<SetStateAction<string>>;
  saveLaunchNote: () => Promise<void>;
  cancelEditLaunchNote: () => void;
  relaunchRecord: (record: TerminalLaunchRecord) => Promise<void>;
  startEditLaunchNote: (record: TerminalLaunchRecord) => void;
  removeLaunchRecord: (recordId: string) => Promise<void>;
};

export const LaunchRecordsPanel = memo((props: LaunchRecordsPanelProps): JSX.Element => {
  const {
    launchRecords,
    focusLaunchRecord,
    editingLaunchNoteId,
    launchNoteDraft,
    setLaunchNoteDraft,
    saveLaunchNote,
    cancelEditLaunchNote,
    relaunchRecord,
    startEditLaunchNote,
    removeLaunchRecord
  } = props;

  if (launchRecords.length === 0) {
    return (
      <div className="terminal-empty">
        <h3>No Windows PowerShell Launches</h3>
        <p>Choose a project on the right and open Codex, Claude, or OpenCode.</p>
      </div>
    );
  }

  return (
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
  );
});
