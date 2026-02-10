import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  GitCommitRequest,
  GitCommitResult,
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
  TerminalLaunchResult
} from "../src/types/ipc.js";

type Settings = {
  projectRoot?: string;
  projectMetaByPath: Record<string, ProjectMeta>;
  terminalLaunches: TerminalLaunchRecord[];
};

const SETTINGS_SAVE_DEBOUNCE_MS = 400;
const TERMINAL_LAUNCH_MAX = 300;

let currentRootPath = process.env.PROJECT_ROOT || process.cwd();
let settingsState: Settings = {
  projectRoot: currentRootPath,
  projectMetaByPath: {},
  terminalLaunches: []
};
let saveTimer: NodeJS.Timeout | null = null;
let saveInFlight: Promise<void> | null = null;
let launchPruneTimer: NodeJS.Timeout | null = null;

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
      terminalLaunches: sanitizeLaunches(parsed.terminalLaunches)
    };
  } catch {
    return {
      projectRoot: undefined,
      projectMetaByPath: {},
      terminalLaunches: []
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

const registerIpc = (mainWindow: BrowserWindow): void => {
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
};

app.whenReady().then(async () => {
  await initRootPath();
  const mainWindow = createMainWindow();
  registerIpc(mainWindow);
  launchPruneTimer = setInterval(pruneClosedLaunches, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (launchPruneTimer) {
    clearInterval(launchPruneTimer);
    launchPruneTimer = null;
  }
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
