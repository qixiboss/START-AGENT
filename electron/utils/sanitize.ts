import {
  TerminalLaunchRecord,
  TerminalSessionSnapshot,
  TerminalSessionStatus
} from "../../src/types/ipc.js";

const TERMINAL_LAUNCH_MAX = 300;
const SESSION_SNAPSHOT_MAX = 20;

/**
 * 清理并验证终端启动记录列表
 */
export const sanitizeLaunches = (value: unknown): TerminalLaunchRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): TerminalLaunchRecord | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<TerminalLaunchRecord>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.projectPath !== "string" ||
        typeof candidate.projectName !== "string" ||
        (candidate.tool !== "codex" && candidate.tool !== "claude" && candidate.tool !== "opencode") ||
        typeof candidate.command !== "string" ||
        typeof candidate.createdAt !== "number"
      ) {
        return null;
      }
      return {
        id: candidate.id,
        projectPath: candidate.projectPath,
        projectName: candidate.projectName,
        tool: candidate.tool,
        command: candidate.command,
        createdAt: candidate.createdAt,
        processId:
          typeof candidate.processId === "number" && Number.isFinite(candidate.processId)
            ? candidate.processId
            : undefined,
        note: typeof candidate.note === "string" ? candidate.note : undefined
      };
    })
    .filter((item): item is TerminalLaunchRecord => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, TERMINAL_LAUNCH_MAX);
};

/**
 * 清理并验证会话状态
 */
export const sanitizeSessionStatus = (value: unknown): TerminalSessionStatus => {
  if (value === "starting" || value === "running" || value === "exited" || value === "error") {
    return value;
  }
  return "exited";
};

/**
 * 清理并验证终端会话快照列表
 */
export const sanitizeSessionSnapshots = (value: unknown): TerminalSessionSnapshot[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): TerminalSessionSnapshot | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<TerminalSessionSnapshot>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.projectPath !== "string" ||
        typeof candidate.projectName !== "string" ||
        (candidate.tool !== "codex" &&
          candidate.tool !== "claude" &&
          candidate.tool !== "opencode" &&
          candidate.tool !== "shell") ||
        typeof candidate.command !== "string" ||
        typeof candidate.createdAt !== "number" ||
        typeof candidate.updatedAt !== "number" ||
        typeof candidate.title !== "string"
      ) {
        return null;
      }
      return {
        id: candidate.id,
        projectPath: candidate.projectPath,
        projectName: candidate.projectName,
        tool: candidate.tool,
        command: candidate.command,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        status: sanitizeSessionStatus(candidate.status),
        title: candidate.title,
        outputPreview: Array.isArray(candidate.outputPreview)
          ? candidate.outputPreview
              .filter((line): line is string => typeof line === "string")
              .slice(-120)
          : []
      };
    })
    .filter((item): item is TerminalSessionSnapshot => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SESSION_SNAPSHOT_MAX);
};
