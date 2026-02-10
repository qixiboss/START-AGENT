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

export type SessionPreset = {
  id: string;
  name: string;
  tool: ToolType;
  model: string;
  systemPrompt: string;
  launchCommand: string;
  contextFiles: string[];
  readonly: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SessionPresetListResult =
  | { ok: true; presets: SessionPreset[] }
  | { ok: false; message: string; presets: SessionPreset[] };

export type SessionPresetSaveRequest = {
  id?: string;
  name: string;
  tool: ToolType;
  model?: string;
  systemPrompt?: string;
  launchCommand?: string;
  contextFiles?: string[];
};

export type SessionPresetSaveResult =
  | { ok: true; preset: SessionPreset; presets: SessionPreset[] }
  | { ok: false; message: string };

export type SessionPresetDeleteResult =
  | { ok: true; presets: SessionPreset[] }
  | { ok: false; message: string };

export type TerminalCreateRequest = {
  projectPath: string;
  tool?: ToolType;
  presetId?: string;
};

export type TerminalSessionInfo = {
  id: string;
  projectPath: string;
  tool: ToolType;
  title: string;
  presetId?: string;
  presetName?: string;
};

export type TerminalCreateResult =
  | { ok: true; session: TerminalSessionInfo }
  | { ok: false; message: string };

export type TerminalDataEvent = {
  sessionId: string;
  chunk: string;
};

export type TerminalExitEvent = {
  sessionId: string;
  code: number;
};

export type TerminalErrorEvent = {
  sessionId: string;
  message: string;
};

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
  SessionPresetsList: "sessionPresets:list",
  SessionPresetsSave: "sessionPresets:save",
  SessionPresetsDelete: "sessionPresets:delete",
  DialogPickDirectory: "dialog:pickDirectory",
  TerminalCreate: "terminal:create",
  TerminalWrite: "terminal:write",
  TerminalResize: "terminal:resize",
  TerminalClose: "terminal:close",
  TerminalData: "terminal:data",
  TerminalExit: "terminal:exit",
  TerminalError: "terminal:error"
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
  listSessionPresets: () => Promise<SessionPresetListResult>;
  saveSessionPreset: (request: SessionPresetSaveRequest) => Promise<SessionPresetSaveResult>;
  deleteSessionPreset: (id: string) => Promise<SessionPresetDeleteResult>;
  pickDirectory: () => Promise<PickDirectoryResult>;
  createTerminal: (request: TerminalCreateRequest) => Promise<TerminalCreateResult>;
  writeTerminal: (sessionId: string, data: string) => void;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
  closeTerminal: (sessionId: string) => void;
  onTerminalData: (handler: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (handler: (event: TerminalExitEvent) => void) => () => void;
  onTerminalError: (handler: (event: TerminalErrorEvent) => void) => () => void;
};
