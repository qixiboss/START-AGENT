import type { DesktopApi } from "../types/ipc";

const api = typeof window !== "undefined" ? window.desktopApi : undefined;
export const desktopApiAvailable = typeof api !== "undefined";
const previewModeMessage = "Browser preview mode: Electron preload API not available.";
const previewRootPath = "Browser preview mode (Electron required)";

const fallbackApi: DesktopApi = {
  getRootPath: async () => ({ rootPath: previewRootPath }),
  setRootPath: async () => ({
    ok: false,
    message: previewModeMessage,
    projects: [],
    rootPath: previewRootPath
  }),
  listProjects: async () => ({
    ok: true,
    projects: [],
    rootPath: previewRootPath
  }),
  setProjectMeta: async () => ({ ok: false, message: previewModeMessage }),
  getGitPolicy: async () => ({
    ok: false,
    message: previewModeMessage,
    policy: {
      workflow: "trunk_short_branch",
      pullStrategy: "rebase",
      protectedBranches: ["main", "master", "release"],
      commitConvention: {
        type: "conventional_commits",
        allowedTypes: ["feat", "fix", "chore", "docs", "refactor", "test", "build", "ci", "perf", "revert", "style"],
        maxHeaderLength: 72
      },
      pushPolicy: {
        requireUpToDateBeforePush: true,
        warnWhenBehind: true,
        confirmPushToProtected: true
      },
      branchPolicy: {
        suggestPattern: "^(feat|fix|chore|hotfix|docs)/[a-z0-9._-]+$",
        warnIfNotMatch: true
      }
    },
    source: "default" as const
  }),
  precheckGitPublish: async () => ({
    ok: false,
    message: previewModeMessage,
    issues: []
  }),
  gitSync: async () => ({
    ok: false,
    strategy: "rebase" as const,
    message: previewModeMessage,
    stdout: "",
    stderr: ""
  }),
  listGitStash: async () => ({
    ok: false,
    message: previewModeMessage,
    entries: []
  }),
  pushGitStash: async () => ({
    ok: false,
    message: previewModeMessage,
    stdout: "",
    stderr: ""
  }),
  popGitStash: async () => ({
    ok: false,
    message: previewModeMessage,
    stdout: "",
    stderr: ""
  }),
  getGitGraph: async () => ({
    ok: false,
    message: previewModeMessage,
    nodes: []
  }),
  commitAndPush: async () => ({
    ok: false,
    step: "validate",
    message: previewModeMessage,
    stdout: "",
    stderr: ""
  }),
  getRemoteHistory: async () => ({ ok: false, message: previewModeMessage }),
  listGitBranches: async () => ({
    ok: false,
    message: previewModeMessage,
    currentBranch: "",
    branches: []
  }),
  gitAdd: async () => ({
    ok: false,
    message: previewModeMessage,
    addedFiles: [],
    stdout: "",
    stderr: ""
  }),
  gitPull: async () => ({
    ok: false,
    message: previewModeMessage,
    stdout: "",
    stderr: ""
  }),
  listGitUntrackedFiles: async () => ({
    ok: false,
    message: previewModeMessage,
    files: []
  }),
  pickDirectory: async () => ({ ok: false, cancelled: true }),
  launchTerminal: async () => ({ ok: false, message: previewModeMessage }),
  listTerminalLaunches: async () => ({
    ok: true,
    launches: []
  }),
  focusTerminalLaunch: async () => ({ ok: false, message: previewModeMessage }),
  setTerminalLaunchNote: async () => ({ ok: false, message: previewModeMessage }),
  removeTerminalLaunch: async () => ({ ok: false, message: previewModeMessage }),
  createTerminalSession: async () => ({ ok: false, message: previewModeMessage }),
  inputTerminalSession: async () => ({ ok: false, message: previewModeMessage }),
  resizeTerminalSession: async () => ({ ok: false, message: previewModeMessage }),
  closeTerminalSession: async () => ({ ok: false, message: previewModeMessage }),
  listTerminalSessions: async () => ({ ok: true, sessions: [] }),
  listTerminalSessionSnapshots: async () => ({
    ok: true,
    snapshots: []
  }),
  submitTerminalApproval: async () => ({ ok: false, message: previewModeMessage }),
  onTerminalSessionOutput: () => () => undefined,
  onTerminalSessionStatus: () => () => undefined,
  onTerminalSessionInputState: () => () => undefined,
  onTerminalApprovalRequired: () => () => undefined,
  listQuotas: async () => ({
    ok: true,
    items: []
  }),
  getQuotaAuthConfigs: async () => ({
    ok: true,
    providers: [],
    storageMode: "plain" as const
  }),
  saveQuotaAuthConfig: async () => ({
    ok: false,
    message: previewModeMessage
  }),
  importQuotaAuthFromBrowser: async () => ({
    ok: false,
    message: previewModeMessage
  }),
  authorizeQuotaInApp: async () => ({
    ok: false,
    message: previewModeMessage
  }),
  openExternal: async () => ({ ok: false, message: previewModeMessage }),
  minimizeWindow: async () => ({ ok: true }),
  maximizeWindow: async () => ({ ok: true }),
  closeWindow: async () => ({ ok: true }),
  isMaximized: async () => ({ isMaximized: false })
};

export const electronApi: DesktopApi = api ?? fallbackApi;
