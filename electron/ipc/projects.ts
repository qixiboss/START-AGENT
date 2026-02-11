import { BrowserWindow, dialog, ipcMain } from "electron";
import { IpcChannels, ListProjectsResult, ProjectMetaSetRequest, ProjectMetaSetResult } from "../../src/types/ipc.js";

type RegisterProjectsIpcDeps = {
  getCurrentRootPath: () => string;
  setRootPath: (nextPath: string) => Promise<ListProjectsResult>;
  listProjects: () => Promise<ListProjectsResult>;
  setProjectMeta: (request: ProjectMetaSetRequest) => Promise<ProjectMetaSetResult>;
};

export const registerProjectsIpc = (mainWindow: BrowserWindow, deps: RegisterProjectsIpcDeps): void => {
  ipcMain.handle(IpcChannels.RootGet, async () => ({ rootPath: deps.getCurrentRootPath() }));

  ipcMain.handle(IpcChannels.RootSet, async (_event, payload: { path: string }) => deps.setRootPath(payload.path));

  ipcMain.handle(IpcChannels.ListProjects, async () => deps.listProjects());

  ipcMain.handle(IpcChannels.ProjectMetaSet, async (_event, payload: ProjectMetaSetRequest) =>
    deps.setProjectMeta(payload)
  );

  ipcMain.handle(IpcChannels.DialogPickDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      defaultPath: deps.getCurrentRootPath()
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }

    return { ok: true, path: result.filePaths[0] };
  });
};
