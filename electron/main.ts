import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { IPty, spawn as spawnPty } from "node-pty";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  TerminalApprovalDecision,
  TerminalApprovalRequest,
  GitAddRequest,
  GitAddResult,
  GitCommitRequest,
  GitCommitResult,
  GitPullRequest,
  GitPullResult,
  GitUntrackedFilesResult,
  GitBranchesResult,
  GitRemoteHistoryResult,
  IpcChannels,
  ListProjectsResult,
  ProjectItem,
  ProjectMeta,
  ProjectMetaSetRequest,
  ProjectMetaSetResult,
  TerminalLaunchListResult,
  TerminalLaunchRecord,
  TerminalLaunchRequest,
  TerminalLaunchResult,
  TerminalSessionInfo,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSessionInputState,
  TerminalSessionStatusEvent,
  SessionToolType,
  TerminalSessionOutputChunk
} from "../src/types/ipc.js";

type Settings = {
  projectRoot?: string;
  projectMetaByPath: Record<string, ProjectMeta>;
  terminalLaunches: TerminalLaunchRecord[];
  terminalSessionSnapshots: TerminalSessionSnapshot[];
};

type RuntimeSession = {
  info: TerminalSessionInfo;
  ptyProcess: IPty;
  outputBuffer: string[];
  allowDangerousForSession: boolean;
  commandInputBuffer: string;
  pendingInputChunks: string[];
  isFlushingInput: boolean;
  pendingApproval?: {
    request: TerminalApprovalRequest;
    data: string;
  };
};

const SETTINGS_SAVE_DEBOUNCE_MS = 400;
const TERMINAL_LAUNCH_MAX = 300;
const SESSION_SNAPSHOT_MAX = 20;
const SESSION_OUTPUT_LINE_MAX = 5000;
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b(?=[^\n\r]*\s-(?:[^\n\r]*r[^\n\r]*f|[^\n\r]*f[^\n\r]*r))(?=[^\n\r]*\s\S+)/i,
  /\bdel\b.+\s\/f\b/i,
  /\brmdir\b.+\s\/s\b/i,
  /\bformat\b\s+[a-z]:/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b.+\s-f/i,
  /\bshutdown\b/i
];

let currentRootPath = process.env.PROJECT_ROOT || process.cwd();
let settingsState: Settings = {
  projectRoot: currentRootPath,
  projectMetaByPath: {},
  terminalLaunches: [],
  terminalSessionSnapshots: []
};
let saveTimer: NodeJS.Timeout | null = null;
let saveInFlight: Promise<void> | null = null;
let launchPruneTimer: NodeJS.Timeout | null = null;
const runtimeSessions = new Map<string, RuntimeSession>();
let mainWindowRef: BrowserWindow | null = null;

const getSettingsPath = (): string => path.join(app.getPath("userData"), "settings.json");
const getRuntimeLogPath = (): string => path.join(app.getPath("userData"), "runtime.log");

