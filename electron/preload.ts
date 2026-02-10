import { contextBridge, ipcRenderer } from "electron";
import {
  GitCommitRequest,
  GitCommitResult,
  GitRemoteHistoryResult,
  IpcChannels,
  ListProjectsResult,
  PickDirectoryResult,
  ProjectMetaSetRequest,
  ProjectMetaSetResult,
  TerminalLaunchListResult,
  TerminalLaunchRecord,
  TerminalLaunchRequest,
  TerminalLaunchResult
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
    ipcRenderer.invoke(IpcChannels.TerminalLaunchesRemove, { recordId })
};

contextBridge.exposeInMainWorld("desktopApi", api);
