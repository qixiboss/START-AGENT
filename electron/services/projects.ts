import fs from "node:fs/promises";
import path from "node:path";
import { ListProjectsResult, ProjectItem, ProjectMeta, ProjectMetaSetRequest, ProjectMetaSetResult } from "../../src/types/ipc.js";
import { Settings } from "./types.js";

export type ProjectsServiceContext = {
  getCurrentRootPath: () => string;
  setCurrentRootPath: (value: string) => void;
  getSettingsState: () => Settings;
  flushSettingsPersist: () => Promise<void>;
  schedulePersistSettings: () => void;
};

export const isReadableDirectory = async (dirPath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return false;
    }
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
};

export const listProjects = async (context: ProjectsServiceContext): Promise<ListProjectsResult> => {
  const rootPath = context.getCurrentRootPath();
  const settingsState = context.getSettingsState();

  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const projects: ProjectItem[] = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const projectPath = path.join(rootPath, entry.name);
        return {
          name: entry.name,
          path: projectPath,
          meta: settingsState.projectMetaByPath[projectPath]
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    return { ok: true, projects, rootPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    return { ok: false, message, projects: [], rootPath };
  }
};

export const setRootPath = async (
  context: ProjectsServiceContext,
  nextPath: string
): Promise<ListProjectsResult> => {
  if (!(await isReadableDirectory(nextPath))) {
    return {
      ok: false,
      message: `Directory is not accessible: ${nextPath}`,
      projects: [],
      rootPath: context.getCurrentRootPath()
    };
  }

  const settingsState = context.getSettingsState();
  const previousPath = context.getCurrentRootPath();
  context.setCurrentRootPath(nextPath);
  settingsState.projectRoot = nextPath;

  try {
    await context.flushSettingsPersist();
  } catch (error) {
    context.setCurrentRootPath(previousPath);
    settingsState.projectRoot = previousPath;
    const message = error instanceof Error ? error.message : "Failed to save settings";
    return { ok: false, message, projects: [], rootPath: context.getCurrentRootPath() };
  }

  return listProjects(context);
};

export const setProjectMeta = async (
  context: ProjectsServiceContext,
  request: ProjectMetaSetRequest,
  ensureGitOrigin: (projectPath: string, githubUrl: string) => Promise<string | undefined>
): Promise<ProjectMetaSetResult> => {
  const settingsState = context.getSettingsState();
  const prev = settingsState.projectMetaByPath[request.projectPath] ?? {
    note: "",
    githubUrl: undefined,
    updatedAt: Date.now()
  };

  const next: ProjectMeta = {
    note: request.note !== undefined ? request.note : prev.note,
    githubUrl:
      request.githubUrl !== undefined
        ? request.githubUrl.trim() || undefined
        : prev.githubUrl,
    updatedAt: Date.now()
  };

  settingsState.projectMetaByPath[request.projectPath] = next;
  let warning: string | undefined;
  if (request.githubUrl !== undefined && next.githubUrl) {
    warning = await ensureGitOrigin(request.projectPath, next.githubUrl);
  }

  try {
    context.schedulePersistSettings();
    return { ok: true, meta: next, warning };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to save project metadata."
    };
  }
};
