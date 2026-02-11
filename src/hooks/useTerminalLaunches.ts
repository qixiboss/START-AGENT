import { useCallback, useEffect, useState } from "react";
import { electronApi } from "../services/electronApi";
import type { ProjectItem, TerminalLaunchRecord, ToolType } from "../types/ipc";

type UseTerminalLaunchesArgs = {
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => Promise<T>;
  setStatus: (value: string) => void;
};

export const useTerminalLaunches = ({ withTimeout, setStatus }: UseTerminalLaunchesArgs) => {
  const [launchRecords, setLaunchRecords] = useState<TerminalLaunchRecord[]>([]);
  const [editingLaunchNoteId, setEditingLaunchNoteId] = useState<string | null>(null);
  const [launchNoteDraft, setLaunchNoteDraft] = useState<string>("");

  const loadTerminalLaunches = useCallback(async () => {
    try {
      const result = await withTimeout(
        electronApi.listTerminalLaunches(),
        7000,
        "Timed out while loading Windows PowerShell launches."
      );
      if (!result.ok) {
        setStatus(`Failed to load launches: ${result.message}`);
        return;
      }
      setLaunchRecords(result.launches);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : "Unknown launch list error";
      setStatus(`Failed to load launches: ${message}`);
    }
  }, [setStatus, withTimeout]);

  const launchTerminal = useCallback(
    async (project: ProjectItem, tool: ToolType) => {
      setStatus(`Launching ${tool} for ${project.name}...`);
      try {
        const result = await withTimeout(
          electronApi.launchTerminal({ projectPath: project.path, projectName: project.name, tool }),
          7000,
          `Timed out while launching ${tool}.`
        );
        if (!result.ok) {
          setStatus(`Launch failed: ${result.message}`);
          return;
        }
        setLaunchRecords((prev) => [result.record, ...prev.filter((item) => item.id !== result.record.id)]);
        setStatus(`Opened ${tool} in external PowerShell for ${project.name}`);
      } catch (launchError) {
        const message = launchError instanceof Error ? launchError.message : "Unknown launch error";
        setStatus(`Launch failed: ${message}`);
      }
    },
    [setStatus, withTimeout]
  );

  const relaunchRecord = useCallback(
    async (record: TerminalLaunchRecord) => {
      await launchTerminal({ name: record.projectName, path: record.projectPath }, record.tool);
    },
    [launchTerminal]
  );

  const removeLaunchRecord = useCallback(
    async (recordId: string) => {
      try {
        const result = await electronApi.removeTerminalLaunch(recordId);
        if (!result.ok) {
          setStatus(`Failed to remove launch: ${result.message}`);
          return;
        }
        setLaunchRecords((prev) => prev.filter((item) => item.id !== recordId));
        setStatus("Removed launch record.");
      } catch (removeError) {
        const message = removeError instanceof Error ? removeError.message : "Unknown remove launch error";
        setStatus(`Failed to remove launch: ${message}`);
      }
    },
    [setStatus]
  );

  const focusLaunchRecord = useCallback(
    async (recordId: string) => {
      try {
        const result = await electronApi.focusTerminalLaunch(recordId);
        if (!result.ok) {
          setStatus(`Failed to focus launch: ${result.message}`);
          if (result.message.includes("already exited")) {
            setLaunchRecords((prev) => prev.filter((item) => item.id !== recordId));
          }
          return;
        }
        setStatus("Brought PowerShell window to front.");
      } catch (focusError) {
        const message = focusError instanceof Error ? focusError.message : "Unknown focus error";
        setStatus(`Failed to focus launch: ${message}`);
      }
    },
    [setStatus]
  );

  const startEditLaunchNote = useCallback((record: TerminalLaunchRecord) => {
    setEditingLaunchNoteId(record.id);
    setLaunchNoteDraft(record.note ?? "");
  }, []);

  const cancelEditLaunchNote = useCallback(() => {
    setEditingLaunchNoteId(null);
    setLaunchNoteDraft("");
  }, []);

  const saveLaunchNote = useCallback(async () => {
    if (!editingLaunchNoteId) {
      return;
    }
    try {
      const result = await electronApi.setTerminalLaunchNote(editingLaunchNoteId, launchNoteDraft);
      if (!result.ok) {
        setStatus(`Failed to save launch note: ${result.message}`);
        return;
      }
      setLaunchRecords((prev) => prev.map((item) => (item.id === result.record.id ? result.record : item)));
      setStatus("Launch note saved.");
      setEditingLaunchNoteId(null);
      setLaunchNoteDraft("");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unknown save note error";
      setStatus(`Failed to save launch note: ${message}`);
    }
  }, [editingLaunchNoteId, launchNoteDraft, setStatus]);

  useEffect(() => {
    if (!editingLaunchNoteId) {
      return;
    }
    if (!launchRecords.some((item) => item.id === editingLaunchNoteId)) {
      setEditingLaunchNoteId(null);
      setLaunchNoteDraft("");
    }
  }, [editingLaunchNoteId, launchRecords]);

  return {
    launchRecords,
    loadTerminalLaunches,
    launchTerminal,
    relaunchRecord,
    removeLaunchRecord,
    focusLaunchRecord,
    editingLaunchNoteId,
    launchNoteDraft,
    setLaunchNoteDraft,
    startEditLaunchNote,
    cancelEditLaunchNote,
    saveLaunchNote
  };
};
