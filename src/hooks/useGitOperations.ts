import { useCallback, useRef, useState, type SetStateAction } from "react";
import { electronApi } from "../services/electronApi";
import type {
  GitBranchesResult,
  GitGraphResult,
  GitPolicyLoadResult,
  GitPublishPrecheckResult,
  GitRemoteHistoryResult,
  GitStashEntry,
  GitSyncResult,
  GitSyncStrategy,
  GitUntrackedFilesResult,
  ProjectItem,
  ProjectMeta
} from "../types/ipc";

export type EditorMode = "note" | "github" | "commit";
type GitWorkflowAction =
  | "add"
  | "sync"
  | "refresh"
  | "publish"
  | "precheck"
  | "stash_push"
  | "stash_pop"
  | null;

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
  const [gitPolicy, setGitPolicy] = useState<GitPolicyLoadResult | null>(null);
  const [publishPrecheck, setPublishPrecheck] = useState<GitPublishPrecheckResult | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<GitSyncResult | null>(null);
  const [gitGraph, setGitGraph] = useState<GitGraphResult | null>(null);
  const [stashEntries, setStashEntries] = useState<GitStashEntry[]>([]);
  const [stashMessage, setStashMessage] = useState<string>("");
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState<boolean>(true);
  const [allowProtectedPush, setAllowProtectedPush] = useState<boolean>(false);
  const [allowBehindPush, setAllowBehindPush] = useState<boolean>(false);
  const [gitSyncStrategy, setGitSyncStrategyState] = useState<GitSyncStrategy>("rebase");
  const [gitAddMode, setGitAddMode] = useState<"all" | "selected_new">("all");
  const [selectedNewFiles, setSelectedNewFiles] = useState<string[]>([]);
  const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>("");
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState<boolean>(false);
  const [gitWorkflowAction, setGitWorkflowAction] = useState<GitWorkflowAction>(null);
  const gitSyncStrategyUserSelectedRef = useRef<boolean>(false);

  const setGitSyncStrategy = useCallback((strategy: SetStateAction<GitSyncStrategy>) => {
    gitSyncStrategyUserSelectedRef.current = true;
    setGitSyncStrategyState(strategy);
  }, []);

  const loadCommitContext = useCallback(
    async (project: ProjectItem, showSuccessStatus: boolean) => {
      setRemoteHistoryLoading(true);
      try {
        const [historyResult, branchesResult, untrackedResult, policyResult, stashResult, graphResult] = await Promise.all([
          electronApi.getRemoteHistory(project.path),
          electronApi.listGitBranches(project.path),
          electronApi.listGitUntrackedFiles(project.path),
          electronApi.getGitPolicy(project.path),
          electronApi.listGitStash(project.path),
          electronApi.getGitGraph(project.path, 30)
        ]);

        setRemoteHistory(historyResult);
        setGitBranches(branchesResult);
        setGitUntrackedFiles(untrackedResult);
        setGitPolicy(policyResult);
        setGitGraph(graphResult);
        setPublishPrecheck(null);
        setLastSyncResult(null);

        if (!gitSyncStrategyUserSelectedRef.current) {
          setGitSyncStrategyState(policyResult.policy.pullStrategy);
        }

        if (branchesResult.ok) {
          setSelectedRemoteBranch((prev) => {
            const nextValue = prev.trim().length > 0 ? prev : branchesResult.currentBranch || branchesResult.branches[0] || "";
            if (nextValue !== prev) {
              setAllowProtectedPush(false);
              setAllowBehindPush(false);
            }
            return nextValue;
          });
        }
        if (untrackedResult.ok) {
          setSelectedNewFiles((prev) => prev.filter((item) => untrackedResult.files.includes(item)));
        }
        if (stashResult.ok) {
          setStashEntries(stashResult.entries);
        } else {
          setStashEntries([]);
        }

        if (!historyResult.ok) {
          setStatus(`Remote history failed: ${historyResult.message}`);
        } else if (!branchesResult.ok) {
          setStatus(`Branch list failed: ${branchesResult.message}`);
        } else if (!untrackedResult.ok) {
          setStatus(`Untracked files failed: ${untrackedResult.message}`);
        } else if (!policyResult.ok) {
          setStatus(`Git policy warning: ${policyResult.message}`);
        } else if (!stashResult.ok) {
          setStatus(`Stash list failed: ${stashResult.message}`);
        } else if (!graphResult.ok) {
          setStatus(`Git graph failed: ${graphResult.message}`);
        } else if (showSuccessStatus) {
          if (historyResult.canPush) {
            setStatus(
              `Git context refreshed: ${historyResult.aheadCount} local commit(s) can be pushed to ${historyResult.upstreamRef}.`
            );
          } else if (historyResult.hasLocalChanges) {
            setStatus("Git context refreshed: local changes detected, commit before push.");
          } else if (historyResult.behindCount > 0) {
            setStatus(
              `Git context refreshed: remote has ${historyResult.behindCount} newer commit(s), sync before push.`
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
        setGitPolicy({
          ok: false,
          message,
          source: "default",
          policy: {
            workflow: "trunk_short_branch",
            pullStrategy: "rebase",
            protectedBranches: ["main", "master", "release"],
            commitConvention: {
              type: "conventional_commits",
              allowedTypes: [
                "feat",
                "fix",
                "chore",
                "docs",
                "refactor",
                "test",
                "build",
                "ci",
                "perf",
                "revert",
                "style"
              ],
              maxHeaderLength: 72
            },
            pushPolicy: {
              requireUpToDateBeforePush: true,
              warnWhenBehind: true,
              confirmPushToProtected: true
            },
            branchPolicy: {
              suggestPattern: "^(feat|fix|chore|hotfix|docs)/[a-z0-9._-]+$",
              warnIfNotMatch: true
            }
          }
        });
        setGitGraph({ ok: false, message, nodes: [] });
        setStashEntries([]);
        setPublishPrecheck(null);
        setLastSyncResult(null);
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
      setGitPolicy(null);
      setPublishPrecheck(null);
      setLastSyncResult(null);
      setGitGraph(null);
      setStashEntries([]);
      setStashMessage("");
      setStashIncludeUntracked(true);
      setAllowProtectedPush(false);
      setAllowBehindPush(false);
      gitSyncStrategyUserSelectedRef.current = false;
      setGitSyncStrategyState("rebase");
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
    setGitPolicy(null);
    setPublishPrecheck(null);
    setLastSyncResult(null);
    setGitGraph(null);
    setStashEntries([]);
    setStashMessage("");
    setStashIncludeUntracked(true);
    setAllowProtectedPush(false);
    setAllowBehindPush(false);
    gitSyncStrategyUserSelectedRef.current = false;
    setGitSyncStrategyState("rebase");
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

  const runPublishPrecheck = useCallback(async () => {
    if (!editorProject) {
      return null;
    }
    const remoteBranch = selectedRemoteBranch.trim();
    if (!remoteBranch) {
      setStatus("Please select a remote branch before precheck.");
      return null;
    }

    setGitWorkflowAction("precheck");
    setStatus(`Running publish precheck for ${editorProject.name}...`);
    try {
      const precheckResult = await electronApi.precheckGitPublish({
        projectPath: editorProject.path,
        message: editorValue,
        remoteBranch
      });
      setPublishPrecheck(precheckResult);
      if (!precheckResult.ok) {
        setStatus(`Precheck failed: ${precheckResult.message}`);
        return precheckResult;
      }
      const hasHighRiskBehind = precheckResult.issues.some(
        (item) => item.code === "REMOTE_BEHIND" && item.risk === "high"
      );
      if (!hasHighRiskBehind) {
        setAllowBehindPush(false);
      }
      const warnCount = precheckResult.issues.filter((item) => item.level === "warn").length;
      const infoCount = precheckResult.issues.filter((item) => item.level === "info").length;
      if (warnCount > 0 || infoCount > 0) {
        setStatus(`Precheck completed with ${warnCount} warning(s) and ${infoCount} info item(s).`);
      } else {
        setStatus("Precheck passed with no warnings.");
      }
      return precheckResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown precheck error";
      setStatus(`Precheck failed: ${message}`);
      return null;
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, editorValue, selectedRemoteBranch, setStatus]);

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
      setStatus("Please select a remote branch before sync.");
      return;
    }
    setGitWorkflowAction("sync");
    setLastSyncResult(null);
    setStatus(`Running git sync (${gitSyncStrategy}) origin/${remoteBranch} for ${editorProject.name}...`);
    try {
      const result = await electronApi.gitSync({
        projectPath: editorProject.path,
        remoteBranch,
        strategy: gitSyncStrategy
      });
      if (!result.ok) {
        setLastSyncResult(result);
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(
          `Git Sync failed: ${result.message}${errLine ? ` | ${errLine}` : ""}${
            result.suggestion ? ` | Suggestion: ${result.suggestion}` : ""
          }`
        );
        return;
      }
      setLastSyncResult(null);
      setStatus(`Git Sync success: ${result.message}`);
      setAllowBehindPush(false);
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git sync error";
      setLastSyncResult({
        ok: false,
        strategy: gitSyncStrategy,
        code: "UNKNOWN",
        message,
        suggestion: "Open terminal and inspect status before retrying sync.",
        stdout: "",
        stderr: ""
      });
      setStatus(`Git Sync failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, gitSyncStrategy, loadCommitContext, selectedRemoteBranch, setStatus]);

  const runGitStashPush = useCallback(async () => {
    if (!editorProject) {
      return;
    }
    setGitWorkflowAction("stash_push");
    setStatus(`Creating stash for ${editorProject.name}...`);
    try {
      const result = await electronApi.pushGitStash({
        projectPath: editorProject.path,
        message: stashMessage,
        includeUntracked: stashIncludeUntracked
      });
      if (!result.ok) {
        const errLine =
          result.stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        setStatus(`Git Stash failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
        return;
      }
      setStatus(`Git Stash success: ${result.message}`);
      setStashMessage("");
      await loadCommitContext(editorProject, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown git stash push error";
      setStatus(`Git Stash failed: ${message}`);
    } finally {
      setGitWorkflowAction(null);
    }
  }, [editorProject, loadCommitContext, setStatus, stashIncludeUntracked, stashMessage]);

  const runGitStashPop = useCallback(
    async (stashRef?: string) => {
      if (!editorProject) {
        return;
      }
      setGitWorkflowAction("stash_pop");
      setStatus(`Applying stash for ${editorProject.name}...`);
      try {
        const result = await electronApi.popGitStash({
          projectPath: editorProject.path,
          stashRef
        });
        if (!result.ok) {
          const errLine =
            result.stderr
              ?.split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line.length > 0) ?? "";
          setStatus(`Git Stash pop failed: ${result.message}${errLine ? ` | ${errLine}` : ""}`);
          return;
        }
        setStatus(`Git Stash pop success: ${result.message}`);
        await loadCommitContext(editorProject, false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown git stash pop error";
        setStatus(`Git Stash pop failed: ${message}`);
      } finally {
        setGitWorkflowAction(null);
      }
    },
    [editorProject, loadCommitContext, setStatus]
  );

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
        setStatus(`Running publish precheck for ${editorProject.name}...`);

        const precheckResult = await electronApi.precheckGitPublish({
          projectPath: editorProject.path,
          message,
          remoteBranch
        });
        setPublishPrecheck(precheckResult);
        if (!precheckResult.ok) {
          setStatus(`Precheck failed: ${precheckResult.message}`);
          return;
        }

        const protectedBranchIssue = precheckResult.issues.find((item) => item.code === "PROTECTED_BRANCH_PUSH");
        if (protectedBranchIssue && !allowProtectedPush) {
          setStatus("Protected branch push requires confirmation. Enable confirmation and publish again.");
          return;
        }

        const behindRiskIssue = precheckResult.issues.find(
          (item) => item.code === "REMOTE_BEHIND" && item.risk === "high"
        );
        if (behindRiskIssue && !allowBehindPush) {
          setStatus("Remote is ahead and policy prefers sync first. Click Sync or enable override, then publish again.");
          return;
        }

        const warningIssues = precheckResult.issues.filter((item) => item.level === "warn");
        if (warningIssues.length > 0) {
          setStatus(`Publishing with ${warningIssues.length} precheck warning(s)...`);
        } else {
          setStatus(`Running git commit and git push for ${editorProject.name}...`);
        }

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
    allowBehindPush,
    allowProtectedPush,
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
  const isPulling = gitWorkflowAction === "sync";
  const isRefreshingGit = gitWorkflowAction === "refresh";
  const isPublishing = gitWorkflowAction === "publish";
  const isRunningPrecheck = gitWorkflowAction === "precheck";
  const isStashing = gitWorkflowAction === "stash_push" || gitWorkflowAction === "stash_pop";

  return {
    editorMode,
    editorProject,
    editorValue,
    setEditorValue,
    remoteHistory,
    gitBranches,
    gitUntrackedFiles,
    gitPolicy,
    publishPrecheck,
    lastSyncResult,
    gitGraph,
    stashEntries,
    stashMessage,
    setStashMessage,
    stashIncludeUntracked,
    setStashIncludeUntracked,
    allowProtectedPush,
    setAllowProtectedPush,
    allowBehindPush,
    setAllowBehindPush,
    gitSyncStrategy,
    setGitSyncStrategy,
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
    isRunningPrecheck,
    isStashing,
    openEditor,
    closeEditor,
    loadRemoteHistory,
    runPublishPrecheck,
    runGitAdd,
    runGitPull,
    runGitStashPush,
    runGitStashPop,
    submitEditor
  };
};
