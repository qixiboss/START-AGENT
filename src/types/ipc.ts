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

export type ToolType = "codex" | "claude";

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

export type ConversationEntry = {
  id: string;
  projectPath: string;
  tool: ToolType;
  sessionId: string;
  input: string;
  createdAt: number;
};

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

export const IpcChannels = {
  RootGet: "root:get",
  RootSet: "root:set",
  ListProjects: "projects:list",
  ProjectMetaSet: "projectMeta:set",
  GitCommitAndPush: "git:commitAndPush",
  GitRemoteHistory: "git:remoteHistory",
  ConversationList: "conversation:list",
  ConversationClear: "conversation:clear",
  DialogPickDirectory: "dialog:pickDirectory",
  TerminalLaunch: "terminal:launch",
  TerminalLaunchesList: "terminal:launches:list",
  TerminalLaunchesFocus: "terminal:launches:focus",
  TerminalLaunchesNoteSet: "terminal:launches:note:set",
  TerminalLaunchesRemove: "terminal:launches:remove"
} as const;

export type DesktopApi = {
  getRootPath: () => Promise<{ rootPath: string }>;
  setRootPath: (path: string) => Promise<ListProjectsResult>;
  listProjects: () => Promise<ListProjectsResult>;
  setProjectMeta: (request: ProjectMetaSetRequest) => Promise<ProjectMetaSetResult>;
  commitAndPush: (request: GitCommitRequest) => Promise<GitCommitResult>;
  getRemoteHistory: (projectPath: string) => Promise<GitRemoteHistoryResult>;
  listConversation: (projectPath: string) => Promise<ConversationEntry[]>;
  clearConversation: (projectPath: string) => Promise<{ ok: true }>;
  pickDirectory: () => Promise<PickDirectoryResult>;
  launchTerminal: (request: TerminalLaunchRequest) => Promise<TerminalLaunchResult>;
  listTerminalLaunches: () => Promise<TerminalLaunchListResult>;
  focusTerminalLaunch: (recordId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  setTerminalLaunchNote: (
    recordId: string,
    note: string
  ) => Promise<{ ok: true; record: TerminalLaunchRecord } | { ok: false; message: string }>;
  removeTerminalLaunch: (recordId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
};