const appendRuntimeLog = (message: string): void => {
  try {
    fsSync.mkdirSync(path.dirname(getRuntimeLogPath()), { recursive: true });
    fsSync.appendFileSync(getRuntimeLogPath(), `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch {
    // Ignore logging failures.
  }
};

const sanitizeLaunches = (value: unknown): TerminalLaunchRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): TerminalLaunchRecord | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<TerminalLaunchRecord>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.projectPath !== "string" ||
        typeof candidate.projectName !== "string" ||
        (candidate.tool !== "codex" && candidate.tool !== "claude") ||
        typeof candidate.command !== "string" ||
        typeof candidate.createdAt !== "number"
      ) {
        return null;
      }
      return {
        id: candidate.id,
        projectPath: candidate.projectPath,
        projectName: candidate.projectName,
        tool: candidate.tool,
        command: candidate.command,
        createdAt: candidate.createdAt,
        processId:
          typeof candidate.processId === "number" && Number.isFinite(candidate.processId)
            ? candidate.processId
            : undefined,
        note: typeof candidate.note === "string" ? candidate.note : undefined
      };
    })
    .filter((item): item is TerminalLaunchRecord => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, TERMINAL_LAUNCH_MAX);
};

const sanitizeSessionStatus = (value: unknown): TerminalSessionStatus => {
  if (value === "starting" || value === "running" || value === "exited" || value === "error") {
    return value;
  }
  return "exited";
};

const sanitizeSessionSnapshots = (value: unknown): TerminalSessionSnapshot[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): TerminalSessionSnapshot | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<TerminalSessionSnapshot>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.projectPath !== "string" ||
        typeof candidate.projectName !== "string" ||
        (candidate.tool !== "codex" && candidate.tool !== "claude" && candidate.tool !== "shell") ||
        typeof candidate.command !== "string" ||
        typeof candidate.createdAt !== "number" ||
        typeof candidate.updatedAt !== "number" ||
        typeof candidate.title !== "string"
      ) {
        return null;
      }
      return {
        id: candidate.id,
        projectPath: candidate.projectPath,
        projectName: candidate.projectName,
        tool: candidate.tool,
        command: candidate.command,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        status: sanitizeSessionStatus(candidate.status),
        title: candidate.title,
        outputPreview: Array.isArray(candidate.outputPreview)
          ? candidate.outputPreview
              .filter((line): line is string => typeof line === "string")
              .slice(-120)
          : []
      };
    })
    .filter((item): item is TerminalSessionSnapshot => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SESSION_SNAPSHOT_MAX);
};

const isReadableDirectory = async (dirPath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return false;
    }
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
};

const persistSettings = async (): Promise<void> => {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settingsState, null, 2), "utf-8");
};

const persistSettingsSync = (): void => {
  fsSync.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fsSync.writeFileSync(getSettingsPath(), JSON.stringify(settingsState, null, 2), "utf-8");
};

const schedulePersistSettings = (): void => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveInFlight = persistSettings().catch(() => {
      // Ignore background save failures; foreground actions return explicit errors.
    });
    saveTimer = null;
  }, SETTINGS_SAVE_DEBOUNCE_MS);
};

const flushSettingsPersist = async (): Promise<void> => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistSettings();
  if (saveInFlight) {
    await saveInFlight;
    saveInFlight = null;
  }
};

const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      projectRoot: parsed.projectRoot,
      projectMetaByPath: parsed.projectMetaByPath ?? {},
      terminalLaunches: sanitizeLaunches(parsed.terminalLaunches),
      terminalSessionSnapshots: sanitizeSessionSnapshots(parsed.terminalSessionSnapshots)
    };
  } catch {
    return {
      projectRoot: undefined,
      projectMetaByPath: {},
      terminalLaunches: [],
      terminalSessionSnapshots: []
    };
  }
};

const initRootPath = async (): Promise<void> => {
  settingsState = await loadSettings();
  const candidate = settingsState.projectRoot;
  if (candidate && (await isReadableDirectory(candidate))) {
    currentRootPath = candidate;
  }
  settingsState.projectRoot = currentRootPath;
  settingsState.terminalLaunches = sanitizeLaunches(settingsState.terminalLaunches);
  settingsState.terminalSessionSnapshots = sanitizeSessionSnapshots(settingsState.terminalSessionSnapshots);
  await flushSettingsPersist();
};

const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0a0f1c",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  let shown = false;
  mainWindow.once("ready-to-show", () => {
    shown = true;
    mainWindow.show();
  });
  setTimeout(() => {
    if (!shown && !mainWindow.isDestroyed()) {
      appendRuntimeLog("ready-to-show timeout, forcing show()");
      mainWindow.show();
    }
  }, 2500);

  const showStartupError = (reason: string): void => {
    appendRuntimeLog(reason);
    const safeReason = reason.replace(/</g, "&lt;");
    const safeLogPath = getRuntimeLogPath().replace(/</g, "&lt;");
    const html = `<!doctype html><html><body style="font-family:Segoe UI;background:#0b1220;color:#d8e7ff;padding:16px;"><h2>Startup Error</h2><p>${safeReason}</p><p>Runtime log: ${safeLogPath}</p></body></html>`;
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    mainWindow.show();
  };

  mainWindow.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    showStartupError(`did-fail-load code=${code} desc=${description} url=${validatedUrl}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    showStartupError(`renderer gone reason=${details.reason} code=${details.exitCode}`);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    showStartupError(`preload error path=${preloadPath} message=${error?.message ?? "unknown"}`);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    if (process.env.OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  return mainWindow;
};

const listProjects = async (): Promise<ListProjectsResult> => {
  try {
    const entries = await fs.readdir(currentRootPath, { withFileTypes: true });
    const projects: ProjectItem[] = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const projectPath = path.join(currentRootPath, entry.name);
        return {
          name: entry.name,
          path: projectPath,
          meta: settingsState.projectMetaByPath[projectPath]
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return { ok: true, projects, rootPath: currentRootPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    return { ok: false, message, projects: [], rootPath: currentRootPath };
  }
};

const setRootPath = async (nextPath: string): Promise<ListProjectsResult> => {
  if (!(await isReadableDirectory(nextPath))) {
    return {
      ok: false,
      message: `Directory is not accessible: ${nextPath}`,
      projects: [],
      rootPath: currentRootPath
    };
  }

  const previousPath = currentRootPath;
  currentRootPath = nextPath;
  settingsState.projectRoot = nextPath;

  try {
    await flushSettingsPersist();
  } catch (error) {
    currentRootPath = previousPath;
    settingsState.projectRoot = previousPath;
    const message = error instanceof Error ? error.message : "Failed to save settings";
    return { ok: false, message, projects: [], rootPath: currentRootPath };
  }

  return listProjects();
};

const runGit = async (args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> => {
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

const ensureGitOrigin = async (projectPath: string, githubUrl: string): Promise<string | undefined> => {
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

const setProjectMeta = async (request: ProjectMetaSetRequest): Promise<ProjectMetaSetResult> => {
  const prev = settingsState.projectMetaByPath[request.projectPath] ?? {
    note: "",
    githubUrl: undefined,
    updatedAt: Date.now()
  };

  const next: ProjectMeta = {
    note: request.note !== undefined ? request.note : prev.note,
    githubUrl:
      request.githubUrl !== undefined
        ? request.githubUrl.trim() || undefined
        : prev.githubUrl,
    updatedAt: Date.now()
  };

  settingsState.projectMetaByPath[request.projectPath] = next;
  let warning: string | undefined;
  if (request.githubUrl !== undefined && next.githubUrl) {
    warning = await ensureGitOrigin(request.projectPath, next.githubUrl);
  }

  try {
    schedulePersistSettings();
    return { ok: true, meta: next, warning };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to save project metadata."
    };
  }
};

const commitAndPush = async (request: GitCommitRequest): Promise<GitCommitResult> => {
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

  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], request.projectPath);
  if (gitCheck.code !== 0) {
    return {
      ok: false,
      step: "validate",
      message: "Current project is not a git repository.",
      stdout: gitCheck.stdout,
      stderr: gitCheck.stderr
    };
  }

  const remoteCheck = await runGit(["remote", "get-url", "origin"], request.projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = settingsState.projectMetaByPath[request.projectPath]?.githubUrl;
    if (!maybeGithubUrl) {
      return {
        ok: false,
        step: "validate",
        message: "No git remote origin found. Set GitHub URL first.",
        stdout: remoteCheck.stdout,
        stderr: remoteCheck.stderr
      };
    }
    const warning = await ensureGitOrigin(request.projectPath, maybeGithubUrl);
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

  const currentBranchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], request.projectPath);
  if (currentBranchResult.code !== 0) {
    return {
      ok: false,
      step: "push",
      message: "Failed to resolve current branch.",
      stdout: currentBranchResult.stdout,
      stderr: currentBranchResult.stderr
    };
  }
  const currentBranch = currentBranchResult.stdout.trim();
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

const listGitUntrackedFiles = async (projectPath: string): Promise<GitUntrackedFilesResult> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], projectPath);
  if (gitCheck.code !== 0) {
    return { ok: false, message: "Current project is not a git repository.", files: [] };
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

const gitAdd = async (request: GitAddRequest): Promise<GitAddResult> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], request.projectPath);
  if (gitCheck.code !== 0) {
    return {
      ok: false,
      message: "Current project is not a git repository.",
      stdout: gitCheck.stdout,
      stderr: gitCheck.stderr
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

const gitPull = async (request: GitPullRequest): Promise<GitPullResult> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], request.projectPath);
  if (gitCheck.code !== 0) {
    return {
      ok: false,
      message: "Current project is not a git repository.",
      stdout: gitCheck.stdout,
      stderr: gitCheck.stderr
    };
  }

  const remoteCheck = await runGit(["remote", "get-url", "origin"], request.projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = settingsState.projectMetaByPath[request.projectPath]?.githubUrl;
    if (!maybeGithubUrl) {
      return {
        ok: false,
        message: "No git remote origin found. Set GitHub URL first.",
        stdout: remoteCheck.stdout,
        stderr: remoteCheck.stderr
      };
    }
    const warning = await ensureGitOrigin(request.projectPath, maybeGithubUrl);
    if (warning) {
      return {
        ok: false,
        message: `Failed to configure origin: ${warning}`,
        stdout: "",
        stderr: warning
      };
    }
  }

  const currentBranchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], request.projectPath);
  if (currentBranchResult.code !== 0) {
    return {
      ok: false,
      message: "Failed to resolve current branch.",
      stdout: currentBranchResult.stdout,
      stderr: currentBranchResult.stderr
    };
  }
  const remoteBranch = (request.remoteBranch || currentBranchResult.stdout.trim()).trim();
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

