import type { DesktopApi } from "../types/ipc";

const api = window.desktopApi;

const fallbackApi: DesktopApi = {
  getRootPath: async () => ({ rootPath: "" }),
  setRootPath: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    projects: [],
    rootPath: ""
  }),
  listProjects: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    projects: [],
    rootPath: ""
  }),
  setProjectMeta: async () => ({ ok: false, message: "Electron preload API not available." }),
  commitAndPush: async () => ({
    ok: false,
    step: "validate",
    message: "Electron preload API not available.",
    stdout: "",
    stderr: ""
  }),
  getRemoteHistory: async () => ({ ok: false, message: "Electron preload API not available." }),
  listGitBranches: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    currentBranch: "",
    branches: []
  }),
  gitAdd: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    addedFiles: [],
    stdout: "",
    stderr: ""
  }),
  gitPull: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    stdout: "",
    stderr: ""
  }),
  listGitUntrackedFiles: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    files: []
  }),
  pickDirectory: async () => ({ ok: false, cancelled: true }),
  launchTerminal: async () => ({ ok: false, message: "Electron preload API not available." }),
  listTerminalLaunches: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    launches: []
  }),
  focusTerminalLaunch: async () => ({ ok: false, message: "Electron preload API not available." }),
  setTerminalLaunchNote: async () => ({ ok: false, message: "Electron preload API not available." }),
  removeTerminalLaunch: async () => ({ ok: false, message: "Electron preload API not available." }),
  createTerminalSession: async () => ({ ok: false, message: "Electron preload API not available." }),
  inputTerminalSession: async () => ({ ok: false, message: "Electron preload API not available." }),
  resizeTerminalSession: async () => ({ ok: false, message: "Electron preload API not available." }),
  closeTerminalSession: async () => ({ ok: false, message: "Electron preload API not available." }),
  listTerminalSessions: async () => ({ ok: false, message: "Electron preload API not available.", sessions: [] }),
  listTerminalSessionSnapshots: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    snapshots: []
  }),
  submitTerminalApproval: async () => ({ ok: false, message: "Electron preload API not available." }),
  onTerminalSessionOutput: () => () => undefined,
  onTerminalSessionStatus: () => () => undefined,
  onTerminalSessionInputState: () => () => undefined,
  onTerminalApprovalRequired: () => () => undefined,
  minimizeWindow: async () => ({ ok: true }),
  maximizeWindow: async () => ({ ok: true }),
  closeWindow: async () => ({ ok: true }),
  isMaximized: async () => ({ isMaximized: false })
};

export const electronApi: DesktopApi = api ?? fallbackApi;
