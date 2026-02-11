import { Dispatch, SetStateAction, useCallback } from "react";
import { electronApi } from "../services/electronApi";
import type {
  ProjectItem,
  TerminalApprovalRequest,
  TerminalSessionInfo,
  TerminalSessionInputState,
  TerminalSessionSnapshot
} from "../types/ipc";

type UseEmbeddedSessionActionsArgs = {
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => Promise<T>;
  setStatus: (value: string) => void;
  activeSessionId: string | null;
  setTerminalSessions: Dispatch<SetStateAction<TerminalSessionInfo[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setTerminalOutputBySession: Dispatch<SetStateAction<Record<string, string>>>;
  approvalBySession: Record<string, TerminalApprovalRequest>;
  setApprovalBySession: Dispatch<SetStateAction<Record<string, TerminalApprovalRequest>>>;
  setInputStateBySession: Dispatch<SetStateAction<Record<string, TerminalSessionInputState>>>;
  loadTerminalSessions: () => Promise<void>;
  loadTerminalSnapshots: () => Promise<void>;
};

export const useEmbeddedSessionActions = ({
  withTimeout,
  setStatus,
  activeSessionId,
  setTerminalSessions,
  setActiveSessionId,
  setTerminalOutputBySession,
  approvalBySession,
  setApprovalBySession,
  setInputStateBySession,
  loadTerminalSessions,
  loadTerminalSnapshots
}: UseEmbeddedSessionActionsArgs) => {
  const createEmbeddedSession = useCallback(
    async (project: ProjectItem, tool: "codex" | "claude" | "shell") => {
      try {
        setStatus(`Starting ${tool} session for ${project.name}...`);
        const result = await withTimeout(
          electronApi.createTerminalSession({
            projectPath: project.path,
            projectName: project.name,
            tool
          }),
          7000,
          `Timed out while creating ${tool} session.`
        );
        if (!result.ok) {
          setStatus(`Failed to create session: ${result.message}`);
          return;
        }
        setTerminalSessions((prev) => [result.session, ...prev.filter((item) => item.id !== result.session.id)]);
        setActiveSessionId(result.session.id);
        setTerminalOutputBySession((prev) => ({ ...prev, [result.session.id]: prev[result.session.id] ?? "" }));
        setStatus(`Started ${tool} session for ${project.name}`);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : "Unknown create session error";
        setStatus(`Failed to create session: ${message}`);
      }
    },
    [setActiveSessionId, setStatus, setTerminalOutputBySession, setTerminalSessions, withTimeout]
  );

  const sendTerminalData = useCallback(
    (data: string) => {
      if (!activeSessionId) {
        return;
      }
      void electronApi.inputTerminalSession(activeSessionId, data).then((result) => {
        if (!result.ok && result.code !== "APPROVAL_REQUIRED") {
          setStatus(`Failed to send terminal input: ${result.message}`);
        }
      });
    },
    [activeSessionId, setStatus]
  );

  const closeEmbeddedSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = await electronApi.closeTerminalSession(sessionId, true);
        if (!result.ok) {
          setStatus(`Failed to close session: ${result.message}`);
          return;
        }
        setTerminalSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setTerminalOutputBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setApprovalBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setInputStateBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setStatus("Session closed.");
        void loadTerminalSessions();
        void loadTerminalSnapshots();
      } catch (closeError) {
        const message = closeError instanceof Error ? closeError.message : "Unknown close session error";
        setStatus(`Failed to close session: ${message}`);
      }
    },
    [
      loadTerminalSessions,
      loadTerminalSnapshots,
      setApprovalBySession,
      setInputStateBySession,
      setStatus,
      setTerminalOutputBySession,
      setTerminalSessions
    ]
  );

  const submitApproval = useCallback(
    async (sessionId: string, decision: "allow_once" | "allow_session" | "deny") => {
      const request = approvalBySession[sessionId];
      if (!request) {
        return;
      }
      try {
        const result = await electronApi.submitTerminalApproval(sessionId, request.requestId, decision);
        if (!result.ok) {
          setStatus(`Approval action failed: ${result.message}`);
          return;
        }
        setApprovalBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setStatus(`Approval submitted: ${decision}`);
      } catch (approvalError) {
        const message = approvalError instanceof Error ? approvalError.message : "Unknown approval error";
        setStatus(`Approval action failed: ${message}`);
      }
    },
    [approvalBySession, setApprovalBySession, setStatus]
  );

  const resizeEmbeddedSession = useCallback(
    async (sessionId: string, cols: number, rows: number) => {
      try {
        const result = await electronApi.resizeTerminalSession(sessionId, cols, rows);
        if (!result.ok) {
          setStatus(`Resize failed: ${result.message}`);
        }
      } catch (resizeError) {
        const message = resizeError instanceof Error ? resizeError.message : "Unknown resize error";
        setStatus(`Resize failed: ${message}`);
      }
    },
    [setStatus]
  );

  return {
    createEmbeddedSession,
    sendTerminalData,
    closeEmbeddedSession,
    submitApproval,
    resizeEmbeddedSession
  };
};