const listGitBranches = async (projectPath: string): Promise<GitBranchesResult> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], projectPath);
  if (gitCheck.code !== 0) {
    return { ok: false, message: "Current project is not a git repository.", currentBranch: "", branches: [] };
  }

  const currentBranchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], projectPath);
  if (currentBranchResult.code !== 0) {
    return {
      ok: false,
      message: currentBranchResult.stderr || "Failed to read current branch.",
      currentBranch: "",
      branches: []
    };
  }
  const currentBranch = currentBranchResult.stdout.trim();

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
  if (currentBranch && branches.includes(currentBranch)) {
    branches.splice(branches.indexOf(currentBranch), 1);
    branches.unshift(currentBranch);
  }

  return {
    ok: true,
    currentBranch,
    branches
  };
};

const getRemoteHistory = async (projectPath: string): Promise<GitRemoteHistoryResult> => {
  const gitCheck = await runGit(["rev-parse", "--is-inside-work-tree"], projectPath);
  if (gitCheck.code !== 0) {
    return { ok: false, message: "Current project is not a git repository." };
  }

  const remoteCheck = await runGit(["remote", "get-url", "origin"], projectPath);
  if (remoteCheck.code !== 0) {
    const maybeGithubUrl = settingsState.projectMetaByPath[projectPath]?.githubUrl;
    if (!maybeGithubUrl) {
      return { ok: false, message: "No git remote origin found. Set GitHub URL first." };
    }
    const warning = await ensureGitOrigin(projectPath, maybeGithubUrl);
    if (warning) {
      return { ok: false, message: `Failed to configure origin: ${warning}` };
    }
  }

  await runGit(["fetch", "origin", "--prune"], projectPath);

  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], projectPath);
  if (branch.code !== 0) {
    return { ok: false, message: branch.stderr || "Failed to read current branch." };
  }
  const branchName = branch.stdout.trim();
  const upstreamRefResult = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    projectPath
  );
  const upstreamRef =
    upstreamRefResult.code === 0 && upstreamRefResult.stdout.trim()
      ? upstreamRefResult.stdout.trim()
      : `origin/${branchName}`;

  const localHeadResult = await runGit(["rev-parse", "HEAD"], projectPath);
  const remoteHeadResult = await runGit(["rev-parse", upstreamRef], projectPath);
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
    commits
  };
};

