import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as pty from "node-pty";
import {
  ConversationEntry,
  GitCommitRequest,
  GitCommitResult,
  GitRemoteHistoryResult,
  IpcChannels,
  ListProjectsResult,
  ProjectHealthBuildStatus,
  ProjectHealthItem,
  ProjectHealthRequest,
  ProjectHealthResult,
  ProjectHealthRisk,
  ProjectItem,
  ProjectMeta,
  ProjectMetaSetRequest,
  ProjectMetaSetResult,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalErrorEvent,
  TerminalExitEvent
} from "../src/types/ipc.js";

type TerminalSession = {
  id: string;
  ptyProcess: pty.IPty;
  projectPath: string;
  tool: "codex" | "claude";
};

type Settings = {
  projectRoot?: string;
  projectMetaByPath: Record<string, ProjectMeta>;
  conversationByPath: Record<string, ConversationEntry[]>;
};

const sessions = new Map<string, TerminalSession>();
const inputBuffers = new Map<string, string>();
const SETTINGS_SAVE_DEBOUNCE_MS = 400;
const CONVERSATION_MAX_PER_PROJECT = 800;
const HEALTH_BUILD_TIMEOUT_MS = 60_000;
const HEALTH_CONCURRENCY = 3;

let currentRootPath = process.env.PROJECT_ROOT || process.cwd();
let settingsState: Settings = {
  projectRoot: currentRootPath,
  projectMetaByPath: {},
  conversationByPath: {}
};
let saveTimer: NodeJS.Timeout | null = null;
let saveInFlight: Promise<void> | null = null;

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
      conversationByPath: parsed.conversationByPath ?? {}
    };
  } catch {
    return {
      projectRoot: undefined,
      projectMetaByPath: {},
      conversationByPath: {}
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
  await flushSettingsPersist();
};

const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
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

const runCommand = async (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const close = (result: { code: number; stdout: string; stderr: string; timedOut: boolean }): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill();
            } catch {
              // Ignore kill race.
            }
            close({
              code: 1,
              stdout,
              stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms.`,
              timedOut: true
            });
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      close({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut: false
      });
    });
    child.on("close", (code) => {
      close({ code: code ?? 1, stdout, stderr, timedOut: false });
    });
  });
};

const runGit = async (
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> => {
  return runCommand("git", args, cwd, timeoutMs);
};

type PackageManifest = {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
};

type PackageManifestState = {
  hasManifest: boolean;
  manifest: PackageManifest | null;
  parseError?: string;
};

const readPackageManifest = async (projectPath: string): Promise<PackageManifestState> => {
  const manifestPath = path.join(projectPath, "package.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as PackageManifest;
      return {
        hasManifest: true,
        manifest: parsed
      };
    } catch (error) {
      return {
        hasManifest: true,
        manifest: null,
        parseError: error instanceof Error ? error.message : "Failed to parse package.json."
      };
    }
  } catch {
    return {
      hasManifest: false,
      manifest: null
    };
  }
};

const countManifestDependencies = (manifest: PackageManifest): number => {
  const buckets = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies
  ];
  return buckets.reduce((sum, bucket) => {
    if (!bucket || typeof bucket !== "object") {
      return sum;
    }
    return sum + Object.keys(bucket).length;
  }, 0);
};

const hasFile = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
};

const detectBuildCommand = async (
  projectPath: string
): Promise<{ command: string; args: string[]; label: string }> => {
  const [hasPnpmLock, hasYarnLock, hasBunLockb, hasBunLock] = await Promise.all([
    hasFile(path.join(projectPath, "pnpm-lock.yaml")),
    hasFile(path.join(projectPath, "yarn.lock")),
    hasFile(path.join(projectPath, "bun.lockb")),
    hasFile(path.join(projectPath, "bun.lock"))
  ]);

  if (hasPnpmLock) {
    return {
      command: "pnpm",
      args: ["run", "build"],
      label: "pnpm run build"
    };
  }
  if (hasYarnLock) {
    return {
      command: "yarn",
      args: ["build"],
      label: "yarn build"
    };
  }
  if (hasBunLockb || hasBunLock) {
    return {
      command: "bun",
      args: ["run", "build"],
      label: "bun run build"
    };
  }
  return {
    command: "npm",
    args: ["run", "build", "--if-present"],
    label: "npm run build --if-present"
  };
};

const toOneLineMessage = (value: string, fallback: string): string => {
  const firstLine =
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) {
    return fallback;
  }
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
};

const evaluateBuildHealth = async (
  projectPath: string,
  manifestState: PackageManifestState,
  includeBuildCheck: boolean
): Promise<{ buildStatus: ProjectHealthBuildStatus; buildMessage?: string }> => {
  if (!manifestState.hasManifest) {
    return {
      buildStatus: "missing_manifest",
      buildMessage: "No package.json"
    };
  }
  if (!manifestState.manifest) {
    return {
      buildStatus: "unknown",
      buildMessage: manifestState.parseError ?? "Invalid package.json"
    };
  }
  const buildScript = manifestState.manifest.scripts?.build;
  if (typeof buildScript !== "string" || buildScript.trim().length === 0) {
    return {
      buildStatus: "missing_script",
      buildMessage: "No build script"
    };
  }
  if (!includeBuildCheck) {
    return {
      buildStatus: "skipped",
      buildMessage: "Build check skipped"
    };
  }

  const buildCommand = await detectBuildCommand(projectPath);
  const run = await runCommand(
    buildCommand.command,
    buildCommand.args,
    projectPath,
    HEALTH_BUILD_TIMEOUT_MS
  );

  if (run.code === 0) {
    return {
      buildStatus: "pass",
      buildMessage: buildCommand.label
    };
  }

  if (run.timedOut) {
    return {
      buildStatus: "fail",
      buildMessage: `Build timed out (${Math.round(HEALTH_BUILD_TIMEOUT_MS / 1000)}s)`
    };
  }

  return {
    buildStatus: "fail",
    buildMessage: toOneLineMessage(run.stderr || run.stdout, `Build failed (${buildCommand.label})`)
  };
};

const calcProjectHealthScore = (payload: {
  lastCommitAt: number | null;
  uncommittedChanges: number | null;
  dependencyCount: number | null;
  buildStatus: ProjectHealthBuildStatus;
}): number => {
  let penalty = 0;

  if (payload.lastCommitAt) {
    const staleDays = (Date.now() - payload.lastCommitAt) / (24 * 60 * 60 * 1000);
    if (staleDays > 14) {
      penalty += Math.min(30, Math.floor((staleDays - 14) * 1.15) + 6);
    }
  } else {
    penalty += 16;
  }

  if (payload.uncommittedChanges === null) {
    penalty += 8;
  } else {
    penalty += Math.min(26, payload.uncommittedChanges * 2);
  }

  if (payload.dependencyCount === null) {
    penalty += 6;
  } else if (payload.dependencyCount > 40) {
    penalty += Math.min(18, Math.floor((payload.dependencyCount - 40) / 8) + 4);
  }

  switch (payload.buildStatus) {
    case "fail":
      penalty += 28;
      break;
    case "missing_script":
      penalty += 12;
      break;
    case "missing_manifest":
      penalty += 10;
      break;
    case "unknown":
      penalty += 8;
      break;
    case "skipped":
      penalty += 6;
      break;
    case "pass":
      break;
  }

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
};

const calcProjectRisk = (score: number): ProjectHealthRisk => {
  if (score < 45) {
    return "high";
  }
  if (score < 70) {
    return "medium";
  }
  return "low";
};

const collectProjectHealth = async (
  project: Pick<ProjectItem, "name" | "path">,
  includeBuildCheck: boolean
): Promise<ProjectHealthItem> => {
  const [lastCommitResult, changesResult, manifestState] = await Promise.all([
    runGit(["log", "-1", "--format=%ct"], project.path),
    runGit(["status", "--porcelain"], project.path),
    readPackageManifest(project.path)
  ]);

  const commitUnix = Number.parseInt(lastCommitResult.stdout.trim(), 10);
  const lastCommitAt =
    lastCommitResult.code === 0 && Number.isFinite(commitUnix) && commitUnix > 0
      ? commitUnix * 1000
      : null;

  const uncommittedChanges =
    changesResult.code === 0
      ? changesResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0).length
      : null;

  const dependencyCount = manifestState.manifest ? countManifestDependencies(manifestState.manifest) : null;

  const { buildStatus, buildMessage } = await evaluateBuildHealth(
    project.path,
    manifestState,
    includeBuildCheck
  );

  const score = calcProjectHealthScore({
    lastCommitAt,
    uncommittedChanges,
    dependencyCount,
    buildStatus
  });

  return {
    projectPath: project.path,
    projectName: project.name,
    lastCommitAt,
    uncommittedChanges,
    dependencyCount,
    buildStatus,
    buildMessage,
    score,
    riskLevel: calcProjectRisk(score)
  };
};

const runWithConcurrency = async <T, U>(
  entries: T[],
  concurrency: number,
  mapper: (entry: T) => Promise<U>
): Promise<U[]> => {
  if (entries.length === 0) {
    return [];
  }
  const workerCount = Math.max(1, Math.min(concurrency, entries.length));
  const results: U[] = new Array(entries.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= entries.length) {
          break;
        }
        results[index] = await mapper(entries[index]);
      }
    })
  );

  return results;
};

const getProjectHealth = async (request: ProjectHealthRequest = {}): Promise<ProjectHealthResult> => {
  const generatedAt = Date.now();
  try {
    const listed = await listProjects();
    if (!listed.ok) {
      return {
        ok: false,
        generatedAt,
        message: listed.message,
        items: []
      };
    }

    const normalizedPaths = (request.projectPaths ?? [])
      .map((projectPath) => projectPath.trim())
      .filter((projectPath) => projectPath.length > 0)
      .map((projectPath) => path.resolve(projectPath));
    const requestedPathSet = normalizedPaths.length > 0 ? new Set(normalizedPaths) : null;
    const targets = requestedPathSet
      ? listed.projects.filter((project) => requestedPathSet.has(path.resolve(project.path)))
      : listed.projects;
    const includeBuildCheck = request.includeBuildCheck !== false;

    const items = await runWithConcurrency(targets, HEALTH_CONCURRENCY, (project) =>
      collectProjectHealth(project, includeBuildCheck)
    );

    return {
      ok: true,
      generatedAt,
      items
    };
  } catch (error) {
    return {
      ok: false,
      generatedAt,
      message: error instanceof Error ? error.message : "Unknown project health scan error.",
      items: []
    };
  }
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

  const add = await runGit(["add", "."], request.projectPath);
  if (add.code !== 0) {
    return {
      ok: false,
      step: "add",
      message: "git add failed.",
      stdout: add.stdout,
      stderr: add.stderr
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

  let push = await runGit(["push"], request.projectPath);
  if (push.code !== 0) {
    const pushText = `${push.stdout}\n${push.stderr}`.toLowerCase();
    const needsUpstream =
      pushText.includes("no upstream branch") ||
      pushText.includes("set-upstream") ||
      pushText.includes("has no upstream");
    if (needsUpstream) {
      push = await runGit(["push", "--set-upstream", "origin", "HEAD"], request.projectPath);
    }
  }
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
      ? "No new changes to commit. Push completed for existing commits."
      : "Commit and push completed.",
    stdout: [add.stdout, commit.stdout, push.stdout].join("\n"),
    stderr: [add.stderr, commit.stderr, push.stderr].join("\n")
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

const appendConversationInput = (
  projectPath: string,
  tool: "codex" | "claude",
  sessionId: string,
  input: string
): void => {
  const cleaned = input.trim();
  if (!cleaned) {
    return;
  }
  const line = cleaned
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u0008/g, "")
    .trim();
  if (!line) {
    return;
  }
  const arr = settingsState.conversationByPath[projectPath] ?? [];
  arr.push({
    id: crypto.randomUUID(),
    projectPath,
    tool,
    sessionId,
    input: line,
    createdAt: Date.now()
  });
  if (arr.length > CONVERSATION_MAX_PER_PROJECT) {
    arr.splice(0, arr.length - CONVERSATION_MAX_PER_PROJECT);
  }
  settingsState.conversationByPath[projectPath] = arr;
  schedulePersistSettings();
};

const processTerminalInputCapture = (session: TerminalSession, data: string): void => {
  const prevBuffer = inputBuffers.get(session.id) ?? "";
  const merged = prevBuffer + data;
  const normalized = merged.replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const complete = lines.slice(0, -1);
  const rest = lines[lines.length - 1] ?? "";
  for (const line of complete) {
    appendConversationInput(session.projectPath, session.tool, session.id, line);
  }
  inputBuffers.set(session.id, rest);
};

const emitTerminalError = (window: BrowserWindow, payload: TerminalErrorEvent): void => {
  window.webContents.send(IpcChannels.TerminalError, payload);
};

const emitTerminalExit = (window: BrowserWindow, payload: TerminalExitEvent): void => {
  window.webContents.send(IpcChannels.TerminalExit, payload);
};

const buildLaunchCommand = (tool: "codex" | "claude"): string => {
  return `if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} } else { Write-Host "[ERROR] Command '${tool}' not found in PATH." }`;
};

const createTerminalSession = (
  mainWindow: BrowserWindow,
  request: TerminalCreateRequest
): TerminalCreateResult => {
  const sessionId = crypto.randomUUID();
  try {
    if (typeof pty.spawn !== "function") {
      return { ok: false, message: "node-pty failed to load: spawn is unavailable." };
    }

    const ptyProcess = pty.spawn("powershell.exe", ["-NoLogo"], {
      cwd: request.projectPath,
      env: process.env as Record<string, string>,
      cols: 120,
      rows: 30
    });

    ptyProcess.onData((chunk) => {
      mainWindow.webContents.send(IpcChannels.TerminalData, { sessionId, chunk });
    });

    ptyProcess.onExit((event) => {
      sessions.delete(sessionId);
      inputBuffers.delete(sessionId);
      emitTerminalExit(mainWindow, { sessionId, code: event.exitCode });
    });

    const session: TerminalSession = {
      id: sessionId,
      ptyProcess,
      projectPath: request.projectPath,
      tool: request.tool
    };
    sessions.set(sessionId, session);
    inputBuffers.set(sessionId, "");
    ptyProcess.write(`${buildLaunchCommand(request.tool)}\r`);

    return {
      ok: true,
      session: {
        id: sessionId,
        projectPath: request.projectPath,
        tool: request.tool,
        title: `${path.basename(request.projectPath)} - ${request.tool}`
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create terminal";
    emitTerminalError(mainWindow, { sessionId, message });
    return { ok: false, message };
  }
};

const registerIpc = (mainWindow: BrowserWindow): void => {
  ipcMain.handle(IpcChannels.RootGet, async () => ({ rootPath: currentRootPath }));

  ipcMain.handle(IpcChannels.RootSet, async (_event, payload: { path: string }) =>
    setRootPath(payload.path)
  );

  ipcMain.handle(IpcChannels.ListProjects, async () => listProjects());
  ipcMain.handle(IpcChannels.ProjectHealth, async (_event, payload?: ProjectHealthRequest) =>
    getProjectHealth(payload ?? {})
  );

  ipcMain.handle(IpcChannels.ProjectMetaSet, async (_event, payload: ProjectMetaSetRequest) =>
    setProjectMeta(payload)
  );

  ipcMain.handle(IpcChannels.GitCommitAndPush, async (_event, payload: GitCommitRequest) =>
    commitAndPush(payload)
  );

  ipcMain.handle(IpcChannels.GitRemoteHistory, async (_event, payload: { projectPath: string }) =>
    getRemoteHistory(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.ConversationList, async (_event, payload: { projectPath: string }) => {
    const rows = settingsState.conversationByPath[payload.projectPath] ?? [];
    return [...rows].sort((a, b) => b.createdAt - a.createdAt);
  });

  ipcMain.handle(IpcChannels.ConversationClear, async (_event, payload: { projectPath: string }) => {
    settingsState.conversationByPath[payload.projectPath] = [];
    schedulePersistSettings();
    return { ok: true };
  });

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
    IpcChannels.TerminalCreate,
    async (_event, request: TerminalCreateRequest): Promise<TerminalCreateResult> =>
      createTerminalSession(mainWindow, request)
  );

  ipcMain.on(IpcChannels.TerminalWrite, (_event, payload: { sessionId: string; data: string }) => {
    const session = sessions.get(payload.sessionId);
    if (!session) {
      return;
    }
    processTerminalInputCapture(session, payload.data);
    session.ptyProcess.write(payload.data);
  });

  ipcMain.on(
    IpcChannels.TerminalResize,
    (_event, payload: { sessionId: string; cols: number; rows: number }) => {
      const session = sessions.get(payload.sessionId);
      if (!session) {
        return;
      }
      try {
        session.ptyProcess.resize(payload.cols, payload.rows);
      } catch {
        // Ignore occasional resize race while terminal is closing.
      }
    }
  );

  ipcMain.on(IpcChannels.TerminalClose, (_event, payload: { sessionId: string }) => {
    const session = sessions.get(payload.sessionId);
    if (!session) {
      return;
    }
    sessions.delete(payload.sessionId);
    inputBuffers.delete(payload.sessionId);
    session.ptyProcess.kill();
  });
};

app.whenReady().then(async () => {
  await initRootPath();
  const mainWindow = createMainWindow();
  registerIpc(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const session of sessions.values()) {
    session.ptyProcess.kill();
  }
  sessions.clear();
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
  try {
    persistSettingsSync();
  } catch {
    // Ignore flush failures at shutdown.
  }
});
