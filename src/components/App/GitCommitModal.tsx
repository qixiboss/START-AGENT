import { Dispatch, SetStateAction, memo, useMemo } from "react";
import type {
  GitBranchesResult,
  GitGraphResult,
  GitPolicyLoadResult,
  GitPublishPrecheckResult,
  GitRemoteHistoryResult,
  GitStashEntry,
  GitSyncResult,
  GitSyncStrategy,
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
  isRunningPrecheck: boolean;
  isStashing: boolean;
  remoteHistoryLoading: boolean;
  gitWorkflowBusy: boolean;
  sendTerminalData: (command: string) => void;
  runGitPull: () => Promise<void>;
  runPublishPrecheck: () => Promise<GitPublishPrecheckResult | null>;
  runGitStashPush: () => Promise<void>;
  runGitStashPop: (stashRef?: string) => Promise<void>;
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
  gitPolicy: GitPolicyLoadResult | null;
  publishPrecheck: GitPublishPrecheckResult | null;
  lastSyncResult: GitSyncResult | null;
  gitGraph: GitGraphResult | null;
  stashEntries: GitStashEntry[];
  stashMessage: string;
  setStashMessage: Dispatch<SetStateAction<string>>;
  stashIncludeUntracked: boolean;
  setStashIncludeUntracked: Dispatch<SetStateAction<boolean>>;
  allowProtectedPush: boolean;
  setAllowProtectedPush: Dispatch<SetStateAction<boolean>>;
  allowBehindPush: boolean;
  setAllowBehindPush: Dispatch<SetStateAction<boolean>>;
  gitSyncStrategy: GitSyncStrategy;
  setGitSyncStrategy: Dispatch<SetStateAction<GitSyncStrategy>>;
  buildGitSyncHint: (
    history: Extract<GitRemoteHistoryResult, { ok: true }>
  ) => { level: "ok" | "warn"; text: string };
};

const issueLevelClass = (level: "info" | "warn"): string => {
  return level === "warn" ? "warn-box" : "hint-box";
};

const issueRiskClass = (risk: "low" | "medium" | "high"): string => {
  if (risk === "high") {
    return "git-risk-high";
  }
  if (risk === "medium") {
    return "git-risk-medium";
  }
  return "git-risk-low";
};

type SyncGuidance = {
  codeLabel: string;
  title: string;
  steps: string[];
};