const buildToolBootstrapCommand = (tool: "codex" | "claude"): string => {
  return `if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} } else { Write-Host "[ERROR] Command '${tool}' not found in PATH." }`;
};

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
};

const resolvePowerShellCandidates = (): string[] => {
  const candidates: string[] = [];

  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    candidates.push(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  }

  const whereResult = spawnSync("where", ["powershell.exe"], {
    windowsHide: true,
    encoding: "utf-8"
  });
  if (whereResult.status === 0 && whereResult.stdout) {
    for (const line of whereResult.stdout.split(/\r?\n/)) {
      const resolved = line.trim();
      if (resolved.length > 0) {
        candidates.push(resolved);
      }
    }
  }

  candidates.push("powershell.exe");

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of candidates) {
    const key = process.platform === "win32" ? item.toLowerCase() : item;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(item);
    }
  }
  return normalized;
};

const probePowerShellCommand = (candidate: string): { ok: boolean; reason?: string } => {
  const result = spawnSync(
    candidate,
    ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 2500
    }
  );
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  if (typeof result.status === "number") {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `signal=${result.signal ?? "unknown"}`
  };
};

const resolvePowerShellPath = (): string | null => {
  const candidates = resolvePowerShellCandidates();
  const probeLogs: string[] = [];
  for (const candidate of candidates) {
    if (candidate !== "powershell.exe" && !fsSync.existsSync(candidate)) {
      probeLogs.push(`${candidate} => missing`);
      continue;
    }
    const probe = probePowerShellCommand(candidate);
    if (probe.ok) {
      appendRuntimeLog(`powershell resolved via '${candidate}'`);
      return candidate;
    }
    probeLogs.push(`${candidate} => ${probe.reason ?? "probe failed"}`);
  }
  appendRuntimeLog(`powershell resolution failed. probes: ${probeLogs.join(" | ")}`);
  return null;
};

const listTerminalLaunches = (): TerminalLaunchListResult => {
  return {
    ok: true,
    launches: [...settingsState.terminalLaunches].sort((a, b) => b.createdAt - a.createdAt)
  };
};

const focusTerminalLaunch = (recordId: string): { ok: true } | { ok: false; message: string } => {
  const record = settingsState.terminalLaunches.find((item) => item.id === recordId);
  if (!record) {
    return { ok: false, message: "Launch record not found." };
  }
  if (!record.processId || !Number.isInteger(record.processId)) {
    return { ok: false, message: "This launch record has no process id." };
  }
  if (!isProcessAlive(record.processId)) {
    settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => item.id !== recordId);
    schedulePersistSettings();
    return { ok: false, message: "Terminal process has already exited." };
  }

  const powerShellPath = resolvePowerShellPath();
  if (!powerShellPath) {
    return { ok: false, message: "Windows PowerShell is unavailable for AppActivate." };
  }
  const focusScript = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$ok = $shell.AppActivate(${record.processId})`,
    "if ($ok) { exit 0 }",
    "exit 2"
  ].join("; ");
  const result = spawnSync(powerShellPath, ["-NoLogo", "-NoProfile", "-Command", focusScript], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 2500
  });
  if (result.error) {
    return { ok: false, message: `Failed to focus terminal: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { ok: false, message: "Failed to bring terminal window to front." };
  }
  return { ok: true };
};

const closeTerminalProcess = (pid: number): { ok: true } | { ok: false; message: string } => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, message: "Invalid terminal process id." };
  }
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 5000
  });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    const stderrText = (result.stderr || result.stdout || "").trim();
    const lower = stderrText.toLowerCase();
    if (
      lower.includes("not found") ||
      lower.includes("no running instance") ||
      lower.includes("not running")
    ) {
      return { ok: true };
    }
    return { ok: false, message: stderrText || "taskkill failed." };
  }
  return { ok: true };
};

const removeTerminalLaunch = (recordId: string): { ok: true } | { ok: false; message: string } => {
  const record = settingsState.terminalLaunches.find((item) => item.id === recordId);
  if (!record) {
    return { ok: false, message: "Launch record not found." };
  }
  if (record.processId && isProcessAlive(record.processId)) {
    const killResult = closeTerminalProcess(record.processId);
    if (!killResult.ok) {
      return { ok: false, message: `Failed to close terminal: ${killResult.message}` };
    }
  }
  settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => item.id !== recordId);
  schedulePersistSettings();
  return { ok: true };
};

const setTerminalLaunchNote = (
  recordId: string,
  note: string
): { ok: true; record: TerminalLaunchRecord } | { ok: false; message: string } => {
  const index = settingsState.terminalLaunches.findIndex((item) => item.id === recordId);
  if (index < 0) {
    return { ok: false, message: "Launch record not found." };
  }
  const normalizedNote = note.trim();
  const updated: TerminalLaunchRecord = {
    ...settingsState.terminalLaunches[index],
    note: normalizedNote.length > 0 ? normalizedNote : undefined
  };
  settingsState.terminalLaunches[index] = updated;
  schedulePersistSettings();
  return { ok: true, record: updated };
};

