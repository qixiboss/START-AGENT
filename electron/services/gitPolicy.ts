import fs from "node:fs/promises";
import path from "node:path";
import type { GitPolicy, GitPolicyLoadResult, GitSyncStrategy } from "../../src/types/ipc.js";

const DEFAULT_ALLOWED_COMMIT_TYPES = [
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
] as const;

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "release"] as const;

const DEFAULT_POLICY: GitPolicy = {
  workflow: "trunk_short_branch",
  pullStrategy: "rebase",
  protectedBranches: [...DEFAULT_PROTECTED_BRANCHES],
  commitConvention: {
    type: "conventional_commits",
    allowedTypes: [...DEFAULT_ALLOWED_COMMIT_TYPES],
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
};

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => {
  return typeof value === "object" && value !== null;
};

const isSyncStrategy = (value: unknown): value is GitSyncStrategy => {
  return value === "rebase" || value === "merge" || value === "ff-only";
};

const sanitizeStringArray = (value: unknown, fallback: readonly string[]): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const next = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (next.length === 0) {
    return [...fallback];
  }
  return Array.from(new Set(next));
};

const coerceBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === "boolean" ? value : fallback;
};

const coercePositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const applyPartialPolicy = (raw: unknown): GitPolicy => {
  if (!isObject(raw)) {
    return getDefaultGitPolicy();
  }

  const rawCommitConvention = isObject(raw.commitConvention) ? raw.commitConvention : {};
  const rawPushPolicy = isObject(raw.pushPolicy) ? raw.pushPolicy : {};
  const rawBranchPolicy = isObject(raw.branchPolicy) ? raw.branchPolicy : {};

  const pullStrategy = isSyncStrategy(raw.pullStrategy) ? raw.pullStrategy : DEFAULT_POLICY.pullStrategy;
  const commitConventionType =
    rawCommitConvention.type === "none" || rawCommitConvention.type === "conventional_commits"
      ? rawCommitConvention.type
      : DEFAULT_POLICY.commitConvention.type;

  return {
    workflow: "trunk_short_branch",
    pullStrategy,
    protectedBranches: sanitizeStringArray(raw.protectedBranches, DEFAULT_POLICY.protectedBranches),
    commitConvention: {
      type: commitConventionType,
      allowedTypes: sanitizeStringArray(rawCommitConvention.allowedTypes, DEFAULT_POLICY.commitConvention.allowedTypes),
      maxHeaderLength: coercePositiveInteger(rawCommitConvention.maxHeaderLength, DEFAULT_POLICY.commitConvention.maxHeaderLength)
    },
    pushPolicy: {
      requireUpToDateBeforePush: coerceBoolean(
        rawPushPolicy.requireUpToDateBeforePush,
        DEFAULT_POLICY.pushPolicy.requireUpToDateBeforePush
      ),
      warnWhenBehind: coerceBoolean(rawPushPolicy.warnWhenBehind, DEFAULT_POLICY.pushPolicy.warnWhenBehind),
      confirmPushToProtected: coerceBoolean(
        rawPushPolicy.confirmPushToProtected,
        DEFAULT_POLICY.pushPolicy.confirmPushToProtected
      )
    },
    branchPolicy: {
      suggestPattern:
        typeof rawBranchPolicy.suggestPattern === "string" && rawBranchPolicy.suggestPattern.trim().length > 0
          ? rawBranchPolicy.suggestPattern.trim()
          : DEFAULT_POLICY.branchPolicy.suggestPattern,
      warnIfNotMatch: coerceBoolean(rawBranchPolicy.warnIfNotMatch, DEFAULT_POLICY.branchPolicy.warnIfNotMatch)
    }
  };
};

export const getDefaultGitPolicy = (): GitPolicy => {
  return {
    workflow: DEFAULT_POLICY.workflow,
    pullStrategy: DEFAULT_POLICY.pullStrategy,
    protectedBranches: [...DEFAULT_POLICY.protectedBranches],
    commitConvention: {
      type: DEFAULT_POLICY.commitConvention.type,
      allowedTypes: [...DEFAULT_POLICY.commitConvention.allowedTypes],
      maxHeaderLength: DEFAULT_POLICY.commitConvention.maxHeaderLength
    },
    pushPolicy: {
      requireUpToDateBeforePush: DEFAULT_POLICY.pushPolicy.requireUpToDateBeforePush,
      warnWhenBehind: DEFAULT_POLICY.pushPolicy.warnWhenBehind,
      confirmPushToProtected: DEFAULT_POLICY.pushPolicy.confirmPushToProtected
    },
    branchPolicy: {
      suggestPattern: DEFAULT_POLICY.branchPolicy.suggestPattern,
      warnIfNotMatch: DEFAULT_POLICY.branchPolicy.warnIfNotMatch
    }
  };
};

export const loadGitPolicy = async (projectPath: string): Promise<GitPolicyLoadResult> => {
  const policyPath = path.join(projectPath, ".start-agent", "git-policy.json");
  try {
    const content = await fs.readFile(policyPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return {
      ok: true,
      policy: applyPartialPolicy(parsed),
      source: "project"
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {
        ok: true,
        policy: getDefaultGitPolicy(),
        source: "default"
      };
    }

    const message = error instanceof Error ? error.message : "Unknown git policy load error.";
    return {
      ok: false,
      message: `Failed to load .start-agent/git-policy.json: ${message}`,
      policy: getDefaultGitPolicy(),
      source: "default"
    };
  }
};
