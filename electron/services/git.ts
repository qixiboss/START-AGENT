import { runGit, validateGitRepo, ensureOriginConfigured, getCurrentBranch } from "../utils/git.js";
import {
  GitAddRequest,
  GitAddResult,
  GitCommitRequest,
  GitCommitResult,
  GitPullRequest,
  GitPullResult,
  GitUntrackedFilesResult,
  GitBranchesResult,
  GitRemoteHistoryResult,
  ProjectMeta
} from "../../src/types/ipc.js";

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
  getProjectMeta: (projectPath: string) => ProjectMeta | undefined
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

  const remoteCheck = await runGit(["remote", "get-url", "origin"], request.projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = getProjectMeta(request.projectPath)?.githubUrl;
    if (!maybeGithubUrl) {
      return {
        ok: false,
        step: "validate",
        message: "No git remote origin found. Set GitHub URL first.",
        stdout: remoteCheck.stdout,
        stderr: remoteCheck.stderr
      };
    }

    const warning = await ensureOriginConfigured(request.projectPath, maybeGithubUrl);
    if (warning) {
      return {
        ok: false,
        step: "validate",
        message: `Failed to configure origin: ${warning}`,
        stdout: "",
        stderr: warning
      };
    }
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

export const gitPull = async (
  request: GitPullRequest,
  getProjectMeta: (projectPath: string) => ProjectMeta | undefined
): Promise<GitPullResult> => {
  const validation = await validateGitRepo(request.projectPath);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message || "Current project is not a git repository.",
      stdout: "",
      stderr: ""
    };
  }

  const remoteCheck = await runGit(["remote", "get-url", "origin"], request.projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = getProjectMeta(request.projectPath)?.githubUrl;
    if (!maybeGithubUrl) {
      return {
        ok: false,
        message: "No git remote origin found. Set GitHub URL first.",
        stdout: remoteCheck.stdout,
        stderr: remoteCheck.stderr
      };
    }

    const warning = await ensureOriginConfigured(request.projectPath, maybeGithubUrl);
    if (warning) {
      return {
        ok: false,
        message: `Failed to configure origin: ${warning}`,
        stdout: "",
        stderr: warning
      };
    }
  }

  const currentBranch = await getCurrentBranch(request.projectPath);
  if (!currentBranch) {
    return {
      ok: false,
      message: "Failed to resolve current branch.",
      stdout: "",
      stderr: ""
    };
  }

  const remoteBranch = (request.remoteBranch || currentBranch).trim();
  if (!remoteBranch) {
    return { ok: false, message: "Remote branch is required.", stdout: "", stderr: "" };
  }

  const pullResult = await runGit(["pull", "origin", remoteBranch], request.projectPath);
  if (pullResult.code !== 0) {
    return {
      ok: false,
      message: `git pull origin ${remoteBranch} failed.`,
      stdout: pullResult.stdout,
      stderr: pullResult.stderr
    };
  }

  return {
    ok: true,
    message: `Pulled latest from origin/${remoteBranch}.`,
    stdout: pullResult.stdout,
    stderr: pullResult.stderr
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

export const getRemoteHistory = async (
  projectPath: string,
  getProjectMeta: (projectPath: string) => ProjectMeta | undefined
): Promise<GitRemoteHistoryResult> => {
  const validation = await validateGitRepo(projectPath);
  if (!validation.ok) {
    return { ok: false, message: validation.message || "Current project is not a git repository." };
  }

  const remoteCheck = await runGit(["remote", "get-url", "origin"], projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = getProjectMeta(projectPath)?.githubUrl;
    if (!maybeGithubUrl) {
      return { ok: false, message: "No git remote origin found. Set GitHub URL first." };
    }

    const warning = await ensureOriginConfigured(projectPath, maybeGithubUrl);
    if (warning) {
      return { ok: false, message: `Failed to configure origin: ${warning}` };
    }
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
        remoteHeadResult.stderr ||
        localHeadResult.stderr ||
        `Failed to read heads for upstream ${upstreamRef}.`
    };
  }

  const localHead = localHeadResult.stdout.trim();
  const remoteHead = remoteHeadResult.stdout.trim();
  const isUpToDate = localHead === remoteHead;

  const divergenceResult = await runGit(["rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`], projectPath);
  if (divergenceResult.code !== 0) {
    return { ok: false, message: divergenceResult.stderr || "Failed to inspect commit divergence." };
  }

  const [behindRaw, aheadRaw] = divergenceResult.stdout.trim().split(/\s+/);
  const behindCount = Number.parseInt(behindRaw ?? "0", 10);
  const aheadCount = Number.parseInt(aheadRaw ?? "0", 10);
  const normalizedBehind = Number.isFinite(behindCount) && behindCount >= 0 ? behindCount : 0;
  const normalizedAhead = Number.isFinite(aheadCount) && aheadCount >= 0 ? aheadCount : 0;
  const canPush = normalizedAhead > 0;

  const statusResult = await runGit(["status", "--porcelain"], projectPath);
  if (statusResult.code !== 0) {
    return { ok: false, message: statusResult.stderr || "Failed to inspect local changes." };
  }
  const hasLocalChanges = statusResult.stdout.trim().length > 0;

  const log = await runGit(
    [
      "log",
      "--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s",
      "--date=iso",
      "-n",
      "20",
      upstreamRef
    ],
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
    hasLocalChanges,
    aheadCount: normalizedAhead,
    behindCount: normalizedBehind,
    canPush,
    commits
  };
};
