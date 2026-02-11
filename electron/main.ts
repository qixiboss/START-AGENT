import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { app, BrowserWindow } from "electron";
import { registerIpc as registerIpcHandlers } from "./ipc/index.js";
import {
  isReadableDirectory,
  listProjects as listProjectsService,
  setProjectMeta as setProjectMetaService,
  setRootPath as setRootPathService
} from "./services/projects.js";
import {
  commitAndPush as commitAndPushService,
  getRemoteHistory as getRemoteHistoryService,
  gitAdd as gitAddService,
  gitPull as gitPullService,
  listGitBranches as listGitBranchesService,
  listGitUntrackedFiles as listGitUntrackedFilesService
} from "./services/git.js";
import { ensureOriginConfigured } from "./utils/git.js";
import { createTerminalService } from "./services/terminal.js";
import { PersistManager, persistSettingsSync as persistSettingsSyncFile } from "./services/storage.js";
import type { Settings } from "./services/types.js";
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
  ListProjectsResult,
  ProjectMeta,
  ProjectMetaSetRequest,
  ProjectMetaSetResult
} from "../src/types/ipc.js";
import type { ProjectsServiceContext } from "./services/projects.js";

let currentRootPath = process.env.PROJECT_ROOT || process.cwd();
let settingsState: Settings = {
  projectRoot: currentRootPath,
  projectMetaByPath: {},
  terminalLaunches: [],
  terminalSessionSnapshots: []
};
const persistManager = new PersistManager(settingsState);
let launchPruneTimer: NodeJS.Timeout | null = null;
let mainWindowRef: BrowserWindow | null = null;

const getRuntimeLogPath = (): string => path.join(app.getPath("userData"), "runtime.log");

const appendRuntimeLog = (message: string): void => {
  try {
    fsSync.mkdirSync(path.dirname(getRuntimeLogPath()), { recursive: true });
    fsSync.appendFileSync(getRuntimeLogPath(), `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch {
    // Ignore logging failures.
  }
};

const schedulePersistSettings = (): void => {
  persistManager.settings = settingsState;
  persistManager.schedulePersist();
};

const flushSettingsPersist = async (): Promise<void> => {
  persistManager.settings = settingsState;
  await persistManager.flushPersist();
  settingsState = persistManager.settings;
};

const initRootPath = async (): Promise<void> => {
  currentRootPath = await persistManager.initRootPath(currentRootPath, isReadableDirectory);
  settingsState = persistManager.settings;
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

const projectsContext: ProjectsServiceContext = {
  getCurrentRootPath: () => currentRootPath,
  setCurrentRootPath: (value: string) => {
    currentRootPath = value;
  },
  getSettingsState: () => settingsState,
  flushSettingsPersist,
  schedulePersistSettings
};

const getProjectMeta = (projectPath: string): ProjectMeta | undefined => {
  return settingsState.projectMetaByPath[projectPath];
};

const listProjects = async (): Promise<ListProjectsResult> => {
  return listProjectsService(projectsContext);
};

const setRootPath = async (nextPath: string): Promise<ListProjectsResult> => {
  return setRootPathService(projectsContext, nextPath);
};

const setProjectMeta = async (request: ProjectMetaSetRequest): Promise<ProjectMetaSetResult> => {
  return setProjectMetaService(projectsContext, request, ensureOriginConfigured);
};

const commitAndPush = async (request: GitCommitRequest): Promise<GitCommitResult> => {
  return commitAndPushService(request, getProjectMeta);
};

const listGitUntrackedFiles = async (projectPath: string): Promise<GitUntrackedFilesResult> => {
  return listGitUntrackedFilesService(projectPath);
};

const gitAdd = async (request: GitAddRequest): Promise<GitAddResult> => {
  return gitAddService(request);
};

const gitPull = async (request: GitPullRequest): Promise<GitPullResult> => {
  return gitPullService(request, getProjectMeta);
};

const listGitBranches = async (projectPath: string): Promise<GitBranchesResult> => {
  return listGitBranchesService(projectPath);
};

const getRemoteHistory = async (projectPath: string): Promise<GitRemoteHistoryResult> => {
  return getRemoteHistoryService(projectPath, getProjectMeta);
};

const terminalService = createTerminalService({
  getSettingsState: () => settingsState,
  schedulePersistSettings,
  appendRuntimeLog,
  getMainWindow: () => mainWindowRef
});

const {
  launchTerminal,
  listTerminalLaunches,
  focusTerminalLaunch,
  setTerminalLaunchNote,
  removeTerminalLaunch,
  createTerminalSession,
  inputTerminalSession,
  resizeTerminalSession,
  closeTerminalSession,
  listTerminalSessions,
  listTerminalSessionSnapshots,
  submitTerminalApproval,
  pruneClosedLaunches,
  closeAllRuntimeSessions
} = terminalService;

const registerIpc = (mainWindow: BrowserWindow): void => {
  mainWindowRef = mainWindow;
  registerIpcHandlers({
    mainWindow,
    projects: {
      getCurrentRootPath: () => currentRootPath,
      setRootPath,
      listProjects,
      setProjectMeta
    },
    git: {
      commitAndPush,
      getRemoteHistory,
      listGitBranches,
      gitAdd,
      gitPull,
      listGitUntrackedFiles,
      getProjectMeta
    },
    terminal: {
      launchTerminal,
      listTerminalLaunches,
      focusTerminalLaunch,
      setTerminalLaunchNote,
      removeTerminalLaunch,
      createTerminalSession,
      inputTerminalSession,
      resizeTerminalSession,
      closeTerminalSession,
      listTerminalSessions,
      listTerminalSessionSnapshots,
      submitTerminalApproval
    }
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
    persistSettingsSyncFile(settingsState);
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
    persistSettingsSyncFile(settingsState);
  } catch {
    // Ignore flush failures at shutdown.
  }
});
