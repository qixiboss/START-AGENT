import crypto from "node:crypto";
import fsSync from "node:fs";
import { BrowserWindow } from "electron";
import { IPty, spawn as spawnPty } from "node-pty";
import {
  IpcChannels,
  SessionToolType,
  ToolType,
  TerminalApprovalDecision,
  TerminalApprovalRequest,
  TerminalLaunchListResult,
  TerminalLaunchRecord,
  TerminalLaunchRequest,
  TerminalLaunchResult,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionOutputChunk,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSessionStatusEvent
} from "../../src/types/ipc.js";
import { Settings } from "./types.js";
import {
  closeProcess,
  focusPowerShellWindow,
  isProcessAlive,
  launchPowerShellWindow,
  resolvePowerShellPath
} from "../utils/process.js";

type RuntimeSession = {
  info: TerminalSessionInfo;
  ptyProcess: IPty;
  outputBuffer: string[];
  allowDangerousForSession: boolean;
  commandInputBuffer: string;
  pendingInputChunks: string[];
  isFlushingInput: boolean;
  pendingApproval?: {
    request: TerminalApprovalRequest;
    data: string;
  };
};

const TERMINAL_LAUNCH_MAX = 300;
const SESSION_SNAPSHOT_MAX = 20;
const SESSION_OUTPUT_LINE_MAX = 5000;
const SESSION_SNAPSHOT_FLUSH_MS = 500;
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b(?=[^\n\r]*\s-(?:[^\n\r]*r[^\n\r]*f|[^\n\r]*f[^\n\r]*r))(?=[^\n\r]*\s\S+)/i,
  /\bdel\b.+\s\/f\b/i,
  /\brmdir\b.+\s\/s\b/i,
  /\bformat\b\s+[a-z]:/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b.+\s-f/i,
  /\bshutdown\b/i
];

type TerminalServiceContext = {
  getSettingsState: () => Settings;
  schedulePersistSettings: () => void;
  appendRuntimeLog: (message: string) => void;
  getMainWindow: () => BrowserWindow | null;
};

const buildToolBootstrapCommand = (tool: ToolType): string => {
  return `if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} } else { Write-Host "[ERROR] Command '${tool}' not found in PATH." }`;
};

const buildSessionBootstrapCommand = (tool: SessionToolType): string => {
  const utf8Setup = [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "chcp 65001 > $null"
  ].join("; ");
  if (tool === "shell") {
    return utf8Setup;
  }
  return `${utf8Setup}; if (Get-Command ${tool} -ErrorAction SilentlyContinue) { ${tool} } else { Write-Host "[ERROR] Command '${tool}' not found in PATH." }`;
};

const looksDangerousCommand = (data: string): boolean => {
  const trimmed = data.trim();
  if (!trimmed) {
    return false;
  }
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed));
};

