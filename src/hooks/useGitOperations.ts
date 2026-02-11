import { useCallback, useState } from "react";
import { electronApi } from "../services/electronApi";
import type {
  GitBranchesResult,
  GitRemoteHistoryResult,
  GitUntrackedFilesResult,
  ProjectItem,
  ProjectMeta
} from "../types/ipc";

export type EditorMode = "note" | "github" | "commit";
type GitWorkflowAction = "add" | "pull" | "refresh" | "publish" | null;

type UseGitOperationsArgs = {
  setStatus: (value: string) => void;
  patchProjectMetaInList: (projectPath: string, meta: ProjectMeta | undefined) => void;
};

export const useGitOperations = ({ setStatus, patchProjectMetaInList }: UseGitOperationsArgs) => {
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editorProject, setEditorProject] = useState<ProjectItem | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [remoteHistory, setRemoteHistory] = useState<GitRemoteHistoryResult | null>(null);
  const [gitBranches, setGitBranches] = useState<GitBranchesResult | null>(null);
  const [gitUntrackedFiles, setGitUntrackedFiles] = useState<GitUntrackedFilesResult | null>(null);
  const [gitAddMode, setGitAddMode] = useState<"all" | "selected_new">("all");
  const [selectedNewFiles, setSelectedNewFiles] = useState<string[]>([]);
  const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>("");
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState<boolean>(false);
  const [gitWorkflowAction, setGitWorkflowAction] = useState<GitWorkflowAction>(null);

  const loadCommitContext = useCallback(
    async (project: ProjectItem, showSuccessStatus: boolean) => {
      setRemoteHistoryLoading(true);
      try {
        const [historyResult, branchesResult, untrackedResult] = await Promise.all([
          electronApi.getRemoteHistory(project.path),
          electronApi.listGitBranches(project.path),
          electronApi.listGitUntrackedFiles(project.path)
        ]);
        setRemoteHistory(historyResult);
        setGitBranches(branchesResult);
        setGitUntrackedFiles(untrackedResult);
        if (branchesResult.ok) {
          setSelectedRemoteBranch((prev) =>
            prev.trim().length > 0 ? prev : branchesResult.currentBranch || branchesResult.branches[0] || ""
          );
        }
        if (untrackedResult.ok) {
          setSelectedNewFiles((prev) => prev.filter((item) => untrackedResult.files.includes(item)));
        }

        if (!historyResult.ok) {
          setStatus(`Remote history failed: ${historyResult.message}`);
        } else if (!branchesResult.ok) {
          setStatus(`Branch list failed: ${branchesResult.message}`);
        } else if (!untrackedResult.ok) {
          setStatus(`Untracked files failed: ${untrackedResult.message}`);
        } else if (showSuccessStatus) {
          if (historyResult.canPush) {
            setStatus(
              `Git context refreshed: ${historyResult.aheadCount} local commit(s) can be pushed to ${historyResult.upstreamRef}.`
            );
          } else if (historyResult.hasLocalChanges) {
            setStatus("Git context refreshed: local changes detected, commit before push.");
          } else if (historyResult.behindCount > 0) {
            setStatus(
              `Git context refreshed: remote has ${historyResult.behindCount} newer commit(s), pull first.`
            );
          } else {
            setStatus(`Git context refreshed for ${project.name}`);
          }
        }
      } catch (historyError) {
        const message = historyError instanceof Error ? historyError.message : "Unknown git context error";
        setRemoteHistory({ ok: false, message });
        setGitBranches({ ok: false, message, currentBranch: "", branches: [] });
        setGitUntrackedFiles({ ok: false, message, files: [] });
        setStatus(`Git context failed: ${message}`);
      } finally {
        setRemoteHistoryLoading(false);
      }
    },
    [setStatus]
  );

  const openEditor = useCallback(
    (mode: EditorMode, project: ProjectItem) => {
      setEditorMode(mode);
      setEditorProject(project);
      setEditorValue(
        mode === "note" ? project.meta?.note ?? "" : mode === "github" ? project.meta?.githubUrl ?? "" : ""
      );
      setRemoteHistory(null);
      setGitBranches(null);
      setGitUntrackedFiles(null);
      setGitAddMode("all");
      setSelectedNewFiles([]);
      setSelectedRemoteBranch("");
      setGitWorkflowAction(null);
      if (mode === "commit") {
        void loadCommitContext(project, false);
      }
    },
    [loadCommitContext]
  );

  const closeEditor = useCallback(() => {
    setEditorMode(null);
    setEditorProject(null);
    setEditorValue("");
    setRemoteHistory(null);
    setGitBranches(null);
    setGitUntrackedFiles(null);
    setGitAddMode("all");
    setSelectedNewFiles([]);
    setSelectedRemoteBranch("");
    setRemoteHistoryLoading(false);
    setGitWorkflowAction(null);
  }, []);

  const loadRemoteHistory = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    setGitWorkflowAction("refresh");
    setStatus(`Refreshing git context for ${editorProject.name}...`);
    try {
      await loadCommitContext(editorProject, true);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, loadCommitContext, setStatus]);

  const runGitAdd = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    if (gitAddMode === "selected_new" && selectedNewFiles.length === 0) {
      setStatus("Please select at least one new file before Git Add.");
      return;
    }
    setGitWorkflowAction("add");
    setStatus(
      gitAddMode === "all"
        ? `Running git add . for ${editorProject.name}...`
        : `Running git add for ${selectedNewFiles.length} selected file(s)...`
    );
    try {
      const result = await electronApi.gitAdd({
        projectPath: editorProject.path,
        mode: gitAddMode,
        files: gitAddMode === "selected_new" ? selectedNewFiles : undefined
      });
      if (!result.ok) {
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(`Git Add failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
        return;
      }
      setStatus(`Git Add success: ${result.message}`);
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git add error";
      setStatus(`Git Add failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, gitAddMode, loadCommitContext, selectedNewFiles, setStatus]);

  const runGitPull = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    const remoteBranch = selectedRemoteBranch.trim();
    if (!remoteBranch) {
      setStatus("Please select a remote branch before Git Pull.");
      return;
    }
    setGitWorkflowAction("pull");
    setStatus(`Running git pull origin ${remoteBranch} for ${editorProject.name}...`);
    try {
      const result = await electronApi.gitPull({
        projectPath: editorProject.path,
        remoteBranch
      });
      if (!result.ok) {
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(`Git Pull failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
        return;
      }
      setStatus(`Git Pull success: ${result.message}`);
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git pull error";
      setStatus(`Git Pull failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, loadCommitContext, selectedRemoteBranch, setStatus]);

  const submitEditor = useCallback(async () => {
    if (!editorMode || !editorProject) {
      return;
    }
    try {
      if (editorMode === "note") {
        const result = await electronApi.setProjectMeta({
          projectPath: editorProject.path,
          note: editorValue
        });
        if (!result.ok) {
          setStatus(`Failed to save note: ${result.message}`);
          return;
        }
        patchProjectMetaInList(editorProject.path, result.meta);
        setStatus(`Saved note for ${editorProject.name}`);
      } else if (editorMode === "github") {
        const result = await electronApi.setProjectMeta({
          projectPath: editorProject.path,
          githubUrl: editorValue
        });
        if (!result.ok) {
          setStatus(`Failed to save GitHub URL: ${result.message}`);
          return;
        }
        patchProjectMetaInList(editorProject.path, result.meta);
        setStatus(
          result.warning
            ? `Saved URL with warning: ${result.warning}`
            : `Saved GitHub URL for ${editorProject.name}`
        );
      } else {
        const message = editorValue.trim();
        if (!message) {
          setStatus("Commit message is required.");
          return;
        }
        const remoteBranch = selectedRemoteBranch.trim();
        if (!remoteBranch) {
          setStatus("Please select a remote branch.");
          return;
        }
        setGitWorkflowAction("publish");
        setStatus(`Running git commit and git push for ${editorProject.name}...`);
        const result = await electronApi.commitAndPush({
          projectPath: editorProject.path,
          message,
          remoteBranch
        });
        if (!result.ok) {
          const errLine =
            result.stderr
              ?.split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line.length > 0) ?? "";
          setStatus(`Commit failed at ${result.step}: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
          return;
        }
        setStatus(`${result.message} (${editorProject.name})`);
      }
      closeEditor();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unknown action error";
      setStatus(`Action failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [
    closeEditor,
    editorMode,
    editorProject,
    editorValue,
    patchProjectMetaInList,
    selectedRemoteBranch,
    setStatus
  ]);

  const gitWorkflowBusy = gitWorkflowAction !== null;
  const isAdding = gitWorkflowAction === "add";
  const isPulling = gitWorkflowAction === "pull";
  const isRefreshingGit = gitWorkflowAction === "refresh";
  const isPublishing = gitWorkflowAction === "publish";

  return {
    editorMode,
    editorProject,
    editorValue,
    setEditorValue,
    remoteHistory,
    gitBranches,
    gitUntrackedFiles,
    gitAddMode,
    setGitAddMode,
    selectedNewFiles,
    setSelectedNewFiles,
    selectedRemoteBranch,
    setSelectedRemoteBranch,
    remoteHistoryLoading,
    gitWorkflowBusy,
    isAdding,
    isPulling,
    isRefreshingGit,
    isPublishing,
    openEditor,
    closeEditor,
    loadRemoteHistory,
    runGitAdd,
    runGitPull,
    submitEditor
  };
};
