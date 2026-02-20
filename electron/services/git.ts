import { ensureOriginConfigured, getCurrentBranch, runGit, validateGitRepo } from "../utils/git.js";
import { getDefaultGitPolicy, loadGitPolicy } from "./gitPolicy.js";
import type {
  GitAddRequest,
  GitAddResult,
  GitBranchesResult,
  GitCommitRequest,
  GitCommitResult,
  GitGraphNode,
  GitGraphResult,
  GitPolicy,
  GitPolicyLoadResult,
  GitPublishPrecheckRequest,
  GitPublishPrecheckResult,
  GitPullRequest,
  GitPullResult,
  GitRemoteHistoryResult,
  GitStashEntry,
  GitStashListResult,
  GitStashPopRequest,
  GitStashPopResult,
  GitStashPushRequest,
  GitStashPushResult,
  GitSyncErrorCode,
  GitSyncRequest,
  GitSyncResult,
  GitSyncStrategy,
  GitUntrackedFilesResult,
  ProjectMeta
} from "../../src/types/ipc.js";

type GetProjectMeta = (projectPath: string) => ProjectMeta | undefined;

type EnsureOriginResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
      stdout: string;
      stderr: string;
    };

type DivergenceStatus = {
  upstreamRef: string;
  aheadCount: number;
  behindCount: number;
  remoteBranchExists: boolean;
};

type GitSyncFailureInfo = {
  code: GitSyncErrorCode;
  message: string;
  suggestion?: string;
};

const ensureOrigin = async (projectPath: string, getProjectMeta: GetProjectMeta): Promise<EnsureOriginResult> => {
  const remoteCheck = await runGit(["remote", "get-url", "origin"], projectPath);
  if (remoteCheck.code === 0) {
    return { ok: true };
  }

  const maybeGithubUrl = getProjectMeta(projectPath)?.githubUrl;
  if (!maybeGithubUrl) {
    return {
      ok: false,
      message: "No git remote origin found. Set GitHub URL first.",
      stdout: remoteCheck.stdout,
      stderr: remoteCheck.stderr
    };
  }

  const warning = await ensureOriginConfigured(projectPath, maybeGithubUrl);
  if (warning) {
    return {
      ok: false,
      message: `Failed to configure origin: ${warning}`,
      stdout: "",
      stderr: warning
    };
  }

  return { ok: true };
};

const readLocalChanges = async (projectPath: string): Promise<{ ok: true; hasLocalChanges: boolean } | { ok: false; message: string }> => {
  const statusResult = await runGit(["status", "--porcelain"], projectPath);
  if (statusResult.code !== 0) {
    return { ok: false, message: statusResult.stderr || "Failed to inspect local changes." };
  }
  return { ok: true, hasLocalChanges: statusResult.stdout.trim().length > 0 };
};

const parseDivergenceCounts = (value: string): { aheadCount: number; behindCount: number } => {
  const [behindRaw, aheadRaw] = value.trim().split(/\s+/);
  const behindCount = Number.parseInt(behindRaw ?? "0", 10);
  const aheadCount = Number.parseInt(aheadRaw ?? "0", 10);
  return {
    aheadCount: Number.isFinite(aheadCount) && aheadCount >= 0 ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) && behindCount >= 0 ? behindCount : 0
  };
};

