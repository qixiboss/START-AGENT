import { contextBridge, ipcRenderer } from "electron";
import {
  TerminalApprovalDecision,
  TerminalApprovalRequest,
  TerminalApprovalSubmitResult,
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
  PickDirectoryResult,
  ProjectMetaSetRequest,
  ProjectMetaSetResult,
  TerminalLaunchListResult,
  TerminalLaunchRecord,
  TerminalLaunchRequest,
  TerminalLaunchResult,
  TerminalSessionCreateRequest,
  TerminalSessionCreateResult,
  TerminalSessionInputResult,
  TerminalSessionInputState,
  TerminalSessionListResult,
  TerminalSessionOutputChunk,
  TerminalSessionRestoreListResult,
  TerminalSessionStatusEvent
} from "../src/types/ipc.js";

const api = {
  getRootPath: (): Promise<{ rootPath: string }> => ipcRenderer.invoke(IpcChannels.RootGet),
  setRootPath: (path: string): Promise<ListProjectsResult> =>
    ipcRenderer.invoke(IpcChannels.RootSet, { path }),
  listProjects: (): Promise<ListProjectsResult> => ipcRenderer.invoke(IpcChannels.ListProjects),
  setProjectMeta: (request: ProjectMetaSetRequest): Promise<ProjectMetaSetResult> =>
    ipcRenderer.invoke(IpcChannels.ProjectMetaSet, request),
  commitAndPush: (request: GitCommitRequest): Promise<GitCommitResult> =>
    ipcRenderer.invoke(IpcChannels.GitCommitAndPush, request),
  getRemoteHistory: (projectPath: string): Promise<GitRemoteHistoryResult> =>
    ipcRenderer.invoke(IpcChannels.GitRemoteHistory, { projectPath }),
  listGitBranches: (projectPath: string): Promise<GitBranchesResult> =>
    ipcRenderer.invoke(IpcChannels.GitBranches, { projectPath }),
  gitAdd: (request: GitAddRequest): Promise<GitAddResult> =>
    ipcRenderer.invoke(IpcChannels.GitAdd, request),
  gitPull: (request: GitPullRequest): Promise<GitPullResult> =>
    ipcRenderer.invoke(IpcChannels.GitPull, request),
  listGitUntrackedFiles: (projectPath: string): Promise<GitUntrackedFilesResult> =>
    ipcRenderer.invoke(IpcChannels.GitUntrackedFiles, { projectPath }),
  pickDirectory: (): Promise<PickDirectoryResult> => ipcRenderer.invoke(IpcChannels.DialogPickDirectory),
  launchTerminal: (request: TerminalLaunchRequest): Promise<TerminalLaunchResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalLaunch, request),
  listTerminalLaunches: (): Promise<TerminalLaunchListResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalLaunchesList),
  focusTerminalLaunch: (recordId: string): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IpcChannels.TerminalLaunchesFocus, { recordId }),
  setTerminalLaunchNote: (
    recordId: string,
    note: string
  ): Promise<{ ok: true; record: TerminalLaunchRecord } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IpcChannels.TerminalLaunchesNoteSet, { recordId, note }),
  removeTerminalLaunch: (recordId: string): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IpcChannels.TerminalLaunchesRemove, { recordId }),
  createTerminalSession: (request: TerminalSessionCreateRequest): Promise<TerminalSessionCreateResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionCreate, request),
  inputTerminalSession: (sessionId: string, data: string): Promise<TerminalSessionInputResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionInput, { sessionId, data }),
  resizeTerminalSession: (sessionId: string, cols: number, rows: number): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionResize, { sessionId, cols, rows }),
  closeTerminalSession: (sessionId: string, force?: boolean): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionClose, { sessionId, force }),
  listTerminalSessions: (): Promise<TerminalSessionListResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionList),
  listTerminalSessionSnapshots: (): Promise<TerminalSessionRestoreListResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalSessionRestoreList),
  submitTerminalApproval: (
    sessionId: string,
    requestId: string,
    decision: TerminalApprovalDecision
  ): Promise<TerminalApprovalSubmitResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalApprovalSubmit, { sessionId, requestId, decision }),
  onTerminalSessionOutput: (handler: (chunk: TerminalSessionOutputChunk) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalSessionOutputChunk) => {
      handler(payload);
    };
    ipcRenderer.on(IpcChannels.TerminalSessionOutputEvent, listener);
    return () => ipcRenderer.off(IpcChannels.TerminalSessionOutputEvent, listener);
  },
  onTerminalSessionStatus: (handler: (event: TerminalSessionStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalSessionStatusEvent) => {
      handler(payload);
    };
    ipcRenderer.on(IpcChannels.TerminalSessionStatusEvent, listener);
    return () => ipcRenderer.off(IpcChannels.TerminalSessionStatusEvent, listener);
  },
  onTerminalSessionInputState: (handler: (event: TerminalSessionInputState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalSessionInputState) => {
      handler(payload);
    };
    ipcRenderer.on(IpcChannels.TerminalSessionInputStateEvent, listener);
    return () => ipcRenderer.off(IpcChannels.TerminalSessionInputStateEvent, listener);
  },
  onTerminalApprovalRequired: (handler: (event: TerminalApprovalRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalApprovalRequest) => {
      handler(payload);
    };
    ipcRenderer.on(IpcChannels.TerminalApprovalRequiredEvent, listener);
    return () => ipcRenderer.off(IpcChannels.TerminalApprovalRequiredEvent, listener);
  },
  minimizeWindow: (): Promise<{ ok: true }> => ipcRenderer.invoke(IpcChannels.WindowMinimize),
  maximizeWindow: (): Promise<{ ok: true }> => ipcRenderer.invoke(IpcChannels.WindowMaximize),
  closeWindow: (): Promise<{ ok: true }> => ipcRenderer.invoke(IpcChannels.WindowClose),
  isMaximized: (): Promise<{ isMaximized: boolean }> => ipcRenderer.invoke(IpcChannels.WindowIsMaximized)
};

contextBridge.exposeInMainWorld("desktopApi", api);
