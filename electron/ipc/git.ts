import { BrowserWindow, ipcMain } from "electron";
import {
  GitAddRequest,
  GitAddResult,
  GitBranchesResult,
  GitCommitRequest,
  GitCommitResult,
  GitPullRequest,
  GitPullResult,
  GitRemoteHistoryResult,
  GitUntrackedFilesResult,
  IpcChannels,
  ProjectMeta
} from "../../src/types/ipc.js";

type RegisterGitIpcDeps = {
  commitAndPush: (request: GitCommitRequest, getProjectMeta: (projectPath: string) => ProjectMeta | undefined) => Promise<GitCommitResult>;
  getRemoteHistory: (projectPath: string, getProjectMeta: (projectPath: string) => ProjectMeta | undefined) => Promise<GitRemoteHistoryResult>;
  listGitBranches: (projectPath: string) => Promise<GitBranchesResult>;
  gitAdd: (request: GitAddRequest) => Promise<GitAddResult>;
  gitPull: (request: GitPullRequest, getProjectMeta: (projectPath: string) => ProjectMeta | undefined) => Promise<GitPullResult>;
  listGitUntrackedFiles: (projectPath: string) => Promise<GitUntrackedFilesResult>;
  getProjectMeta: (projectPath: string) => ProjectMeta | undefined;
};

export const registerGitIpc = (_mainWindow: BrowserWindow, deps: RegisterGitIpcDeps): void => {
  ipcMain.handle(IpcChannels.GitCommitAndPush, async (_event, payload: GitCommitRequest) =>
    deps.commitAndPush(payload, deps.getProjectMeta)
  );

  ipcMain.handle(IpcChannels.GitRemoteHistory, async (_event, payload: { projectPath: string }) =>
    deps.getRemoteHistory(payload.projectPath, deps.getProjectMeta)
  );

  ipcMain.handle(IpcChannels.GitBranches, async (_event, payload: { projectPath: string }) =>
    deps.listGitBranches(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.GitAdd, async (_event, payload: GitAddRequest) => deps.gitAdd(payload));

  ipcMain.handle(IpcChannels.GitPull, async (_event, payload: GitPullRequest) =>
    deps.gitPull(payload, deps.getProjectMeta)
  );

  ipcMain.handle(IpcChannels.GitUntrackedFiles, async (_event, payload: { projectPath: string }) =>
    deps.listGitUntrackedFiles(payload.projectPath)
  );
};
