import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../../src/types/ipc.js";
import type {
  GitAddRequest,
  GitAddResult,
  GitBranchesResult,
  GitCommitRequest,
  GitCommitResult,
  GitGraphResult,
  GitPolicyLoadResult,
  GitPublishPrecheckRequest,
  GitPublishPrecheckResult,
  GitPullRequest,
  GitPullResult,
  GitRemoteHistoryResult,
  GitStashListResult,
  GitStashPopRequest,
  GitStashPopResult,
  GitStashPushRequest,
  GitStashPushResult,
  GitSyncRequest,
  GitSyncResult,
  GitUntrackedFilesResult,
  ProjectMeta
} from "../../src/types/ipc.js";

type RegisterGitIpcDeps = {
  getGitPolicy: (projectPath: string) => Promise<GitPolicyLoadResult>;
  precheckGitPublish: (
    request: GitPublishPrecheckRequest,
    getProjectMeta: (projectPath: string) => ProjectMeta | undefined
  ) => Promise<GitPublishPrecheckResult>;
  gitSync: (
    request: GitSyncRequest,
    getProjectMeta: (projectPath: string) => ProjectMeta | undefined
  ) => Promise<GitSyncResult>;
  listGitStash: (projectPath: string) => Promise<GitStashListResult>;
  pushGitStash: (request: GitStashPushRequest) => Promise<GitStashPushResult>;
  popGitStash: (request: GitStashPopRequest) => Promise<GitStashPopResult>;
  getGitGraph: (projectPath: string, limit?: number) => Promise<GitGraphResult>;
  commitAndPush: (
    request: GitCommitRequest,
    getProjectMeta: (projectPath: string) => ProjectMeta | undefined
  ) => Promise<GitCommitResult>;
  getRemoteHistory: (
    projectPath: string,
    getProjectMeta: (projectPath: string) => ProjectMeta | undefined
  ) => Promise<GitRemoteHistoryResult>;
  listGitBranches: (projectPath: string) => Promise<GitBranchesResult>;
  gitAdd: (request: GitAddRequest) => Promise<GitAddResult>;
  gitPull: (
    request: GitPullRequest,
    getProjectMeta: (projectPath: string) => ProjectMeta | undefined
  ) => Promise<GitPullResult>;
  listGitUntrackedFiles: (projectPath: string) => Promise<GitUntrackedFilesResult>;
  getProjectMeta: (projectPath: string) => ProjectMeta | undefined;
};

export const registerGitIpc = (_mainWindow: BrowserWindow, deps: RegisterGitIpcDeps): void => {
  ipcMain.handle(IpcChannels.GitPolicyGet, async (_event, payload: { projectPath: string }) =>
    deps.getGitPolicy(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.GitPublishPrecheck, async (_event, payload: GitPublishPrecheckRequest) =>
    deps.precheckGitPublish(payload, deps.getProjectMeta)
  );

  ipcMain.handle(IpcChannels.GitSync, async (_event, payload: GitSyncRequest) =>
    deps.gitSync(payload, deps.getProjectMeta)
  );

  ipcMain.handle(IpcChannels.GitStashList, async (_event, payload: { projectPath: string }) =>
    deps.listGitStash(payload.projectPath)
  );

  ipcMain.handle(IpcChannels.GitStashPush, async (_event, payload: GitStashPushRequest) => deps.pushGitStash(payload));

  ipcMain.handle(IpcChannels.GitStashPop, async (_event, payload: GitStashPopRequest) => deps.popGitStash(payload));

  ipcMain.handle(IpcChannels.GitGraph, async (_event, payload: { projectPath: string; limit?: number }) =>
    deps.getGitGraph(payload.projectPath, payload.limit)
  );

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
