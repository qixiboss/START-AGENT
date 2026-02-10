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
  listConversation: async () => [],
  clearConversation: async () => ({ ok: true }),
  listSessionPresets: async () => ({
    ok: false,
    message: "Electron preload API not available.",
    presets: []
  }),
  saveSessionPreset: async () => ({ ok: false, message: "Electron preload API not available." }),
  deleteSessionPreset: async () => ({ ok: false, message: "Electron preload API not available." }),
  pickDirectory: async () => ({ ok: false, cancelled: true }),
  createTerminal: async () => ({ ok: false, message: "Electron preload API not available." }),
  writeTerminal: () => {},
  resizeTerminal: () => {},
  closeTerminal: () => {},
  onTerminalData: () => () => {},
  onTerminalExit: () => () => {},
  onTerminalError: () => () => {}
};

export const electronApi: DesktopApi = api ?? fallbackApi;
