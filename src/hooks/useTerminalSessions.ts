import { useCallback, useState } from "react";
import { electronApi } from "../services/electronApi";
import type {
  TerminalApprovalRequest,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionSnapshot
} from "../types/ipc";

type UseTerminalSessionsArgs = {
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => Promise<T>;
  setStatus: (value: string) => void;
};

export const useTerminalSessions = ({ withTimeout, setStatus }: UseTerminalSessionsArgs) => {
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [terminalSnapshots, setTerminalSnapshots] = useState<TerminalSessionSnapshot[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [terminalOutputBySession, setTerminalOutputBySession] = useState<Record<string, string>>({});
  const [approvalBySession, setApprovalBySession] = useState<Record<string, TerminalApprovalRequest>>({});
  const [inputStateBySession, setInputStateBySession] = useState<Record<string, TerminalSessionInputState>>({});

  const loadTerminalSessions = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalSessions(),
        7000,
        "Timed out while loading terminal sessions."
      );
      if (!result.ok) {
        setStatus(`Failed to load sessions: ${result.message}`);
        return;
      }
      setTerminalSessions(result.sessions);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : "Unknown session list error";
      setStatus(`Failed to load sessions: ${message}`);
    }
  }, [setStatus, withTimeout]);

  const loadTerminalSnapshots = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalSessionSnapshots(),
        7000,
        "Timed out while loading terminal snapshots."
      );
      if (!result.ok) {
        setStatus(`Failed to load session snapshots: ${result.message}`);
        return;
      }
      setTerminalSnapshots(result.snapshots);
    } catch (snapshotError) {
      const message =
        snapshotError instanceof Error ? snapshotError.message : "Unknown terminal snapshot error";
      setStatus(`Failed to load session snapshots: ${message}`);
    }
  }, [setStatus, withTimeout]);

  return {
    terminalSessions,
    setTerminalSessions,
    terminalSnapshots,
    setTerminalSnapshots,
    activeSessionId,
    setActiveSessionId,
    terminalOutputBySession,
    setTerminalOutputBySession,
    approvalBySession,
    setApprovalBySession,
    inputStateBySession,
    setInputStateBySession,
    loadTerminalSessions,
    loadTerminalSnapshots
  };
};
