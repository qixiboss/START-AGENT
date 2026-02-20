export type ProjectItem = {
  name: string;
  path: string;
  meta?: ProjectMeta;
};

export type ProjectMeta = {
  note: string;
  githubUrl?: string;
  updatedAt: number;
};

export type ListProjectsResult =
  | { ok: true; projects: ProjectItem[]; rootPath: string }
  | { ok: false; message: string; projects: ProjectItem[]; rootPath: string };

export type ToolType = "codex" | "claude" | "opencode";
export type SessionToolType = ToolType | "shell";

export type TerminalLaunchRequest = {
  projectPath: string;
  projectName: string;
  tool: ToolType;
};

export type TerminalLaunchRecord = {
  id: string;
  projectPath: string;
  projectName: string;
  tool: ToolType;
  command: string;
  createdAt: number;
  processId?: number;
  note?: string;
};

export type TerminalLaunchResult =
  | { ok: true; record: TerminalLaunchRecord }
  | { ok: false; message: string; code?: "POWERSHELL_NOT_FOUND" | "LAUNCH_FAILED" };

export type TerminalLaunchListResult =
  | { ok: true; launches: TerminalLaunchRecord[] }
  | { ok: false; message: string; launches: TerminalLaunchRecord[] };

export type ProjectMetaSetRequest = {
  projectPath: string;
  note?: string;
  githubUrl?: string;
};

export type ProjectMetaSetResult =
  | { ok: true; meta: ProjectMeta; warning?: string }
  | { ok: false; message: string };

export type GitCommitRequest = {
  projectPath: string;
  message: string;
  remoteBranch?: string;
};

export type GitAddRequest = {
  projectPath: string;
  mode: "all" | "selected_new";
  files?: string[];
};

export type GitAddResult =
  | {
      ok: true;
      message: string;
      addedFiles: string[];
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      message: string;
      stdout: string;
      stderr: string;
    };

export type GitPullRequest = {
  projectPath: string;
  remoteBranch?: string;
};

export type GitPullResult =
  | {
      ok: true;
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      message: string;
      stdout: string;
      stderr: string;
    };

export type GitSyncStrategy = "rebase" | "merge" | "ff-only";

export type GitPolicy = {
  workflow: "trunk_short_branch";
  pullStrategy: GitSyncStrategy;
  protectedBranches: string[];
  commitConvention: {
    type: "conventional_commits" | "none";
    allowedTypes: string[];
    maxHeaderLength: number;
  };
  pushPolicy: {
    requireUpToDateBeforePush: boolean;
    warnWhenBehind: boolean;
    confirmPushToProtected: boolean;
  };
  branchPolicy: {
    suggestPattern: string;
    warnIfNotMatch: boolean;
  };
};

export type GitPolicyLoadResult =
  | {
      ok: true;
      policy: GitPolicy;
      source: "project" | "default";
      warning?: string;
    }
  | {
      ok: false;
      message: string;
      policy: GitPolicy;
      source: "default";
    };

export type GitValidationIssueCode =
  | "POLICY_LOAD_FAILED"
  | "COMMIT_FORMAT"
  | "COMMIT_TYPE"
  | "COMMIT_HEADER_TOO_LONG"
  | "BRANCH_NAME_PATTERN"
  | "PROTECTED_BRANCH_PUSH"
  | "REMOTE_BEHIND"
  | "UNCOMMITTED_CHANGES"
  | "REMOTE_BRANCH_MISSING";

export type GitValidationRisk = "low" | "medium" | "high";

export type GitValidationIssue = {
  level: "info" | "warn";
  risk: GitValidationRisk;
  code: GitValidationIssueCode;
  message: string;
  suggestion?: string;
};

export type GitPublishPrecheckRequest = {
  projectPath: string;
  message: string;
  remoteBranch?: string;
};

export type GitPublishPrecheckResult =
  | {
      ok: true;
      currentBranch: string;
      remoteBranch: string;
      upstreamRef: string;
      hasLocalChanges: boolean;
      aheadCount: number;
      behindCount: number;
      remoteBranchExists: boolean;
      issues: GitValidationIssue[];
      policy: GitPolicy;
    }
  | {
      ok: false;
      message: string;
      issues: GitValidationIssue[];
      policy?: GitPolicy;
    };

export type GitSyncRequest = {
  projectPath: string;
  remoteBranch?: string;
  strategy?: GitSyncStrategy;
};