const readDivergenceStatus = async (
  projectPath: string,
  remoteBranch: string
): Promise<{ ok: true; status: DivergenceStatus } | { ok: false; message: string }> => {
  const upstreamRef = `origin/${remoteBranch}`;
  const remoteHead = await runGit(["rev-parse", upstreamRef], projectPath);
  if (remoteHead.code !== 0) {
    return {
      ok: true,
      status: {
        upstreamRef,
        aheadCount: 0,
        behindCount: 0,
        remoteBranchExists: false
      }
    };
  }

  const divergenceResult = await runGit(["rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`], projectPath);
  if (divergenceResult.code !== 0) {
    return { ok: false, message: divergenceResult.stderr || "Failed to inspect commit divergence." };
  }

  return {
    ok: true,
    status: {
      upstreamRef,
      remoteBranchExists: true,
      ...parseDivergenceCounts(divergenceResult.stdout)
    }
  };
};

const classifyGitSyncFailure = (
  stdout: string,
  stderr: string,
  strategy: GitSyncStrategy
): GitSyncFailureInfo => {
  const combined = `${stdout}\n${stderr}`;

  if (
    /rebase in progress|currently rebasing|already a rebase-merge|another rebase/i.test(combined)
  ) {
    return {
      code: "REBASE_IN_PROGRESS",
      message: "Git sync failed because a rebase is already in progress.",
      suggestion: "Resolve the ongoing rebase first: git rebase --continue or git rebase --abort."
    };
  }

  if (
    /CONFLICT \(|Automatic merge failed|could not apply|fix conflicts and then commit|unmerged files|unresolved conflict/i.test(
      combined
    )
  ) {
    return {
      code: "CONFLICT",
      message: `Git sync encountered merge/rebase conflicts using '${strategy}'.`,
      suggestion: "Resolve conflicts, then continue the rebase/merge in terminal."
    };
  }

  if (/Not possible to fast-forward|fatal:.*fast-forward/i.test(combined)) {
    return {
      code: "FF_ONLY_REJECTED",
      message: "Fast-forward only sync failed because local and remote branches diverged.",
      suggestion: "Use rebase strategy, then sync again."
    };
  }

  if (
    /local changes.*would be overwritten|Please commit your changes or stash them|cannot pull with rebase: You have .* changes|please commit or stash them/i.test(
      combined
    )
  ) {
    return {
      code: "LOCAL_CHANGES_BLOCK",
      message: "Git sync is blocked by local uncommitted changes.",
      suggestion: "Commit or stash local changes before syncing."
    };
  }

  return {
    code: "UNKNOWN",
    message: `Git sync failed with strategy '${strategy}'.`
  };
};

const validateCommitMessage = (message: string, policy: GitPolicy): GitPublishPrecheckResult["issues"] => {
  const issues: GitPublishPrecheckResult["issues"] = [];
  const trimmed = message.trim();

  if (policy.commitConvention.type !== "conventional_commits") {
    return issues;
  }

  if (!trimmed) {
    issues.push({
      level: "warn",
      risk: "medium",
      code: "COMMIT_FORMAT",
      message: "Commit message is empty.",
      suggestion: "Use format: type(scope): summary"
    });
    return issues;
  }

  const conventionalPattern = /^([a-z]+)(\([^)]+\))?(!)?:\s+.+$/;
  const match = trimmed.match(conventionalPattern);
  if (!match) {
    issues.push({
      level: "warn",
      risk: "medium",
      code: "COMMIT_FORMAT",
      message: "Commit message does not match Conventional Commits.",
      suggestion: "Example: feat(projects): add branch guard precheck"
    });
    return issues;
  }

  const commitType = (match[1] ?? "").trim();
  if (!policy.commitConvention.allowedTypes.includes(commitType)) {
    issues.push({
      level: "warn",
      risk: "medium",
      code: "COMMIT_TYPE",
      message: `Commit type '${commitType}' is not in allowed list.`,
      suggestion: `Allowed: ${policy.commitConvention.allowedTypes.join(", ")}`
    });
  }

  if (trimmed.length > policy.commitConvention.maxHeaderLength) {
    issues.push({
      level: "warn",
      risk: "low",
      code: "COMMIT_HEADER_TOO_LONG",
      message: `Commit header is ${trimmed.length} chars (limit ${policy.commitConvention.maxHeaderLength}).`
    });
  }

  return issues;
};

const validateBranchPolicy = (
  branchName: string,
  remoteBranch: string,
  policy: GitPolicy,
  divergenceStatus: DivergenceStatus
): GitPublishPrecheckResult["issues"] => {
  const issues: GitPublishPrecheckResult["issues"] = [];

  if (policy.branchPolicy.warnIfNotMatch) {
    try {
      const branchPattern = new RegExp(policy.branchPolicy.suggestPattern);
      if (!branchPattern.test(branchName)) {
        issues.push({
          level: "warn",
          risk: "low",
          code: "BRANCH_NAME_PATTERN",
          message: `Branch '${branchName}' does not match recommended pattern.`,
          suggestion: policy.branchPolicy.suggestPattern
        });
      }
    } catch {
      issues.push({
        level: "warn",
        risk: "medium",
        code: "POLICY_LOAD_FAILED",
        message: "Branch naming regex in policy is invalid.",
        suggestion: "Fix branchPolicy.suggestPattern in .start-agent/git-policy.json"
      });
    }
  }

  const normalizedRemoteBranch = remoteBranch.trim().toLowerCase();
  const isProtectedBranch = policy.protectedBranches.some(
    (item) => item.trim().toLowerCase() === normalizedRemoteBranch
  );
  if (isProtectedBranch && policy.pushPolicy.confirmPushToProtected) {
    issues.push({
      level: "warn",
      risk: "high",
      code: "PROTECTED_BRANCH_PUSH",
      message: `Target branch '${remoteBranch}' is protected by team policy.`,
      suggestion: "Push through a short-lived feature branch and merge via PR."
    });
  }

  if (!divergenceStatus.remoteBranchExists) {
    issues.push({
      level: "info",
      risk: "low",
      code: "REMOTE_BRANCH_MISSING",
      message: `Remote branch origin/${remoteBranch} does not exist yet. First push will create it.`
    });
    return issues;
  }

  if (divergenceStatus.behindCount > 0 && policy.pushPolicy.warnWhenBehind) {
    issues.push({
      level: "warn",
      risk: policy.pushPolicy.requireUpToDateBeforePush ? "high" : "medium",
      code: "REMOTE_BEHIND",
      message: `Local branch is behind origin/${remoteBranch} by ${divergenceStatus.behindCount} commit(s).`,
      suggestion: "Run sync before publish to reduce integration conflicts."
    });
  }

  if (divergenceStatus.behindCount > 0 && policy.pushPolicy.requireUpToDateBeforePush && !policy.pushPolicy.warnWhenBehind) {
    issues.push({
      level: "warn",
      risk: "high",
      code: "REMOTE_BEHIND",
      message: `Policy requires up-to-date branch before push. Remote is ahead by ${divergenceStatus.behindCount}.`,
      suggestion: "Run sync before publish."
    });
  }

  return issues;
};

const resolvePolicy = async (
  projectPath: string
): Promise<{ policy: GitPolicy; policyResult: GitPolicyLoadResult; issues: GitPublishPrecheckResult["issues"] }> => {
  const policyResult = await loadGitPolicy(projectPath);
  const policy = policyResult.policy;
  const issues: GitPublishPrecheckResult["issues"] = [];
  if (!policyResult.ok) {
    issues.push({
      level: "warn",
      risk: "medium",
      code: "POLICY_LOAD_FAILED",
      message: policyResult.message,
      suggestion: "Fix .start-agent/git-policy.json to enable repository-specific policy."
    });
  } else if (policyResult.warning) {
    issues.push({
      level: "warn",
      risk: "medium",
      code: "POLICY_LOAD_FAILED",
      message: policyResult.warning
    });
  }
  return { policy, policyResult, issues };
};

export const getGitPolicy = async (projectPath: string): Promise<GitPolicyLoadResult> => {
  return loadGitPolicy(projectPath);
};

export const precheckGitPublish = async (
  request: GitPublishPrecheckRequest,
  getProjectMeta: GetProjectMeta
): Promise<GitPublishPrecheckResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      issues: []
    };
  }

  const origin = await ensureOrigin(request.projectPath, getProjectMeta);
  if (!origin.ok) {
    return {
      ok: false,
      message: origin.message,
      issues: []
    };
  }

  const { policy, issues } = await resolvePolicy(request.projectPath);

  await runGit(["fetch", "origin", "--prune"], request.projectPath);

  const currentBranch = await getCurrentBranch(request.projectPath);
  if (!currentBranch) {
    return {
      ok: false,
      message: "Failed to resolve current branch.",
      issues,
      policy
    };
  }

  const remoteBranch = (request.remoteBranch || currentBranch).trim();
  if (!remoteBranch) {
    return {
      ok: false,
      message: "Remote branch is required.",
      issues,
      policy
    };
  }

  const divergence = await readDivergenceStatus(request.projectPath, remoteBranch);
  if (!divergence.ok) {
    return {
      ok: false,
      message: divergence.message,
      issues,
      policy
    };
  }

  const localChangesResult = await readLocalChanges(request.projectPath);
  if (!localChangesResult.ok) {
    return {
      ok: false,
      message: localChangesResult.message,
      issues,
      policy
    };
  }

  issues.push(...validateCommitMessage(request.message, policy));
  issues.push(...validateBranchPolicy(currentBranch, remoteBranch, policy, divergence.status));

  if (localChangesResult.hasLocalChanges) {
    issues.push({
      level: "info",
      risk: "low",
      code: "UNCOMMITTED_CHANGES",
      message: "Working tree has local changes. Commit will include staged changes only."
    });
  }

  return {
    ok: true,
    currentBranch,
    remoteBranch,
    upstreamRef: divergence.status.upstreamRef,
    hasLocalChanges: localChangesResult.hasLocalChanges,
    aheadCount: divergence.status.aheadCount,
    behindCount: divergence.status.behindCount,
    remoteBranchExists: divergence.status.remoteBranchExists,
    issues,
    policy
  };
};

