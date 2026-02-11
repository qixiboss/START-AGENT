import { Dispatch, SetStateAction, memo } from "react";
import type {
  GitBranchesResult,
  GitRemoteHistoryResult,
  GitUntrackedFilesResult,
  ProjectItem
} from "../../types/ipc";

type EditorMode = "note" | "github" | "commit";

type GitCommitModalProps = {
  editorMode: EditorMode;
  editorProject: ProjectItem;
  closeEditor: () => void;
  isPulling: boolean;
  isRefreshingGit: boolean;
  isPublishing: boolean;
  isAdding: boolean;
  remoteHistoryLoading: boolean;
  gitWorkflowBusy: boolean;
  runGitPull: () => Promise<void>;
  loadRemoteHistory: () => Promise<void>;
  submitEditor: () => Promise<void>;
  editorValue: string;
  setEditorValue: Dispatch<SetStateAction<string>>;
  gitAddMode: "all" | "selected_new";
  setGitAddMode: Dispatch<SetStateAction<"all" | "selected_new">>;
  runGitAdd: () => Promise<void>;
  gitUntrackedFiles: GitUntrackedFilesResult | null;
  selectedNewFiles: string[];
  setSelectedNewFiles: Dispatch<SetStateAction<string[]>>;
  selectedRemoteBranch: string;
  setSelectedRemoteBranch: Dispatch<SetStateAction<string>>;
  gitBranches: GitBranchesResult | null;
  remoteHistory: GitRemoteHistoryResult | null;
  buildGitSyncHint: (
    history: Extract<GitRemoteHistoryResult, { ok: true }>
  ) => { level: "ok" | "warn"; text: string };
};

export const GitCommitModal = memo((props: GitCommitModalProps): JSX.Element => {
  const {
    editorMode,
    editorProject,
    closeEditor,
    isPulling,
    isRefreshingGit,
    isPublishing,
    isAdding,
    remoteHistoryLoading,
    gitWorkflowBusy,
    runGitPull,
    loadRemoteHistory,
    submitEditor,
    editorValue,
    setEditorValue,
    gitAddMode,
    setGitAddMode,
    runGitAdd,
    gitUntrackedFiles,
    selectedNewFiles,
    setSelectedNewFiles,
    selectedRemoteBranch,
    setSelectedRemoteBranch,
    gitBranches,
    remoteHistory,
    buildGitSyncHint
  } = props;

  return (
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
              {isPublishing ? "Publishing..." : editorMode === "commit" ? "Publish" : "Save"}
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
                    <option value="">{remoteHistoryLoading ? "Loading branches..." : "No branch available"}</option>
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
                    <span className={`pill ${remoteHistory.canPush || !remoteHistory.isUpToDate ? "warn" : "ok"}`}>
                      {remoteHistory.canPush ? "Push available" : remoteHistory.isUpToDate ? "Up to date" : "Not synced"}
                    </span>
                    <span className="hint">{remoteHistory.upstreamRef}</span>
                  </>
                ) : (
                  <span className="pill err">Error</span>
                )}
              </div>

              {remoteHistory.ok ? (
                <>
                  <div className={buildGitSyncHint(remoteHistory).level === "ok" ? "hint-box" : "warn-box"}>
                    {buildGitSyncHint(remoteHistory).text}
                  </div>
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
                </>
              ) : (
                <div className="error-box">Failed: {remoteHistory.message}</div>
              )}
            </section>
          ) : null}

          {editorMode === "commit" && gitBranches && !gitBranches.ok ? (
            <div className="warn-box">Failed to load branches: {gitBranches.message}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