export type GitSyncErrorCode =
  | "CONFLICT"
  | "REBASE_IN_PROGRESS"
  | "FF_ONLY_REJECTED"
  | "LOCAL_CHANGES_BLOCK"
  | "UNKNOWN";

export type GitSyncResult =
  | {
      ok: true;
      strategy: GitSyncStrategy;
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      strategy: GitSyncStrategy;
      message: string;
      code?: GitSyncErrorCode;
      suggestion?: string;
      stdout: string;
      stderr: string;
    };

export type GitStashEntry = {
  ref: string;
  branch?: string;
  summary: string;
};

export type GitStashListResult =
  | {
      ok: true;
      entries: GitStashEntry[];
    }
  | {
      ok: false;
      message: string;
      entries: GitStashEntry[];
    };

export type GitStashPushRequest = {
  projectPath: string;
  message?: string;
  includeUntracked?: boolean;
};

export type GitStashPushResult =
  | {
      ok: true;
      created: boolean;
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      message: string;
      stdout: string;
      stderr: string;
    };

export type GitStashPopRequest = {
  projectPath: string;
  stashRef?: string;
};

export type GitStashPopResult =
  | {
      ok: true;
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      message: string;
      stdout: string;
      stderr: string;
    };

export type GitGraphNode = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  refs: string;
  subject: string;
};

export type GitGraphResult =
  | {
      ok: true;
      nodes: GitGraphNode[];
    }
  | {
      ok: false;
      message: string;
      nodes: GitGraphNode[];
    };

export type GitUntrackedFilesResult =
  | {
      ok: true;
      files: string[];
    }
  | {
      ok: false;
      message: string;
      files: string[];
    };

export type GitBranchesResult =
  | {
      ok: true;
      currentBranch: string;
      branches: string[];
    }
  | {
      ok: false;
      message: string;
      currentBranch: string;
      branches: string[];
    };

export type RemoteCommitEntry = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type GitRemoteHistoryResult =
  | {
      ok: true;
      upstreamRef: string;
      localHead: string;
      remoteHead: string;
      isUpToDate: boolean;
      hasLocalChanges: boolean;
      aheadCount: number;
      behindCount: number;
      canPush: boolean;
      commits: RemoteCommitEntry[];
    }
  | {
      ok: false;
      message: string;
    };

export type GitCommitResult =
  | {
      ok: true;
      step: "add" | "commit" | "push";
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      step: "add" | "commit" | "push" | "validate";
      message: string;
      stdout: string;
      stderr: string;
    };

export type PickDirectoryResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; message: string };

export type TerminalSessionStatus = "starting" | "running" | "exited" | "error";

export type TerminalSessionInfo = {
  id: string;
  projectPath: string;
  projectName: string;
  tool: SessionToolType;
  command: string;
  createdAt: number;
  processId?: number;
  status: TerminalSessionStatus;
  title: string;
  pinned?: boolean;
};

export type TerminalSessionSnapshot = {
  id: string;
  projectPath: string;
  projectName: string;
  tool: SessionToolType;
  command: string;
  createdAt: number;
  updatedAt: number;
  status: TerminalSessionStatus;
  title: string;
  outputPreview: string[];
};

export type TerminalSessionCreateRequest = {
  projectPath: string;
  projectName: string;
  tool: SessionToolType;
};

export type TerminalSessionCreateResult =
  | { ok: true; session: TerminalSessionInfo }
  | { ok: false; message: string };

export type TerminalSessionInputResult =
  | { ok: true; accepted?: boolean; queueLength?: number }
  | { ok: false; message: string; code?: "APPROVAL_REQUIRED" };

export type TerminalSessionListResult =
  | { ok: true; sessions: TerminalSessionInfo[] }
  | { ok: false; message: string; sessions: TerminalSessionInfo[] };

export type TerminalSessionRestoreListResult =
  | { ok: true; snapshots: TerminalSessionSnapshot[] }
  | { ok: false; message: string; snapshots: TerminalSessionSnapshot[] };

export type TerminalSessionOutputChunk = {
  sessionId: string;
  data: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: number;
};

export type TerminalSessionStatusEvent = {
  sessionId: string;
  status: TerminalSessionStatus;
  message?: string;
  timestamp: number;
};

export type TerminalSessionInputStateValue = "idle" | "sending" | "blocked" | "error";

export type TerminalSessionInputState = {
  sessionId: string;
  state: TerminalSessionInputStateValue;
  queueLength: number;
  message?: string;
  timestamp: number;
};

export type TerminalApprovalRequest = {
  requestId: string;
  sessionId: string;
  command: string;
  createdAt: number;
};