const pruneClosedLaunches = (): void => {
  const prevLength = settingsState.terminalLaunches.length;
  settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => {
    if (!item.processId) {
      return true;
    }
    return isProcessAlive(item.processId);
  });
  if (settingsState.terminalLaunches.length !== prevLength) {
    schedulePersistSettings();
  }
};

const launchPowerShellWindow = (
  powerShellPath: string,
  projectPath: string,
  encodedCommand: string
): { ok: true; pid: number } | { ok: false; message: string } => {
  const escapedExe = powerShellPath.replace(/'/g, "''");
  const escapedCwd = projectPath.replace(/'/g, "''");
  const launchScript = [
    `$argList = @('-NoLogo','-NoExit','-EncodedCommand','${encodedCommand}')`,
    `$p = Start-Process -FilePath '${escapedExe}' -WorkingDirectory '${escapedCwd}' -ArgumentList $argList -PassThru`,
    "$p.Id"
  ].join("; ");
  const result = spawnSync(powerShellPath, ["-NoLogo", "-NoProfile", "-Command", launchScript], {
    windowsHide: true,
    encoding: "utf-8",
    timeout: 5000
  });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    const stderrText = (result.stderr || result.stdout || "").trim();
    return { ok: false, message: stderrText || "Start-Process failed." };
  }
  const pidText = (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d+$/.test(line));
  if (!pidText) {
    return { ok: false, message: "Could not read started process id." };
  }
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, message: "Invalid started process id." };
  }
  return { ok: true, pid };
};

const launchTerminal = (request: TerminalLaunchRequest): TerminalLaunchResult => {
  const powerShellPath = resolvePowerShellPath();
  if (!powerShellPath) {
    return {
      ok: false,
      code: "POWERSHELL_NOT_FOUND",
      message:
        "Windows PowerShell (powershell.exe) was not found. Check system PATH and restart the app."
    };
  }

  const escapedTitle = `${request.projectName} - ${request.tool}`.replace(/'/g, "''");
  const command = `$Host.UI.RawUI.WindowTitle='${escapedTitle}'; ${buildToolBootstrapCommand(request.tool)}`;
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");

  try {
    const launchResult = launchPowerShellWindow(powerShellPath, request.projectPath, encodedCommand);
    if (!launchResult.ok) {
      return {
        ok: false,
        code: "LAUNCH_FAILED",
        message: `Failed to start Windows PowerShell process: ${launchResult.message}`
      };
    }

    const inheritedNote =
      settingsState.terminalLaunches.find(
        (item) =>
          item.projectPath === request.projectPath &&
          item.tool === request.tool &&
          typeof item.note === "string" &&
          item.note.trim().length > 0
      )?.note ?? undefined;

    const record: TerminalLaunchRecord = {
      id: crypto.randomUUID(),
      projectPath: request.projectPath,
      projectName: request.projectName,
      tool: request.tool,
      command: command,
      createdAt: Date.now(),
      processId: launchResult.pid,
      note: inheritedNote
    };
    settingsState.terminalLaunches = [record, ...settingsState.terminalLaunches].slice(
      0,
      TERMINAL_LAUNCH_MAX
    );
    schedulePersistSettings();
    return { ok: true, record };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown launch failure.";
    appendRuntimeLog(`powershell launch failed: ${message}`);
    return {
      ok: false,
      code: "LAUNCH_FAILED",
      message: `Failed to launch Windows PowerShell: ${message}`
    };
  }
};

const sendIpcEvent = <T,>(channel: string, payload: T): void => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }
  mainWindowRef.webContents.send(channel, payload);
};

const pushSessionOutput = (sessionId: string, stream: "stdout" | "stderr" | "system", data: string): void => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    return;
  }
  runtime.outputBuffer.push(...data.split(/\r?\n/));
  if (runtime.outputBuffer.length > SESSION_OUTPUT_LINE_MAX) {
    runtime.outputBuffer = runtime.outputBuffer.slice(-SESSION_OUTPUT_LINE_MAX);
  }
  const chunk: TerminalSessionOutputChunk = {
    sessionId,
    data,
    stream,
    timestamp: Date.now()
  };
  sendIpcEvent(IpcChannels.TerminalSessionOutputEvent, chunk);
};

const emitSessionStatus = (sessionId: string, status: TerminalSessionStatus, message?: string): void => {
  const runtime = runtimeSessions.get(sessionId);
  if (runtime) {
    runtime.info.status = status;
  }
  const event: TerminalSessionStatusEvent = {
    sessionId,
    status,
    message,
    timestamp: Date.now()
  };
  sendIpcEvent(IpcChannels.TerminalSessionStatusEvent, event);
};

const emitInputState = (
  sessionId: string,
  state: TerminalSessionInputState["state"],
  queueLength: number,
  message?: string
): void => {
  const event: TerminalSessionInputState = {
    sessionId,
    state,
    queueLength,
    message,
    timestamp: Date.now()
  };
  sendIpcEvent(IpcChannels.TerminalSessionInputStateEvent, event);
};

const flushSessionInputQueue = (sessionId: string): void => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime || runtime.isFlushingInput) {
    return;
  }
  runtime.isFlushingInput = true;
  emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
  try {
    while (runtime.pendingInputChunks.length > 0) {
      const nextChunk = runtime.pendingInputChunks.shift();
      if (!nextChunk) {
        continue;
      }
      runtime.ptyProcess.write(nextChunk);
      emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
    }
    emitInputState(sessionId, "idle", 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to flush terminal input.";
    emitInputState(sessionId, "error", runtime.pendingInputChunks.length, message);
  } finally {
    runtime.isFlushingInput = false;
  }
};

