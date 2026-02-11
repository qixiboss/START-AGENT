import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../../src/types/ipc.js";

export const registerWindowIpc = (mainWindow: BrowserWindow): void => {
  ipcMain.handle(IpcChannels.WindowMinimize, async () => {
    mainWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowMaximize, async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowClose, async () => {
    mainWindow.close();
    return { ok: true };
  });

  ipcMain.handle(IpcChannels.WindowIsMaximized, async () => {
    return { isMaximized: mainWindow.isMaximized() };
  });
};