export const gitSync = async (
  request: GitSyncRequest,
  getProjectMeta: GetProjectMeta
): Promise<GitSyncResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      strategy: request.strategy ?? getDefaultGitPolicy().pullStrategy,
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  const origin = await ensureOrigin(request.projectPath, getProjectMeta);
  if (!origin.ok) {
    return {
      ok: false,
      strategy: request.strategy ?? getDefaultGitPolicy().pullStrategy,
      message: origin.message,
      stdout: origin.stdout,
      stderr: origin.stderr
    };
  }

  const currentBranch = await getCurrentBranch(request.projectPath);
  if (!currentBranch) {
    return {
      ok: false,
      strategy: request.strategy ?? getDefaultGitPolicy().pullStrategy,
      message: "Failed to resolve current branch.",
      stdout: "",
      stderr: ""
    };
  }

  const remoteBranch = (request.remoteBranch || currentBranch).trim();
  if (!remoteBranch) {
    return {
      ok: false,
      strategy: request.strategy ?? getDefaultGitPolicy().pullStrategy,
      message: "Remote branch is required.",
      stdout: "",
      stderr: ""
    };
  }

  const policyResult = await loadGitPolicy(request.projectPath);
  const strategy = request.strategy ?? policyResult.policy.pullStrategy;

  await runGit(["fetch", "origin", "--prune"], request.projectPath);

  const pullArgs =
    strategy === "rebase"
      ? ["pull", "--rebase", "origin", remoteBranch]
      : strategy === "ff-only"
        ? ["pull", "--ff-only", "origin", remoteBranch]
        : ["pull", "origin", remoteBranch];

  const syncResult = await runGit(pullArgs, request.projectPath);
  if (syncResult.code !== 0) {
    const failure = classifyGitSyncFailure(syncResult.stdout, syncResult.stderr, strategy);
    return {
      ok: false,
      strategy,
      code: failure.code,
      message: failure.message,
      suggestion: failure.suggestion,
      stdout: syncResult.stdout,
      stderr: syncResult.stderr
    };
  }

  return {
    ok: true,
    strategy,
    message: `Synced from origin/${remoteBranch} using '${strategy}'.`,
    stdout: syncResult.stdout,
    stderr: syncResult.stderr
  };
};

