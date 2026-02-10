import { contextBridge, ipcRenderer } from "electron";
import {
  ConversationEntry,
  GitCommitRequest,
  GitCommitResult,
  IpcChannels,
  ListProjectsResult,
  PickDirectoryResult,
  ProjectMetaSetRequest,
  ProjectMetaSetResult,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalExitEvent
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
  listConversation: (projectPath: string): Promise<ConversationEntry[]> =>
    ipcRenderer.invoke(IpcChannels.ConversationList, { projectPath }),
  clearConversation: (projectPath: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke(IpcChannels.ConversationClear, { projectPath }),
  pickDirectory: (): Promise<PickDirectoryResult> => ipcRenderer.invoke(IpcChannels.DialogPickDirectory),
  createTerminal: (request: TerminalCreateRequest): Promise<TerminalCreateResult> =>
    ipcRenderer.invoke(IpcChannels.TerminalCreate, request),
  writeTerminal: (sessionId: string, data: string): void => {
    ipcRenderer.send(IpcChannels.TerminalWrite, { sessionId, data });
  },
  resizeTerminal: (sessionId: string, cols: number, rows: number): void => {
    ipcRenderer.send(IpcChannels.TerminalResize, { sessionId, cols, rows });
  },
  closeTerminal: (sessionId: string): void => {
    ipcRenderer.send(IpcChannels.TerminalClose, { sessionId });
  },
  onTerminalData: (handler: (event: TerminalDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void =>
      handler(payload);
    ipcRenderer.on(IpcChannels.TerminalData, listener);
    return () => ipcRenderer.removeListener(IpcChannels.TerminalData, listener);
  },
  onTerminalExit: (handler: (event: TerminalExitEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void =>
      handler(payload);
    ipcRenderer.on(IpcChannels.TerminalExit, listener);
    return () => ipcRenderer.removeListener(IpcChannels.TerminalExit, listener);
  },
  onTerminalError: (handler: (event: TerminalErrorEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalErrorEvent): void =>
      handler(payload);
    ipcRenderer.on(IpcChannels.TerminalError, listener);
    return () => ipcRenderer.removeListener(IpcChannels.TerminalError, listener);
  }
};

contextBridge.exposeInMainWorld("desktopApi", api);
