import {
  ProjectMeta,
  TerminalLaunchRecord,
  TerminalSessionSnapshot
} from "../../src/types/ipc.js";

export type Settings = {
  projectRoot?: string;
  projectMetaByPath: Record<string, ProjectMeta>;
  terminalLaunches: TerminalLaunchRecord[];
  terminalSessionSnapshots: TerminalSessionSnapshot[];
};