export const createTerminalService = (context: TerminalServiceContext) => {
  const runtimeSessions = new Map<string, RuntimeSession>();
  const snapshotFlushTimers = new Map<string, NodeJS.Timeout>();

  const sendIpcEvent = <T,>(channel: string, payload: T): void => {
    const mainWindow = context.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(channel, payload);
  };

  const pushSessionOutput = (sessionId: string, stream: "stdout" | "stderr" | "system", data: string): void => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime) {
      return;
    }
    runtime.outputBuffer.push(...data.split(/\r?\n/));
    if (runtime.outputBuffer.length > SESSION_OUTPUT_LINE_MAX) {
      runtime.outputBuffer = runtime.outputBuffer.slice(-SESSION_OUTPUT_LINE_MAX);
    }
    const chunk: TerminalSessionOutputChunk = {
      sessionId,
      data,
      stream,
      timestamp: Date.now()
    };
    sendIpcEvent(IpcChannels.TerminalSessionOutputEvent, chunk);
  };

  const emitSessionStatus = (sessionId: string, status: TerminalSessionStatus, message?: string): void => {
    const runtime = runtimeSessions.get(sessionId);
    if (runtime) {
      runtime.info.status = status;
    }
    const event: TerminalSessionStatusEvent = {
      sessionId,
      status,
      message,
      timestamp: Date.now()
    };
    sendIpcEvent(IpcChannels.TerminalSessionStatusEvent, event);
  };

  const emitInputState = (
    sessionId: string,
    state: TerminalSessionInputState["state"],
    queueLength: number,
    message?: string
  ): void => {
    const event: TerminalSessionInputState = {
      sessionId,
      state,
      queueLength,
      message,
      timestamp: Date.now()
    };
    sendIpcEvent(IpcChannels.TerminalSessionInputStateEvent, event);
  };

  const flushSessionInputQueue = (sessionId: string): void => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime || runtime.isFlushingInput) {
      return;
    }
    runtime.isFlushingInput = true;
    emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
    try {
      while (runtime.pendingInputChunks.length > 0) {
        const nextChunk = runtime.pendingInputChunks.shift();
        if (!nextChunk) {
          continue;
        }
        runtime.ptyProcess.write(nextChunk);
        emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
      }
      emitInputState(sessionId, "idle", 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to flush terminal input.";
      emitInputState(sessionId, "error", runtime.pendingInputChunks.length, message);
    } finally {
      runtime.isFlushingInput = false;
    }
  };

  const upsertSessionSnapshot = (info: TerminalSessionInfo, outputBuffer: string[]): void => {
    const settingsState = context.getSettingsState();
    const snapshot: TerminalSessionSnapshot = {
      id: info.id,
      projectPath: info.projectPath,
      projectName: info.projectName,
      tool: info.tool,
      command: info.command,
      createdAt: info.createdAt,
      updatedAt: Date.now(),
      status: info.status,
      title: info.title,
      outputPreview: outputBuffer.slice(-120)
    };
    const next = [
      snapshot,
      ...settingsState.terminalSessionSnapshots.filter((item) => item.id !== snapshot.id)
    ].slice(0, SESSION_SNAPSHOT_MAX);
    settingsState.terminalSessionSnapshots = next;
    context.schedulePersistSettings();
  };

  const clearScheduledSnapshotFlush = (sessionId: string): void => {
    const timer = snapshotFlushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      snapshotFlushTimers.delete(sessionId);
    }
  };

  const scheduleSessionSnapshotFlush = (
    info: TerminalSessionInfo,
    outputBuffer: string[],
    immediate = false
  ): void => {
    if (immediate) {
      clearScheduledSnapshotFlush(info.id);
      upsertSessionSnapshot(info, outputBuffer);
      return;
    }
    if (snapshotFlushTimers.has(info.id)) {
      return;
    }
    const timer = setTimeout(() => {
      snapshotFlushTimers.delete(info.id);
      upsertSessionSnapshot(info, outputBuffer);
    }, SESSION_SNAPSHOT_FLUSH_MS);
    snapshotFlushTimers.set(info.id, timer);
  };

  const applyForwardedInputToBuffer = (runtime: RuntimeSession, data: string): void => {
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        runtime.commandInputBuffer = "";
      } else {
        runtime.commandInputBuffer += char;
      }
    }
  };

  const analyzeInputForApproval = (
    runtime: RuntimeSession,
    data: string
  ):
    | { mode: "forward"; forwardData: string }
    | {
        mode: "block";
        forwardData: string;
        blockedData: string;
        command: string;
        nextCommandInputBuffer: string;
      } => {
    if (!data.includes("\r") && !data.includes("\n")) {
      return { mode: "forward", forwardData: data };
    }

    const previousBuffer = runtime.commandInputBuffer;
    let lineBuffer = previousBuffer;
    let lineStartInChunk = 0;

    for (let i = 0; i < data.length; i += 1) {
      const char = data[i];
      if (char === "\r" || char === "\n") {
        const command = lineBuffer.trim();
        if (looksDangerousCommand(command)) {
          const forwardData = data.slice(0, lineStartInChunk);
          const blockedData = data.slice(lineStartInChunk);
          const nextCommandInputBuffer = lineStartInChunk === 0 ? previousBuffer : "";
          return {
            mode: "block",
            forwardData,
            blockedData,
            command,
            nextCommandInputBuffer
          };
        }
        lineBuffer = "";
        lineStartInChunk = i + 1;
        continue;
      }
      lineBuffer += char;
    }
    return { mode: "forward", forwardData: data };
  };

  const listTerminalLaunches = (): TerminalLaunchListResult => {
    const settingsState = context.getSettingsState();
    return {
      ok: true,
      launches: [...settingsState.terminalLaunches].sort((a, b) => b.createdAt - a.createdAt)
    };
  };

  const focusTerminalLaunch = (recordId: string): { ok: true } | { ok: false; message: string } => {
    const settingsState = context.getSettingsState();
    const record = settingsState.terminalLaunches.find((item) => item.id === recordId);
    if (!record) {
      return { ok: false, message: "Launch record not found." };
    }
    if (!record.processId || !Number.isInteger(record.processId)) {
      return { ok: false, message: "This launch record has no process id." };
    }
    if (!isProcessAlive(record.processId)) {
      settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => item.id !== recordId);
      context.schedulePersistSettings();
      return { ok: false, message: "Terminal process has already exited." };
    }

    const powerShellPath = resolvePowerShellPath(context.appendRuntimeLog);
    if (!powerShellPath) {
      return { ok: false, message: "Windows PowerShell is unavailable for AppActivate." };
    }

    return focusPowerShellWindow(powerShellPath, record.processId);
  };

  const removeTerminalLaunch = (recordId: string): { ok: true } | { ok: false; message: string } => {
    const settingsState = context.getSettingsState();
    const record = settingsState.terminalLaunches.find((item) => item.id === recordId);
    if (!record) {
      return { ok: false, message: "Launch record not found." };
    }
    if (record.processId && isProcessAlive(record.processId)) {
      const killResult = closeProcess(record.processId);
      if (!killResult.ok) {
        return { ok: false, message: `Failed to close terminal: ${killResult.message}` };
      }
    }

    settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => item.id !== recordId);
    context.schedulePersistSettings();
    return { ok: true };
  };

  const setTerminalLaunchNote = (
    recordId: string,
    note: string
  ): { ok: true; record: TerminalLaunchRecord } | { ok: false; message: string } => {
    const settingsState = context.getSettingsState();
    const index = settingsState.terminalLaunches.findIndex((item) => item.id === recordId);
    if (index < 0) {
      return { ok: false, message: "Launch record not found." };
    }
    const normalizedNote = note.trim();
    const updated: TerminalLaunchRecord = {
      ...settingsState.terminalLaunches[index],
      note: normalizedNote.length > 0 ? normalizedNote : undefined
    };
    settingsState.terminalLaunches[index] = updated;
    context.schedulePersistSettings();
    return { ok: true, record: updated };
  };

  const pruneClosedLaunches = (): void => {
    const settingsState = context.getSettingsState();
    const prevLength = settingsState.terminalLaunches.length;
    settingsState.terminalLaunches = settingsState.terminalLaunches.filter((item) => {
      if (!item.processId) {
        return true;
      }
      return isProcessAlive(item.processId);
    });
    if (settingsState.terminalLaunches.length !== prevLength) {
      context.schedulePersistSettings();
    }
  };

  const launchTerminal = (request: TerminalLaunchRequest): TerminalLaunchResult => {
    const settingsState = context.getSettingsState();
    const powerShellPath = resolvePowerShellPath(context.appendRuntimeLog);
    if (!powerShellPath) {
      return {
        ok: false,
        code: "POWERSHELL_NOT_FOUND",
        message:
          "Windows PowerShell (powershell.exe) was not found. Check system PATH and restart the app."
      };
    }

    const escapedTitle = `${request.projectName} - ${request.tool}`.replace(/'/g, "''");
    const command = `$Host.UI.RawUI.WindowTitle='${escapedTitle}'; ${buildToolBootstrapCommand(request.tool)}`;
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");

    try {
      const launchResult = launchPowerShellWindow(powerShellPath, request.projectPath, encodedCommand);
      if (!launchResult.ok) {
        return {
          ok: false,
          code: "LAUNCH_FAILED",
          message: `Failed to start Windows PowerShell process: ${launchResult.message}`
        };
      }

      const inheritedNote =
        settingsState.terminalLaunches.find(
          (item) =>
            item.projectPath === request.projectPath &&
            item.tool === request.tool &&
            typeof item.note === "string" &&
            item.note.trim().length > 0
        )?.note ?? undefined;

      const record: TerminalLaunchRecord = {
        id: crypto.randomUUID(),
        projectPath: request.projectPath,
        projectName: request.projectName,
        tool: request.tool,
        command,
        createdAt: Date.now(),
        processId: launchResult.pid,
        note: inheritedNote
      };
      settingsState.terminalLaunches = [record, ...settingsState.terminalLaunches].slice(0, TERMINAL_LAUNCH_MAX);
      context.schedulePersistSettings();
      return { ok: true, record };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown launch failure.";
      context.appendRuntimeLog(`powershell launch failed: ${message}`);
      return {
        ok: false,
        code: "LAUNCH_FAILED",
        message: `Failed to launch Windows PowerShell: ${message}`
      };
    }
  };

  const createTerminalSession = (request: {
    projectPath: string;
    projectName: string;
    tool: SessionToolType;
  }): { ok: true; session: TerminalSessionInfo } | { ok: false; message: string } => {
    const powerShellPath = resolvePowerShellPath(context.appendRuntimeLog);
    if (!powerShellPath) {
      return {
        ok: false,
        message: "Windows PowerShell (powershell.exe) was not found. Check system PATH and restart the app."
      };
    }
    if (!fsSync.existsSync(request.projectPath)) {
      return { ok: false, message: `Project path not found: ${request.projectPath}` };
    }

    const command = buildSessionBootstrapCommand(request.tool);
    const args = ["-NoLogo", "-NoExit"];
    if (command) {
      args.push("-Command", command);
    }
    const title = `${request.projectName} - ${request.tool}`;

    try {
      const ptyProcess = spawnPty(powerShellPath, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: request.projectPath,
        env: process.env as Record<string, string>,
        useConpty: true
      });
      const session: TerminalSessionInfo = {
        id: crypto.randomUUID(),
        projectPath: request.projectPath,
        projectName: request.projectName,
        tool: request.tool,
        command: command || "powershell",
        createdAt: Date.now(),
        processId: ptyProcess.pid,
        status: "running",
        title
      };
      const runtime: RuntimeSession = {
        info: session,
        ptyProcess,
        outputBuffer: [],
        allowDangerousForSession: false,
        commandInputBuffer: "",
        pendingInputChunks: [],
        isFlushingInput: false
      };
      runtimeSessions.set(session.id, runtime);
      scheduleSessionSnapshotFlush(session, runtime.outputBuffer, true);

      emitSessionStatus(session.id, "running");
      emitInputState(session.id, "idle", 0);
      ptyProcess.onData((chunk: string) => {
        pushSessionOutput(session.id, "stdout", chunk);
        scheduleSessionSnapshotFlush(runtime.info, runtime.outputBuffer);
      });
      ptyProcess.onExit((event) => {
        const runtimeEntry = runtimeSessions.get(session.id);
        if (runtimeEntry) {
          runtimeEntry.info.status = event.exitCode === 0 ? "exited" : "error";
          pushSessionOutput(
            session.id,
            "system",
            `\n[session closed] code=${event.exitCode} signal=${event.signal}\n`
          );
          emitSessionStatus(session.id, runtimeEntry.info.status);
          emitInputState(
            session.id,
            runtimeEntry.info.status === "error" ? "error" : "idle",
            runtimeEntry.pendingInputChunks.length
          );
          scheduleSessionSnapshotFlush(runtimeEntry.info, runtimeEntry.outputBuffer, true);
        }
        clearScheduledSnapshotFlush(session.id);
        runtimeSessions.delete(session.id);
      });

      return { ok: true, session };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start terminal session.";
      return { ok: false, message };
    }
  };

  const listTerminalSessions = (): { ok: true; sessions: TerminalSessionInfo[] } => {
    const sessions = [...runtimeSessions.values()]
      .map((item) => item.info)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, sessions };
  };

  const inputTerminalSession = (
    sessionId: string,
    data: string
  ): { ok: true; accepted?: boolean; queueLength?: number } | { ok: false; message: string; code?: "APPROVAL_REQUIRED" } => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime) {
      return { ok: false, message: "Session not found." };
    }
    if (runtime.pendingApproval) {
      emitInputState(sessionId, "blocked", 0, "Pending approval exists for this session.");
      return { ok: false, message: "Pending approval exists for this session.", code: "APPROVAL_REQUIRED" };
    }

    if (runtime.allowDangerousForSession) {
      runtime.pendingInputChunks.push(data);
      applyForwardedInputToBuffer(runtime, data);
      emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
      flushSessionInputQueue(sessionId);
      return { ok: true, accepted: true, queueLength: runtime.pendingInputChunks.length };
    }

    const inspection = analyzeInputForApproval(runtime, data);
    if (inspection.mode === "block") {
      if (inspection.forwardData) {
        runtime.pendingInputChunks.push(inspection.forwardData);
        applyForwardedInputToBuffer(runtime, inspection.forwardData);
        flushSessionInputQueue(sessionId);
      }
      const request: TerminalApprovalRequest = {
        requestId: crypto.randomUUID(),
        sessionId,
        command: inspection.command,
        createdAt: Date.now()
      };
      runtime.commandInputBuffer = inspection.nextCommandInputBuffer;
      runtime.pendingApproval = { request, data: inspection.blockedData };
      sendIpcEvent(IpcChannels.TerminalApprovalRequiredEvent, request);
      pushSessionOutput(sessionId, "system", `[approval required] ${request.command}\n`);
      emitInputState(sessionId, "blocked", 0, "Approval required.");
      return { ok: false, message: "Approval required.", code: "APPROVAL_REQUIRED" };
    }

    runtime.pendingInputChunks.push(inspection.forwardData);
    applyForwardedInputToBuffer(runtime, inspection.forwardData);
    emitInputState(sessionId, "sending", runtime.pendingInputChunks.length);
    flushSessionInputQueue(sessionId);
    return { ok: true, accepted: true, queueLength: runtime.pendingInputChunks.length };
  };

  const submitTerminalApproval = (
    sessionId: string,
    requestId: string,
    decision: TerminalApprovalDecision
  ): { ok: true } | { ok: false; message: string } => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime || !runtime.pendingApproval) {
      return { ok: false, message: "No pending approval for this session." };
    }
    if (runtime.pendingApproval.request.requestId !== requestId) {
      return { ok: false, message: "Approval request id mismatch." };
    }
    const pending = runtime.pendingApproval;
    runtime.pendingApproval = undefined;

    if (decision === "deny") {
      pushSessionOutput(sessionId, "system", "[blocked] command denied by approval policy.\n");
      emitInputState(sessionId, "idle", 0, "Command denied by approval policy.");
      return { ok: true };
    }
    if (decision === "allow_session") {
      runtime.allowDangerousForSession = true;
    }
    runtime.pendingInputChunks.push(pending.data);
    applyForwardedInputToBuffer(runtime, pending.data);
    emitInputState(sessionId, "sending", runtime.pendingInputChunks.length, "Approval granted.");
    flushSessionInputQueue(sessionId);
    pushSessionOutput(sessionId, "system", "[approved] command sent.\n");
    return { ok: true };
  };

  const closeTerminalSession = (
    sessionId: string,
    force: boolean
  ): { ok: true } | { ok: false; message: string } => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime) {
      return { ok: false, message: "Session not found." };
    }

    try {
      if (runtime.info.processId) {
        const killed = closeProcess(runtime.info.processId);
        if (!killed.ok && force) {
          return { ok: false, message: killed.message };
        }
        if (!killed.ok) {
          runtime.ptyProcess.kill();
        }
      } else {
        runtime.ptyProcess.kill();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to terminate session.";
      return { ok: false, message };
    }

    runtime.info.status = "exited";
    scheduleSessionSnapshotFlush(runtime.info, runtime.outputBuffer, true);
    runtimeSessions.delete(sessionId);
    emitSessionStatus(sessionId, "exited");
    emitInputState(sessionId, "idle", 0);
    return { ok: true };
  };

  const resizeTerminalSession = (
    sessionId: string,
    cols: number,
    rows: number
  ): { ok: true } | { ok: false; message: string } => {
    const runtime = runtimeSessions.get(sessionId);
    if (!runtime) {
      return { ok: false, message: "Session not found." };
    }
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 20 || rows < 5) {
      return { ok: false, message: "Invalid terminal size." };
    }
    try {
      runtime.ptyProcess.resize(Math.floor(cols), Math.floor(rows));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resize terminal.";
      return { ok: false, message };
    }
  };

  const listTerminalSessionSnapshots = (): { ok: true; snapshots: TerminalSessionSnapshot[] } => {
    const settingsState = context.getSettingsState();
    return {
      ok: true,
      snapshots: [...settingsState.terminalSessionSnapshots].sort((a, b) => b.updatedAt - a.updatedAt)
    };
  };

  const closeAllRuntimeSessions = (): void => {
    for (const [sessionId, runtime] of runtimeSessions.entries()) {
      if (runtime.info.processId) {
        closeProcess(runtime.info.processId);
      } else {
        runtime.ptyProcess.kill();
      }
      runtime.info.status = "exited";
      scheduleSessionSnapshotFlush(runtime.info, runtime.outputBuffer, true);
      emitInputState(sessionId, "idle", 0);
      runtimeSessions.delete(sessionId);
    }
  };

  return {
    launchTerminal,
    listTerminalLaunches,
    focusTerminalLaunch,
    removeTerminalLaunch,
    setTerminalLaunchNote,
    pruneClosedLaunches,
    createTerminalSession,
    listTerminalSessions,
    inputTerminalSession,
    submitTerminalApproval,
    closeTerminalSession,
    resizeTerminalSession,
    listTerminalSessionSnapshots,
    closeAllRuntimeSessions
  };
};