const buildSyncGuidance = (
  syncResult: Extract<GitSyncResult, { ok: false }>,
  remoteBranch: string
): SyncGuidance => {
  const branch = remoteBranch.trim() || "<branch>";
  if (syncResult.code === "REBASE_IN_PROGRESS") {
    return {
      codeLabel: "REBASE_IN_PROGRESS",
      title: "Finish or abort the current rebase first",
      steps: ["git status", "git rebase --continue", "git rebase --abort"]
    };
  }
  if (syncResult.code === "CONFLICT") {
    if (syncResult.strategy === "rebase") {
      return {
        codeLabel: "CONFLICT",
        title: "Resolve rebase conflicts and continue",
        steps: ["git status", "git add <resolved-files>", "git rebase --continue", "git rebase --abort"]
      };
    }
    return {
      codeLabel: "CONFLICT",
      title: "Resolve merge conflicts and complete merge",
      steps: ["git status", "git add <resolved-files>", "git commit", "git merge --abort"]
    };
  }
  if (syncResult.code === "FF_ONLY_REJECTED") {
    return {
      codeLabel: "FF_ONLY_REJECTED",
      title: "Branch diverged, use rebase strategy",
      steps: [`git pull --rebase origin ${branch}`, "Or switch strategy to rebase and click Sync Now again"]
    };
  }
  if (syncResult.code === "LOCAL_CHANGES_BLOCK") {
    return {
      codeLabel: "LOCAL_CHANGES_BLOCK",
      title: "Stash local changes before syncing",
      steps: [
        "git stash push --include-untracked -m \"wip before sync\"",
        `git pull --${syncResult.strategy === "merge" ? "no-rebase" : "rebase"} origin ${branch}`,
        "git stash pop"
      ]
    };
  }
  return {
    codeLabel: "UNKNOWN",
    title: "Inspect repository state and retry sync",
    steps: ["git status", "git fetch origin --prune", `git pull --rebase origin ${branch}`]
  };
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
    isRunningPrecheck,
    isStashing,
    remoteHistoryLoading,
    gitWorkflowBusy,
    sendTerminalData,
    runGitPull,
    runPublishPrecheck,
    runGitStashPush,
    runGitStashPop,
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
    buildGitSyncHint
  } = props;

  const isProtectedBranchSelected = useMemo(() => {
    if (!gitPolicy?.policy) {
      return false;
    }
    const normalized = selectedRemoteBranch.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return gitPolicy.policy.protectedBranches.some((branch) => branch.trim().toLowerCase() === normalized);
  }, [gitPolicy, selectedRemoteBranch]);

  const hasHighRiskBehind = useMemo(() => {
    if (publishPrecheck?.ok) {
      return publishPrecheck.issues.some((item) => item.code === "REMOTE_BEHIND" && item.risk === "high");
    }
    if (!remoteHistory?.ok || !gitPolicy?.policy.pushPolicy.requireUpToDateBeforePush) {
      return false;
    }
    return remoteHistory.behindCount > 0;
  }, [gitPolicy, publishPrecheck, remoteHistory]);

  const syncGuidance = useMemo(() => {
    if (!lastSyncResult || lastSyncResult.ok) {
      return null;
    }
    return buildSyncGuidance(lastSyncResult, selectedRemoteBranch);
  }, [lastSyncResult, selectedRemoteBranch]);

  const copySyncGuidanceCommand = (step: string): void => {
    try {
      void navigator.clipboard.writeText(step).catch(() => undefined);
    } catch {
      // Ignore clipboard unavailability.
    }
  };

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
                  {isPulling ? "Syncing..." : "Sync"}
                </button>
                <button
                  className={`btn git-action-btn ${isRunningPrecheck ? "primary" : "secondary"}`}
                  onClick={() => void runPublishPrecheck()}
                  disabled={remoteHistoryLoading || gitWorkflowBusy}
                >
                  {isRunningPrecheck ? "Checking..." : "Run Precheck"}
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
                placeholder="Enter your commit message (Conventional Commits recommended)"
              />

              <div className="git-config-row">
                <label className="editor-label compact">
                  Remote Branch
                  <select
                    className="editor-input"
                    value={selectedRemoteBranch}
                    onChange={(event) => {
                      setSelectedRemoteBranch(event.target.value);
                      setAllowProtectedPush(false);
                      setAllowBehindPush(false);
                    }}
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

                <label className="editor-label compact">
                  Sync Strategy
                  <select
                    className="editor-input"
                    value={gitSyncStrategy}
                    onChange={(event) => setGitSyncStrategy(event.target.value as GitSyncStrategy)}
                    disabled={remoteHistoryLoading || gitWorkflowBusy}
                  >
                    <option value="rebase">rebase</option>
                    <option value="ff-only">ff-only</option>
                    <option value="merge">merge</option>
                  </select>
                </label>
              </div>

              {isProtectedBranchSelected ? (
                <label className="git-risk-confirm">
                  <input
                    type="checkbox"
                    checked={allowProtectedPush}
                    onChange={(event) => setAllowProtectedPush(event.target.checked)}
                  />
                  <span>I understand this push targets a protected branch and want to continue.</span>
                </label>
              ) : null}

              {hasHighRiskBehind ? (
                <label className="git-risk-confirm">
                  <input
                    type="checkbox"
                    checked={allowBehindPush}
                    onChange={(event) => setAllowBehindPush(event.target.checked)}
                  />
                  <span>I understand remote is ahead and I still want to publish before syncing.</span>
                </label>
              ) : null}

              {hasHighRiskBehind ? (
                <div className="git-precheck-actions">
                  <button
                    className={`btn tiny ${isPulling ? "primary" : "secondary"}`}
                    type="button"
                    onClick={() => void runGitPull()}
                    disabled={remoteHistoryLoading || gitWorkflowBusy}
                  >
                    {isPulling ? "Syncing..." : `Sync Now (${gitSyncStrategy})`}
                  </button>
                  <span className="hint">Recommended: sync before publishing to reduce integration conflicts.</span>
                </div>
              ) : null}

              {gitPolicy ? (
                <section className="git-meta-panel">
                  <div className="git-meta-head">
                    <strong>Team Policy</strong>
                    <span className="hint">{gitPolicy.ok ? `source: ${gitPolicy.source}` : "fallback default"}</span>
                  </div>
                  {!gitPolicy.ok ? <div className="warn-box">{gitPolicy.message}</div> : null}
                  <div className="git-policy-grid">
                    <span>Default sync: {gitPolicy.policy.pullStrategy}</span>
                    <span>Protected: {gitPolicy.policy.protectedBranches.join(", ") || "none"}</span>
                    <span>Branch pattern: {gitPolicy.policy.branchPolicy.suggestPattern}</span>
                    <span>Commit format: {gitPolicy.policy.commitConvention.type}</span>
                  </div>
                </section>
              ) : null}

              {publishPrecheck ? (
                <section className="git-meta-panel">
                  <div className="git-meta-head">
                    <strong>Publish Precheck</strong>
                    {publishPrecheck.ok ? (
                      <span className="hint">
                        ahead {publishPrecheck.aheadCount}, behind {publishPrecheck.behindCount}
                      </span>
                    ) : (
                      <span className="pill err">Failed</span>
                    )}
                  </div>
                  {publishPrecheck.ok ? (
                    <>
                      {publishPrecheck.issues.length > 0 ? (
                        <div className="git-precheck-list">
                          {publishPrecheck.issues.map((issue, index) => (
                            <article
                              key={`${issue.code}-${index}`}
                              className={`${issueLevelClass(issue.level)} git-risk-item ${issueRiskClass(issue.risk)}`}
                            >
                              <div className="git-risk-head">
                                <strong>{issue.code}</strong>
                                <span className={`pill risk ${issue.risk}`}>{issue.risk}</span>
                              </div>
                              <div>{issue.message}</div>
                              {issue.suggestion ? <div className="hint">{issue.suggestion}</div> : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="hint-box">No policy issues found.</div>
                      )}
                    </>
                  ) : (
                    <div className="error-box">{publishPrecheck.message}</div>
                  )}
                </section>
              ) : null}

              {syncGuidance && lastSyncResult && !lastSyncResult.ok ? (
                <section className="git-meta-panel">
                  <div className="git-meta-head">
                    <strong>Sync Guidance</strong>
                    <span className="pill err">{syncGuidance.codeLabel}</span>
                  </div>
                  <div className="warn-box">{lastSyncResult.message}</div>
                  {lastSyncResult.suggestion ? <div className="hint-box">{lastSyncResult.suggestion}</div> : null}
                  <div className="git-guidance-title">{syncGuidance.title}</div>
                  <div className="git-guidance-list">
                    {syncGuidance.steps.map((step, index) => (
                      <div key={`${syncGuidance.codeLabel}-${index}`} className="git-guidance-row">
                        <code className="git-guidance-cmd">{step}</code>
                        <div className="git-guidance-actions">
                          <button
                            className="btn tiny secondary git-guidance-action"
                            type="button"
                            onClick={() => copySyncGuidanceCommand(step)}
                          >
                            Copy
                          </button>
                          <button
                            className="btn tiny secondary git-guidance-action"
                            type="button"
                            onClick={() => sendTerminalData(`${step}\n`)}
                            disabled={gitWorkflowBusy || remoteHistoryLoading}
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="git-meta-panel">
                <div className="git-meta-head">
                  <strong>Stash</strong>
                  <button
                    className={`btn tiny ${isStashing ? "primary" : "secondary"}`}
                    onClick={() => void runGitStashPush()}
                    type="button"
                    disabled={remoteHistoryLoading || gitWorkflowBusy}
                  >
                    {isStashing ? "Running..." : "Stash Push"}
                  </button>
                </div>
                <div className="git-stash-controls">
                  <input
                    className="editor-input"
                    value={stashMessage}
                    onChange={(event) => setStashMessage(event.target.value)}
                    placeholder="Optional stash message"
                  />
                  <label className="git-risk-confirm">
                    <input
                      type="checkbox"
                      checked={stashIncludeUntracked}
                      onChange={(event) => setStashIncludeUntracked(event.target.checked)}
                    />
                    <span>Include untracked files</span>
                  </label>
                </div>
                <div className="git-precheck-list">
                  {stashEntries.length > 0 ? (
                    stashEntries.map((entry) => (
                      <article key={entry.ref} className="remote-history-item">
                        <div className="remote-history-meta">
                          <span>{entry.ref}</span>
                          {entry.branch ? <span>{entry.branch}</span> : null}
                        </div>
                        <div>{entry.summary}</div>
                        <div className="git-inline-actions">
                          <button
                            className="btn tiny secondary"
                            onClick={() => void runGitStashPop(entry.ref)}
                            type="button"
                            disabled={remoteHistoryLoading || gitWorkflowBusy}
                          >
                            Apply
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="hint-box">No stash entries.</div>
                  )}
                </div>
              </section>

              {gitGraph ? (
                <section className="git-meta-panel">
                  <div className="git-meta-head">
                    <strong>Recent Commits</strong>
                  </div>
                  {gitGraph.ok ? (
                    <div className="git-precheck-list">
                      {gitGraph.nodes.slice(0, 12).map((node) => (
                        <article key={node.hash} className="remote-history-item">
                          <div className="remote-history-meta">
                            <span>{node.shortHash}</span>
                            <span>{node.author}</span>
                            <span>{node.date}</span>
                          </div>
                          <div>{node.subject}</div>
                          {node.refs ? <div className="hint">{node.refs}</div> : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="warn-box">Failed to load git graph: {gitGraph.message}</div>
                  )}
                </section>
              ) : null}
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