const upsertSessionSnapshot = (info: TerminalSessionInfo, outputBuffer: string[]): void => {
  const snapshot: TerminalSessionSnapshot = {
    id: info.id,
    projectPath: info.projectPath,
    projectName: info.projectName,
    tool: info.tool,
    command: info.command,
    createdAt: info.createdAt,
    updatedAt: Date.now(),
    status: info.status,
    title: info.title,
    outputPreview: outputBuffer.slice(-120)
  };
  const next = [
    snapshot,
    ...settingsState.terminalSessionSnapshots.filter((item) => item.id !== snapshot.id)
  ].slice(0, SESSION_SNAPSHOT_MAX);
  settingsState.terminalSessionSnapshots = next;
  schedulePersistSettings();
};

const buildSessionBootstrapCommand = (tool: SessionToolType): string => {
  const utf8Setup = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "chcp 65001 > $null"
  ].join("; ");
  if (tool === "shell") {
    return utf8Setup;
  }
  return `${utf8Setup}; if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} } else { Write-Host "[ERROR] Command '${tool}' not found in PATH." }`;
};

const looksDangerousCommand = (data: string): boolean => {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed));
};

const applyForwardedInputToBuffer = (runtime: RuntimeSession, data: string): void => {
  for (const char of data) {
    if (char === "\r" || char === "\n") {
      runtime.commandInputBuffer = "";
    } else {
      runtime.commandInputBuffer += char;
    }
  }
};

const analyzeInputForApproval = (
  runtime: RuntimeSession,
  data: string
):
  | { mode: "forward"; forwardData: string }
  | {
      mode: "block";
      forwardData: string;
      blockedData: string;
      command: string;
      nextCommandInputBuffer: string;
    } => {
  if (!data.includes("\r") && !data.includes("\n")) {
    return { mode: "forward", forwardData: data };
  }

  const previousBuffer = runtime.commandInputBuffer;
  let lineBuffer = previousBuffer;
  let lineStartInChunk = 0;

  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];
    if (char === "\r" || char === "\n") {
      const command = lineBuffer.trim();
      if (looksDangerousCommand(command)) {
        const forwardData = data.slice(0, lineStartInChunk);
        const blockedData = data.slice(lineStartInChunk);
        const nextCommandInputBuffer = lineStartInChunk === 0 ? previousBuffer : "";
        return {
          mode: "block",
          forwardData,
          blockedData,
          command,
          nextCommandInputBuffer
        };
      }
      lineBuffer = "";
      lineStartInChunk = i + 1;
      continue;
    }
    lineBuffer += char;
  }
  return { mode: "forward", forwardData: data };
};

const createTerminalSession = (request: {
  projectPath: string;
  projectName: string;
  tool: SessionToolType;
}): { ok: true; session: TerminalSessionInfo } | { ok: false; message: string } => {
  const powerShellPath = resolvePowerShellPath();
  if (!powerShellPath) {
    return {
      ok: false,
      message: "Windows PowerShell (powershell.exe) was not found. Check system PATH and restart the app."
    };
  }
  if (!fsSync.existsSync(request.projectPath)) {
    return { ok: false, message: `Project path not found: ${request.projectPath}` };
  }

  const command = buildSessionBootstrapCommand(request.tool);
  const args = ["-NoLogo", "-NoExit"];
  if (command) {
    args.push("-Command", command);
  }
  const title = `${request.projectName} - ${request.tool}`;

  try {
    const ptyProcess = spawnPty(powerShellPath, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: request.projectPath,
      env: process.env as Record<string, string>,
      useConpty: true
    });
    const session: TerminalSessionInfo = {
      id: crypto.randomUUID(),
      projectPath: request.projectPath,
      projectName: request.projectName,
      tool: request.tool,
      command: command || "powershell",
      createdAt: Date.now(),
      processId: ptyProcess.pid,
      status: "running",
      title
    };
    const runtime: RuntimeSession = {
      info: session,
      ptyProcess,
      outputBuffer: [],
      allowDangerousForSession: false,
      commandInputBuffer: "",
      pendingInputChunks: [],
      isFlushingInput: false
    };
    runtimeSessions.set(session.id, runtime);
    upsertSessionSnapshot(session, runtime.outputBuffer);

    emitSessionStatus(session.id, "running");
    emitInputState(session.id, "idle", 0);
    ptyProcess.onData((chunk: string) => {
      pushSessionOutput(session.id, "stdout", chunk);
      upsertSessionSnapshot(runtime.info, runtime.outputBuffer);
    });
    ptyProcess.onExit((event) => {
      const runtimeEntry = runtimeSessions.get(session.id);
      if (runtimeEntry) {
        runtimeEntry.info.status = event.exitCode === 0 ? "exited" : "error";
        pushSessionOutput(
          session.id,
          "system",
          `\n[session closed] code=${event.exitCode} signal=${event.signal}\n`
        );
        emitSessionStatus(session.id, runtimeEntry.info.status);
        emitInputState(
          session.id,
          runtimeEntry.info.status === "error" ? "error" : "idle",
          runtimeEntry.pendingInputChunks.length
        );
        upsertSessionSnapshot(runtimeEntry.info, runtimeEntry.outputBuffer);
      }
      runtimeSessions.delete(session.id);
    });

    return { ok: true, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start terminal session.";
    return { ok: false, message };
  }
};