export type TerminalApprovalDecision = "allow_once" | "allow_session" | "deny";

export type TerminalApprovalSubmitResult =
  | { ok: true }
  | { ok: false; message: string };

export type QuotaProvider = "codex_chatgpt" | "volcengine_coding_plan";
export type QuotaStatus = "available" | "manual_only" | "error";
export type QuotaMethod = "api" | "command" | "page";
export type QuotaBrowserSource = "auto" | "chrome" | "edge";
export type QuotaSecretStorageMode = "encrypted" | "plain";

export type QuotaItem = {
  provider: QuotaProvider;
  status: QuotaStatus;
  title: string;
  detail: string;
  checkedAt: number;
  consoleUrl: string;
};

export type QuotaListResult =
  | { ok: true; items: QuotaItem[] }
  | { ok: false; message: string; items: QuotaItem[] };

export type QuotaAuthProviderConfig = {
  provider: QuotaProvider;
  title: string;
  consoleUrl: string;
  apiUrl: string;
  methods: QuotaMethod[];
  commandJson: string;
  hasCookie: boolean;
  updatedAt: number;
};

export type QuotaAuthListResult =
  | { ok: true; providers: QuotaAuthProviderConfig[]; storageMode: QuotaSecretStorageMode }
  | { ok: false; message: string; providers: QuotaAuthProviderConfig[]; storageMode: QuotaSecretStorageMode };

export type QuotaAuthSaveRequest = {
  provider: QuotaProvider;
  cookie?: string;
  clearCookie?: boolean;
  apiUrl?: string;
  consoleUrl?: string;
  methods?: QuotaMethod[];
  commandJson?: string;
};

export type QuotaAuthSaveResult =
  | { ok: true; config: QuotaAuthProviderConfig; storageMode: QuotaSecretStorageMode; warning?: string }
  | { ok: false; message: string };

export type QuotaAuthImportRequest = {
  provider: QuotaProvider;
  browser?: QuotaBrowserSource;
};

export type QuotaAuthImportResult =
  | {
      ok: true;
      config: QuotaAuthProviderConfig;
      storageMode: QuotaSecretStorageMode;
      browser: Exclude<QuotaBrowserSource, "auto">;
      profile: string;
      cookieCount: number;
      warning?: string;
    }
  | { ok: false; message: string };

export type QuotaAuthAuthorizeInAppRequest = {
  provider: QuotaProvider;
};

export type QuotaAuthAuthorizeInAppResult =
  | {
      ok: true;
      config: QuotaAuthProviderConfig;
      storageMode: QuotaSecretStorageMode;
      cookieCount: number;
      warning?: string;
    }
  | { ok: false; message: string; cancelled?: boolean };

export const IpcChannels = {
  RootGet: "root:get",
  RootSet: "root:set",
  ListProjects: "projects:list",
  ProjectMetaSet: "projectMeta:set",
  GitPolicyGet: "git:policy:get",
  GitPublishPrecheck: "git:publishPrecheck",
  GitSync: "git:sync",
  GitStashList: "git:stash:list",
  GitStashPush: "git:stash:push",
  GitStashPop: "git:stash:pop",
  GitGraph: "git:graph",
  GitCommitAndPush: "git:commitAndPush",
  GitRemoteHistory: "git:remoteHistory",
  GitBranches: "git:branches",
  GitAdd: "git:add",
  GitPull: "git:pull",
  GitUntrackedFiles: "git:untrackedFiles",
  DialogPickDirectory: "dialog:pickDirectory",
  TerminalLaunch: "terminal:launch",
  TerminalLaunchesList: "terminal:launches:list",
  TerminalLaunchesFocus: "terminal:launches:focus",
  TerminalLaunchesNoteSet: "terminal:launches:note:set",
  TerminalLaunchesRemove: "terminal:launches:remove",
  TerminalSessionCreate: "terminal:session:create",
  TerminalSessionInput: "terminal:session:input",
  TerminalSessionResize: "terminal:session:resize",
  TerminalSessionClose: "terminal:session:close",
  TerminalSessionList: "terminal:session:list",
  TerminalSessionRestoreList: "terminal:session:restore:list",
  TerminalApprovalSubmit: "terminal:approval:submit",
  TerminalSessionOutputEvent: "terminal:session:output",
  TerminalSessionStatusEvent: "terminal:session:status",
  TerminalSessionInputStateEvent: "terminal:session:inputState",
  TerminalApprovalRequiredEvent: "terminal:session:approvalRequired",
  QuotaList: "quota:list",
  QuotaAuthGet: "quota:auth:get",
  QuotaAuthSave: "quota:auth:save",
  QuotaAuthImportBrowser: "quota:auth:importBrowser",
  QuotaAuthAuthorizeInApp: "quota:auth:authorizeInApp",
  SystemOpenExternal: "system:openExternal",
  WindowMinimize: "window:minimize",
  WindowMaximize: "window:maximize",
  WindowClose: "window:close",
  WindowIsMaximized: "window:isMaximized"
} as const;

