import { useCallback, useState } from "react";
import { electronApi } from "../services/electronApi";
import type { ListProjectsResult, ProjectItem } from "../types/ipc";

type UseProjectsArgs = {
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => Promise<T>;
  setStatus: (value: string) => void;
};

export const useProjects = ({ withTimeout, setStatus }: UseProjectsArgs) => {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [rootPath, setRootPath] = useState<string>("Loading...");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const applyProjectsResult = useCallback(
    (result: ListProjectsResult, successStatus: string): boolean => {
      setRootPath(result.rootPath);
      if (!result.ok) {
        setProjects([]);
        setError(`Scan failed: ${result.message}`);
        setStatus("Scan failed");
        return false;
      }

      setError(null);
      setProjects(result.projects);
      setStatus(successStatus);
      return true;
    },
    [setStatus]
  );

  const scanProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withTimeout(
        electronApi.listProjects(),
        7000,
        "Project scan request timed out. Check Electron main/preload startup."
      );
      applyProjectsResult(result, `Found ${result.projects.length} directories`);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "Unknown scan error";
      setProjects([]);
      setError(`Scan failed: ${message}`);
      setStatus("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [applyProjectsResult, setStatus, withTimeout]);

  const applyRootChangeResult = useCallback(
    (result: ListProjectsResult): boolean => {
      return applyProjectsResult(result, `Root changed. Found ${result.projects.length} directories`);
    },
    [applyProjectsResult]
  );

  const patchProjectMetaInList = useCallback((projectPath: string, meta: ProjectItem["meta"]) => {
    setProjects((prev) =>
      prev.map((project) => (project.path === projectPath ? { ...project, meta } : project))
    );
  }, []);

  return {
    projects,
    rootPath,
    loading,
    error,
    setProjects,
    setRootPath,
    setError,
    scanProjects,
    applyRootChangeResult,
    patchProjectMetaInList
  };
};
