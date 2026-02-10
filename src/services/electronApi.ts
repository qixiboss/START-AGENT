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
  minimizeWindow: async () => ({ ok: true }),
  maximizeWindow: async () => ({ ok: true }),
  closeWindow: async () => ({ ok: true }),
  isMaximized: async () => ({ isMaximized: false })
};

export const electronApi: DesktopApi = api ?? fallbackApi;