export const gitPull = async (
  request: GitPullRequest,
  getProjectMeta: GetProjectMeta
): Promise<GitPullResult> => {
  const syncResult = await gitSync(
    {
      projectPath: request.projectPath,
      remoteBranch: request.remoteBranch,
      strategy: "merge"
    },
    getProjectMeta
  );

  if (!syncResult.ok) {
    return {
      ok: false,
      message: syncResult.message,
      stdout: syncResult.stdout,
      stderr: syncResult.stderr
    };
  }

  return {
    ok: true,
    message: syncResult.message,
    stdout: syncResult.stdout,
    stderr: syncResult.stderr
  };
};

export const gitAdd = async (request: GitAddRequest): Promise<GitAddResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  if (request.mode === "selected_new") {
    const files = (request.files ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    if (files.length === 0) {
      return {
        ok: false,
        message: "Please select at least one file to add.",
        stdout: "",
        stderr: ""
      };
    }

    const addResult = await runGit(["add", "--", ...files], request.projectPath);
    if (addResult.code !== 0) {
      return {
        ok: false,
        message: "git add selected files failed.",
        stdout: addResult.stdout,
        stderr: addResult.stderr
      };
    }

    return {
      ok: true,
      message: `Added ${files.length} selected file(s).`,
      addedFiles: files,
      stdout: addResult.stdout,
      stderr: addResult.stderr
    };
  }

  const addAllResult = await runGit(["add", "."], request.projectPath);
  if (addAllResult.code !== 0) {
    return {
      ok: false,
      message: "git add . failed.",
      stdout: addAllResult.stdout,
      stderr: addAllResult.stderr
    };
  }

  return {
    ok: true,
    message: "git add . completed.",
    addedFiles: ["."],
    stdout: addAllResult.stdout,
    stderr: addAllResult.stderr
  };
};