const listTerminalSessions = (): { ok: true; sessions: TerminalSessionInfo[] } => {
  const sessions = [...runtimeSessions.values()]
    .map((item) => item.info)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { ok: true, sessions };
};

const inputTerminalSession = (
  sessionId: string,
  data: string
): { ok: true; accepted?: boolean; queueLength?: number } | { ok: false; message: string; code?: "APPROVAL_REQUIRED" } => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    return { ok: false, message: "Session not found." };
  }
  if (runtime.pendingApproval) {
    emitInputState(sessionId, "blocked", 0, "Pending approval exists for this session.");
    return { ok: false, message: "Pending approval exists for this session.", code: "APPROVAL_REQUIRED" };
  }

  if (runtime.allowDangerousForSession) {
    runtime.pendingInputChunks.push(data);
    applyForwardedInputToBuffer(runtime, data);
    emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
    flushSessionInputQueue(sessionId);
    return { ok: true, accepted: true, queueLength: runtime.pendingInputChunks.length };
  }

  const inspection = analyzeInputForApproval(runtime, data);
  if (inspection.mode === "block") {
    if (inspection.forwardData) {
      runtime.pendingInputChunks.push(inspection.forwardData);
      applyForwardedInputToBuffer(runtime, inspection.forwardData);
      flushSessionInputQueue(sessionId);
    }
    const request: TerminalApprovalRequest = {
      requestId: crypto.randomUUID(),
      sessionId,
      command: inspection.command,
      createdAt: Date.now()
    };
    runtime.commandInputBuffer = inspection.nextCommandInputBuffer;
    runtime.pendingApproval = { request, data: inspection.blockedData };
    sendIpcEvent(IpcChannels.TerminalApprovalRequiredEvent, request);
    pushSessionOutput(sessionId, "system", `[approval required] ${request.command}\n`);
    emitInputState(sessionId, "blocked", 0, "Approval required.");
    return { ok: false, message: "Approval required.", code: "APPROVAL_REQUIRED" };
  }

  runtime.pendingInputChunks.push(inspection.forwardData);
  applyForwardedInputToBuffer(runtime, inspection.forwardData);
  emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
  flushSessionInputQueue(sessionId);
  return { ok: true, accepted: true, queueLength: runtime.pendingInputChunks.length };
};

const submitTerminalApproval = (
  sessionId: string,
  requestId: string,
  decision: TerminalApprovalDecision
): { ok: true } | { ok: false; message: string } => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime || !runtime.pendingApproval) {
    return { ok: false, message: "No pending approval for this session." };
  }
  if (runtime.pendingApproval.request.requestId !== requestId) {
    return { ok: false, message: "Approval request id mismatch." };
  }
  const pending = runtime.pendingApproval;
  runtime.pendingApproval = undefined;

  if (decision === "deny") {
    pushSessionOutput(sessionId, "system", "[blocked] command denied by approval policy.\n");
    emitInputState(sessionId, "idle", 0, "Command denied by approval policy.");
    return { ok: true };
  }
  if (decision === "allow_session") {
    runtime.allowDangerousForSession = true;
  }
  runtime.pendingInputChunks.push(pending.data);
  applyForwardedInputToBuffer(runtime, pending.data);
  emitInputState(sessionId, "sending", runtime.pendingInputChunks.length, "Approval granted.");
  flushSessionInputQueue(sessionId);
  pushSessionOutput(sessionId, "system", "[approved] command sent.\n");
  return { ok: true };
};

const closeTerminalSession = (
  sessionId: string,
  force: boolean
): { ok: true } | { ok: false; message: string } => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    return { ok: false, message: "Session not found." };
  }

  try {
    if (runtime.info.processId) {
      const killed = closeTerminalProcess(runtime.info.processId);
      if (!killed.ok && force) {
        return { ok: false, message: killed.message };
      }
      if (!killed.ok) {
        runtime.ptyProcess.kill();
      }
    } else {
      runtime.ptyProcess.kill();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to terminate session.";
    return { ok: false, message };
  }

  runtime.info.status = "exited";
  upsertSessionSnapshot(runtime.info, runtime.outputBuffer);
  runtimeSessions.delete(sessionId);
  emitSessionStatus(sessionId, "exited");
  emitInputState(sessionId, "idle", 0);
  return { ok: true };
};

const resizeTerminalSession = (
  sessionId: string,
  cols: number,
  rows: number
): { ok: true } | { ok: false; message: string } => {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    return { ok: false, message: "Session not found." };
  }
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 20 || rows < 5) {
    return { ok: false, message: "Invalid terminal size." };
  }
  try {
    runtime.ptyProcess.resize(Math.floor(cols), Math.floor(rows));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resize terminal.";
    return { ok: false, message };
  }
};

const listTerminalSessionSnapshots = (): { ok: true; snapshots: TerminalSessionSnapshot[] } => {
  return {
    ok: true,
    snapshots: [...settingsState.terminalSessionSnapshots].sort((a, b) => b.updatedAt - a.updatedAt)
  };
};

