import { BrowserWindow, ipcMain } from "electron";
import {
  IpcChannels,
  SessionToolType,
  TerminalApprovalDecision,
  TerminalLaunchListResult,
  TerminalLaunchRecord,
  TerminalLaunchRequest,
  TerminalLaunchResult,
  TerminalSessionCreateResult,
  TerminalSessionInputResult,
  TerminalSessionListResult,
  TerminalSessionRestoreListResult,
  TerminalApprovalSubmitResult
} from "../../src/types/ipc.js";

type RegisterTerminalIpcDeps = {
  launchTerminal: (request: TerminalLaunchRequest) => TerminalLaunchResult;
  listTerminalLaunches: () => TerminalLaunchListResult;
  focusTerminalLaunch: (recordId: string) => { ok: true } | { ok: false; message: string };
  setTerminalLaunchNote: (recordId: string, note: string) => { ok: true; record: TerminalLaunchRecord } | { ok: false; message: string };
  removeTerminalLaunch: (recordId: string) => { ok: true } | { ok: false; message: string };
  createTerminalSession: (request: { projectPath: string; projectName: string; tool: SessionToolType }) => TerminalSessionCreateResult;
  inputTerminalSession: (sessionId: string, data: string) => TerminalSessionInputResult;
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => { ok: true } | { ok: false; message: string };
  closeTerminalSession: (sessionId: string, force: boolean) => { ok: true } | { ok: false; message: string };
  listTerminalSessions: () => TerminalSessionListResult;
  listTerminalSessionSnapshots: () => TerminalSessionRestoreListResult;
  submitTerminalApproval: (sessionId: string, requestId: string, decision: TerminalApprovalDecision) => TerminalApprovalSubmitResult;
};

export const registerTerminalIpc = (_mainWindow: BrowserWindow, deps: RegisterTerminalIpcDeps): void => {
  ipcMain.handle(
    IpcChannels.TerminalLaunch,
    async (_event, request: TerminalLaunchRequest): Promise<TerminalLaunchResult> => deps.launchTerminal(request)
  );

  ipcMain.handle(IpcChannels.TerminalLaunchesList, async (): Promise<TerminalLaunchListResult> => deps.listTerminalLaunches());

  ipcMain.handle(IpcChannels.TerminalLaunchesFocus, async (_event, payload: { recordId: string }) =>
    deps.focusTerminalLaunch(payload.recordId)
  );

  ipcMain.handle(IpcChannels.TerminalLaunchesNoteSet, async (_event, payload: { recordId: string; note: string }) =>
    deps.setTerminalLaunchNote(payload.recordId, payload.note)
  );

  ipcMain.handle(IpcChannels.TerminalLaunchesRemove, async (_event, payload: { recordId: string }) =>
    deps.removeTerminalLaunch(payload.recordId)
  );

  ipcMain.handle(IpcChannels.TerminalSessionCreate, async (_event, payload: { projectPath: string; projectName: string; tool: SessionToolType }) =>
    deps.createTerminalSession(payload)
  );

  ipcMain.handle(IpcChannels.TerminalSessionInput, async (_event, payload: { sessionId: string; data: string }) =>
    deps.inputTerminalSession(payload.sessionId, payload.data)
  );

  ipcMain.handle(IpcChannels.TerminalSessionResize, async (_event, payload: { sessionId: string; cols: number; rows: number }) =>
    deps.resizeTerminalSession(payload.sessionId, payload.cols, payload.rows)
  );

  ipcMain.handle(IpcChannels.TerminalSessionClose, async (_event, payload: { sessionId: string; force?: boolean }) =>
    deps.closeTerminalSession(payload.sessionId, !!payload.force)
  );

  ipcMain.handle(IpcChannels.TerminalSessionList, async (): Promise<TerminalSessionListResult> => deps.listTerminalSessions());

  ipcMain.handle(IpcChannels.TerminalSessionRestoreList, async (): Promise<TerminalSessionRestoreListResult> => deps.listTerminalSessionSnapshots());

  ipcMain.handle(IpcChannels.TerminalApprovalSubmit, async (_event, payload: { sessionId: string; requestId: string; decision: TerminalApprovalDecision }): Promise<TerminalApprovalSubmitResult> =>
    deps.submitTerminalApproval(payload.sessionId, payload.requestId, payload.decision)
  );
};