export const commitAndPush = async (
  request: GitCommitRequest,
  getProjectMeta: GetProjectMeta
): Promise<GitCommitResult> => {
  const message = request.message.trim();
  if (!message) {
    return {
      ok: false,
      step: "validate",
      message: "Commit message is required.",
      stdout: "",
      stderr: ""
    };
  }

  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      step: "validate",
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  const origin = await ensureOrigin(request.projectPath, getProjectMeta);
  if (!origin.ok) {
    return {
      ok: false,
      step: "validate",
      message: origin.message,
      stdout: origin.stdout,
      stderr: origin.stderr
    };
  }

  const commit = await runGit(["commit", "-m", message], request.projectPath);
  const commitOutput = `${commit.stdout}\n${commit.stderr}`.toLowerCase();
  const noChanges = commitOutput.includes("nothing to commit");
  if (commit.code !== 0 && !noChanges) {
    return {
      ok: false,
      step: "commit",
      message: "git commit failed.",
      stdout: commit.stdout,
      stderr: commit.stderr
    };
  }

  const currentBranch = await getCurrentBranch(request.projectPath);
  if (!currentBranch) {
    return {
      ok: false,
      step: "push",
      message: "Failed to resolve current branch.",
      stdout: "",
      stderr: ""
    };
  }

  const remoteBranch = (request.remoteBranch || currentBranch).trim();
  if (!remoteBranch) {
    return {
      ok: false,
      step: "validate",
      message: "Remote branch is required.",
      stdout: "",
      stderr: ""
    };
  }

  const push = await runGit(["push", "origin", `HEAD:${remoteBranch}`], request.projectPath);
  if (push.code !== 0) {
    return {
      ok: false,
      step: "push",
      message: "git push failed.",
      stdout: push.stdout,
      stderr: push.stderr
    };
  }

  return {
    ok: true,
    step: "push",
    message: noChanges
      ? `No new changes to commit. Push completed to origin/${remoteBranch}.`
      : `Commit and push completed to origin/${remoteBranch}.`,
    stdout: [commit.stdout, push.stdout].join("\n"),
    stderr: [commit.stderr, push.stderr].join("\n")
  };
};

