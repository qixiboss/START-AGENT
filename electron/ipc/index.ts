import { BrowserWindow } from "electron";
import { registerGitIpc } from "./git.js";
import { registerProjectsIpc } from "./projects.js";
import { registerTerminalIpc } from "./terminal.js";
import { registerWindowIpc } from "./window.js";

export type RegisterIpcArgs = {
  mainWindow: BrowserWindow;
  projects: Parameters<typeof registerProjectsIpc>[1];
  git: Parameters<typeof registerGitIpc>[1];
  terminal: Parameters<typeof registerTerminalIpc>[1];
};

export const registerIpc = (args: RegisterIpcArgs): void => {
  registerProjectsIpc(args.mainWindow, args.projects);
  registerGitIpc(args.mainWindow, args.git);
  registerTerminalIpc(args.mainWindow, args.terminal);
  registerWindowIpc(args.mainWindow);
};