const closeAllRuntimeSessions = (): void => {
  for (const [sessionId, runtime] of runtimeSessions.entries()) {
    if (runtime.info.processId) {
      closeTerminalProcess(runtime.info.processId);
    } else {
      runtime.ptyProcess.kill();
    }
    runtime.info.status = "exited";
    upsertSessionSnapshot(runtime.info, runtime.outputBuffer);
    emitInputState(sessionId, "idle", 0);
    runtimeSessions.delete(sessionId);
  }
};

const registerIpc = (mainWindow: BrowserWindow): void => {
  mainWindowRef = mainWindow;
  ipcMain.handle(IpcChannels.RootGet, async () => ({ rootPath: currentRootPath }));

  ipcMain.handle(IpcChannels.RootSet, async (_event, payload: { path: string }) =>
    setRootPath(payload.path)
  );

  ipcMain.handle(IpcChannels.ListProjects, async () => listProjects());

  ipcMain.handle(IpcChannels.ProjectMetaSet, async (_event, payload: ProjectMetaSetRequest) =>
    setProjectMeta(payload)
  );

  ipcMain.handle(IpcChannels.GitCommitAndPush, async (_event, payload: GitCommitRequest) =>
    commitAndPush(payload)
  );

  ipcMain.handle(IpcChannels.GitRemoteHistory, async (_event, payload: { projectPath: string }) =>
    getRemoteHistory(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.GitBranches, async (_event, payload: { projectPath: string }) =>
    listGitBranches(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.GitAdd, async (_event, payload: GitAddRequest) =>
    gitAdd(payload)
  );

  ipcMain.handle(IpcChannels.GitPull, async (_event, payload: GitPullRequest) =>
    gitPull(payload)
  );

  ipcMain.handle(IpcChannels.GitUntrackedFiles, async (_event, payload: { projectPath: string }) =>
    listGitUntrackedFiles(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.DialogPickDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      defaultPath: currentRootPath
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle(
    IpcChannels.TerminalLaunch,
    async (_event, request: TerminalLaunchRequest): Promise<TerminalLaunchResult> =>
      launchTerminal(request)
  );

  ipcMain.handle(
    IpcChannels.TerminalLaunchesList,
    async (): Promise<TerminalLaunchListResult> => listTerminalLaunches()
  );

  ipcMain.handle(
    IpcChannels.TerminalLaunchesFocus,
    async (_event, payload: { recordId: string }): Promise<{ ok: true } | { ok: false; message: string }> =>
      focusTerminalLaunch(payload.recordId)
  );

  ipcMain.handle(
    IpcChannels.TerminalLaunchesNoteSet,
    async (
      _event,
      payload: { recordId: string; note: string }
    ): Promise<{ ok: true; record: TerminalLaunchRecord } | { ok: false; message: string }> =>
      setTerminalLaunchNote(payload.recordId, payload.note)
  );

  ipcMain.handle(
    IpcChannels.TerminalLaunchesRemove,
    async (_event, payload: { recordId: string }): Promise<{ ok: true } | { ok: false; message: string }> =>
      removeTerminalLaunch(payload.recordId)
  );

  ipcMain.handle(
    IpcChannels.TerminalSessionCreate,
    async (_event, payload: { projectPath: string; projectName: string; tool: SessionToolType }) =>
      createTerminalSession(payload)
  );

  ipcMain.handle(
    IpcChannels.TerminalSessionInput,
    async (_event, payload: { sessionId: string; data: string }) =>
      inputTerminalSession(payload.sessionId, payload.data)
  );

  ipcMain.handle(
    IpcChannels.TerminalSessionResize,
    async (_event, payload: { sessionId: string; cols: number; rows: number }) =>
      resizeTerminalSession(payload.sessionId, payload.cols, payload.rows)
  );

  ipcMain.handle(
    IpcChannels.TerminalSessionClose,
    async (_event, payload: { sessionId: string; force?: boolean }) =>
      closeTerminalSession(payload.sessionId, !!payload.force)
  );

  ipcMain.handle(IpcChannels.TerminalSessionList, async () => listTerminalSessions());

  ipcMain.handle(IpcChannels.TerminalSessionRestoreList, async () => listTerminalSessionSnapshots());

  ipcMain.handle(
    IpcChannels.TerminalApprovalSubmit,
    async (
      _event,
      payload: { sessionId: string; requestId: string; decision: TerminalApprovalDecision }
    ) => submitTerminalApproval(payload.sessionId, payload.requestId, payload.decision)
  );

  ipcMain.handle(IpcChannels.WindowMinimize, async () => {
    mainWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowMaximize, async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowClose, async () => {
    mainWindow.close();
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowIsMaximized, async () => {
    return { isMaximized: mainWindow.isMaximized() };
  });
};

app.whenReady().then(async () => {
  await initRootPath();
  const mainWindow = createMainWindow();
  registerIpc(mainWindow);
  launchPruneTimer = setInterval(pruneClosedLaunches, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowRef = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (launchPruneTimer) {
    clearInterval(launchPruneTimer);
    launchPruneTimer = null;
  }
  closeAllRuntimeSessions();
  try {
    persistSettingsSync();
  } catch {
    // Ignore flush failures at shutdown.
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeAllRuntimeSessions();
  try {
    persistSettingsSync();
  } catch {
    // Ignore flush failures at shutdown.
  }
});