export const listGitUntrackedFiles = async (projectPath: string): Promise<GitUntrackedFilesResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return { ok: false, message: validation.message || "Current project is not a git repository.", files: [] };
  }

  const statusResult = await runGit(["status", "--porcelain"], projectPath);
  if (statusResult.code !== 0) {
    return {
      ok: false,
      message: statusResult.stderr || "Failed to inspect git status.",
      files: []
    };
  }

  const files = statusResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0);

  return { ok: true, files };
};

export const listGitBranches = async (projectPath: string): Promise<GitBranchesResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      currentBranch: "",
      branches: []
    };
  }

  const currentBranch = await getCurrentBranch(projectPath);
  if (!currentBranch) {
    return {
      ok: false,
      message: "Failed to read current branch.",
      currentBranch: "",
      branches: []
    };
  }

  const remoteBranchesResult = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    projectPath
  );
  if (remoteBranchesResult.code !== 0) {
    return {
      ok: false,
      message: remoteBranchesResult.stderr || "Failed to list origin branches.",
      currentBranch,
      branches: [currentBranch].filter((item) => item.length > 0)
    };
  }

  const remoteBranches = remoteBranchesResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "origin/HEAD")
    .map((line) => (line.startsWith("origin/") ? line.slice("origin/".length) : line));

  const branches = Array.from(new Set([currentBranch, ...remoteBranches])).filter((item) => item.length > 0);
  branches.sort((a, b) => a.localeCompare(b));
  if (branches.includes(currentBranch)) {
    branches.splice(branches.indexOf(currentBranch), 1);
    branches.unshift(currentBranch);
  }

  return {
    ok: true,
    currentBranch,
    branches
  };
};

export const listGitStash = async (projectPath: string): Promise<GitStashListResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      entries: []
    };
  }

  const stashResult = await runGit(["stash", "list"], projectPath);
  if (stashResult.code !== 0) {
    return {
      ok: false,
      message: stashResult.stderr || "Failed to read stash list.",
      entries: []
    };
  }

  const entries: GitStashEntry[] = stashResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [refPart, ...rest] = line.split(": ");
      const ref = (refPart || "").trim();
      const summary = rest.join(": ").trim();
      const branchMatch = summary.match(/^On\s+([^:]+):\s*(.*)$/);
      return {
        ref,
        branch: branchMatch?.[1]?.trim() || undefined,
        summary: (branchMatch?.[2] || summary).trim()
      };
    });

  return {
    ok: true,
    entries
  };
};

export const pushGitStash = async (request: GitStashPushRequest): Promise<GitStashPushResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  const args = ["stash", "push"];
  if (request.includeUntracked) {
    args.push("--include-untracked");
  }
  const message = request.message?.trim() ?? "";
  if (message) {
    args.push("-m", message);
  }

  const stashResult = await runGit(args, request.projectPath);
  if (stashResult.code !== 0) {
    return {
      ok: false,
      message: "Failed to create stash.",
      stdout: stashResult.stdout,
      stderr: stashResult.stderr
    };
  }

  const combined = `${stashResult.stdout}\n${stashResult.stderr}`.toLowerCase();
  const created = !combined.includes("no local changes to save");
  return {
    ok: true,
    created,
    message: created ? "Created new stash entry." : "No local changes to stash.",
    stdout: stashResult.stdout,
    stderr: stashResult.stderr
  };
};

