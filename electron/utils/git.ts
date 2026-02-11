import { spawn } from "node:child_process";

export type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * 执行 Git 命令
 */
export const runGit = async (args: string[], cwd: string): Promise<GitResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
};

/**
 * 验证是否为 Git 仓库
 */
export const validateGitRepo = async (projectPath: string): Promise<{ ok: boolean; message?: string }> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], projectPath);
  if (gitCheck.code !== 0) {
    return {
      ok: false,
      message: "Current project is not a git repository."
    };
  }
  return { ok: true };
};

/**
 * 获取当前分支名称
 */
export const getCurrentBranch = async (projectPath: string): Promise<string | null> => {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], projectPath);
  if (result.code !== 0) {
    return null;
  }
  return result.stdout.trim();
};

/**
 * 配置 Git Remote origin
 */
export const ensureOriginConfigured = async (
  projectPath: string,
  githubUrl: string
): Promise<string | undefined> => {
  try {
    const remotes = await runGit(["remote"], projectPath);
    if (remotes.code !== 0) {
      return remotes.stderr || "Not a git repository.";
    }
    const remoteNames = remotes.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const args = remoteNames.includes("origin")
      ? ["remote", "set-url", "origin", githubUrl]
      : ["remote", "add", "origin", githubUrl];
    const result = await runGit(args, projectPath);
    if (result.code !== 0) {
      return result.stderr || "Failed to sync git remote origin.";
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to configure git origin.";
  }
};

/**
 * 确保存在 Git Remote origin，使用项目元数据中的 URL
 */
export const ensureGitOriginWithMeta = async (
  projectPath: string,
  getGithubUrl: (projectPath: string) => string | undefined
): Promise<string | undefined> => {
  const remoteCheck = await runGit(["remote", "get-url", "origin"], projectPath);
  if (remoteCheck.code === 0) {
    return undefined;
  }

  const maybeGithubUrl = getGithubUrl(projectPath);
  if (!maybeGithubUrl) {
    return "No git remote origin found. Set GitHub URL first.";
  }
  return ensureOriginConfigured(projectPath, maybeGithubUrl);
};