export type DesktopApi = {
  getRootPath: () => Promise<{ rootPath: string }>;
  setRootPath: (path: string) => Promise<ListProjectsResult>;
  listProjects: () => Promise<ListProjectsResult>;
  setProjectMeta: (request: ProjectMetaSetRequest) => Promise<ProjectMetaSetResult>;
  getGitPolicy: (projectPath: string) => Promise<GitPolicyLoadResult>;
  precheckGitPublish: (request: GitPublishPrecheckRequest) => Promise<GitPublishPrecheckResult>;
  gitSync: (request: GitSyncRequest) => Promise<GitSyncResult>;
  listGitStash: (projectPath: string) => Promise<GitStashListResult>;
  pushGitStash: (request: GitStashPushRequest) => Promise<GitStashPushResult>;
  popGitStash: (request: GitStashPopRequest) => Promise<GitStashPopResult>;
  getGitGraph: (projectPath: string, limit?: number) => Promise<GitGraphResult>;
  commitAndPush: (request: GitCommitRequest) => Promise<GitCommitResult>;
  getRemoteHistory: (projectPath: string) => Promise<GitRemoteHistoryResult>;
  listGitBranches: (projectPath: string) => Promise<GitBranchesResult>;
  gitAdd: (request: GitAddRequest) => Promise<GitAddResult>;
  gitPull: (request: GitPullRequest) => Promise<GitPullResult>;
  listGitUntrackedFiles: (projectPath: string) => Promise<GitUntrackedFilesResult>;
  pickDirectory: () => Promise<PickDirectoryResult>;
  launchTerminal: (request: TerminalLaunchRequest) => Promise<TerminalLaunchResult>;
  listTerminalLaunches: () => Promise<TerminalLaunchListResult>;
  focusTerminalLaunch: (recordId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  setTerminalLaunchNote: (
    recordId: string,
    note: string
  ) => Promise<{ ok: true; record: TerminalLaunchRecord } | { ok: false; message: string }>;
  removeTerminalLaunch: (recordId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  createTerminalSession: (request: TerminalSessionCreateRequest) => Promise<TerminalSessionCreateResult>;
  inputTerminalSession: (sessionId: string, data: string) => Promise<TerminalSessionInputResult>;
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => Promise<{ ok: true } | { ok: false; message: string }>;
  closeTerminalSession: (sessionId: string, force?: boolean) => Promise<{ ok: true } | { ok: false; message: string }>;
  listTerminalSessions: () => Promise<TerminalSessionListResult>;
  listTerminalSessionSnapshots: () => Promise<TerminalSessionRestoreListResult>;
  submitTerminalApproval: (
    sessionId: string,
    requestId: string,
    decision: TerminalApprovalDecision
  ) => Promise<TerminalApprovalSubmitResult>;
  onTerminalSessionOutput: (handler: (chunk: TerminalSessionOutputChunk) => void) => () => void;
  onTerminalSessionStatus: (handler: (event: TerminalSessionStatusEvent) => void) => () => void;
  onTerminalSessionInputState: (handler: (event: TerminalSessionInputState) => void) => () => void;
  onTerminalApprovalRequired: (handler: (event: TerminalApprovalRequest) => void) => () => void;
  listQuotas: () => Promise<QuotaListResult>;
  getQuotaAuthConfigs: () => Promise<QuotaAuthListResult>;
  saveQuotaAuthConfig: (request: QuotaAuthSaveRequest) => Promise<QuotaAuthSaveResult>;
  importQuotaAuthFromBrowser: (request: QuotaAuthImportRequest) => Promise<QuotaAuthImportResult>;
  authorizeQuotaInApp: (request: QuotaAuthAuthorizeInAppRequest) => Promise<QuotaAuthAuthorizeInAppResult>;
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  minimizeWindow: () => Promise<{ ok: true }>;
  maximizeWindow: () => Promise<{ ok: true }>;
  closeWindow: () => Promise<{ ok: true }>;
  isMaximized: () => Promise<{ isMaximized: boolean }>;
};