export const popGitStash = async (request: GitStashPopRequest): Promise<GitStashPopResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  const stashRef = request.stashRef?.trim();
  const args = stashRef ? ["stash", "pop", stashRef] : ["stash", "pop"];
  const result = await runGit(args, request.projectPath);
  if (result.code !== 0) {
    return {
      ok: false,
      message: "Failed to pop stash.",
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  return {
    ok: true,
    message: stashRef ? `Applied stash ${stashRef}.` : "Applied latest stash.",
    stdout: result.stdout,
    stderr: result.stderr
  };
};

export const getGitGraph = async (projectPath: string, limit: number = 30): Promise<GitGraphResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      nodes: []
    };
  }

  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
  const logResult = await runGit(
    [
      "log",
      "--decorate",
      "--pretty=format:%H%x09%h%x09%an%x09%ad%x09%d%x09%s",
      "--date=iso",
      "-n",
      String(normalizedLimit)
    ],
    projectPath
  );
  if (logResult.code !== 0) {
    return {
      ok: false,
      message: logResult.stderr || "Failed to load git graph.",
      nodes: []
    };
  }

  const nodes: GitGraphNode[] = logResult.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, shortHash, author, date, refsRaw, ...subjectRest] = line.split("\t");
      return {
        hash,
        shortHash,
        author,
        date,
        refs: refsRaw?.trim().replace(/^\((.*)\)$/, "$1") ?? "",
        subject: subjectRest.join("\t")
      };
    });

  return {
    ok: true,
    nodes
  };
};

export const getRemoteHistory = async (
  projectPath: string,
  getProjectMeta: GetProjectMeta
): Promise<GitRemoteHistoryResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return { ok: false, message: validation.message || "Current project is not a git repository." };
  }

  const origin = await ensureOrigin(projectPath, getProjectMeta);
  if (!origin.ok) {
    return {
      ok: false,
      message: origin.message
    };
  }

  await runGit(["fetch", "origin", "--prune"], projectPath);

  const currentBranch = await getCurrentBranch(projectPath);
  if (!currentBranch) {
    return { ok: false, message: "Failed to read current branch." };
  }

  const [upstreamRefResult, localHeadResult, remoteHeadResult] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], projectPath),
    runGit(["rev-parse", "HEAD"], projectPath),
    runGit(["rev-parse", `origin/${currentBranch}`], projectPath)
  ]);

  const upstreamRef =
    upstreamRefResult.code === 0 && upstreamRefResult.stdout.trim()
      ? upstreamRefResult.stdout.trim()
      : `origin/${currentBranch}`;

  if (localHeadResult.code !== 0 || remoteHeadResult.code !== 0) {
    return {
      ok: false,
      message:
        remoteHeadResult.stderr || localHeadResult.stderr || `Failed to read heads for upstream ${upstreamRef}.`
    };
  }

  const localHead = localHeadResult.stdout.trim();
  const remoteHead = remoteHeadResult.stdout.trim();
  const isUpToDate = localHead === remoteHead;

  const divergenceResult = await runGit(["rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`], projectPath);
  if (divergenceResult.code !== 0) {
    return { ok: false, message: divergenceResult.stderr || "Failed to inspect commit divergence." };
  }

  const { aheadCount: normalizedAhead, behindCount: normalizedBehind } = parseDivergenceCounts(divergenceResult.stdout);
  const canPush = normalizedAhead > 0;

  const localChangesResult = await readLocalChanges(projectPath);
  if (!localChangesResult.ok) {
    return { ok: false, message: localChangesResult.message };
  }

  const log = await runGit(
    ["log", "--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s", "--date=iso", "-n", "20", upstreamRef],
    projectPath
  );
  if (log.code !== 0) {
    return { ok: false, message: log.stderr || "Failed to load remote history." };
  }

  const commits = log.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, shortHash, author, date, ...rest] = line.split("\t");
      return {
        hash,
        shortHash,
        author,
        date,
        subject: rest.join("\t")
      };
    });

  return {
    ok: true,
    upstreamRef,
    localHead,
    remoteHead,
    isUpToDate,
    hasLocalChanges: localChangesResult.hasLocalChanges,
    aheadCount: normalizedAhead,
    behindCount: normalizedBehind,
    canPush,
    commits
  };
};
