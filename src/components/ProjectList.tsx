import { memo, useMemo } from "react";
import type { ProjectItem, TerminalLaunchRecord, ToolType } from "../types/ipc";

export type ProjectFilter = "all" | "recent";

type ProjectListProps = {
  collapsed: boolean;
  rootPath: string;
  projects: ProjectItem[];
  loading: boolean;
  error: string | null;
  selectedProjectPath: string | null;
  searchQuery: string;
  filter: ProjectFilter;
  launchRecords: TerminalLaunchRecord[];
  onSelectProject: (projectPath: string) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: ProjectFilter) => void;
  onToggleCollapse: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onLaunch: (project: ProjectItem, tool: ToolType) => void;
  onEditNote: (project: ProjectItem) => void;
  onEditGithub: (project: ProjectItem) => void;
  onCommitPush: (project: ProjectItem) => void;
};

export const ProjectList = memo(({
  collapsed,
  rootPath,
  projects,
  loading,
  error,
  selectedProjectPath,
  searchQuery,
  filter,
  launchRecords,
  onSelectProject,
  onSearchChange,
  onFilterChange,
  onToggleCollapse,
  onChooseFolder,
  onRefresh,
  onLaunch,
  onEditNote,
  onEditGithub,
  onCommitPush
}: ProjectListProps): JSX.Element => {
  const latestLaunchByPath = useMemo(() => {
    const map = new Map<string, TerminalLaunchRecord>();
    for (const item of launchRecords) {
      if (!map.has(item.projectPath)) {
        map.set(item.projectPath, item);
      }
    }
    return map;
  }, [launchRecords]);

  const selectedProject =
    projects.find((project) => project.path === selectedProjectPath) ?? null;

  const formatLaunchTime = (timestamp: number): string => {
    const deltaMs = Date.now() - timestamp;
    const deltaMin = Math.floor(deltaMs / 60000);
    if (deltaMin < 1) {
      return "just now";
    }
    if (deltaMin < 60) {
      return `${deltaMin}m ago`;
    }
    const deltaHour = Math.floor(deltaMin / 60);
    if (deltaHour < 24) {
      return `${deltaHour}h ago`;
    }
    const deltaDay = Math.floor(deltaHour / 24);
    return `${deltaDay}d ago`;
  };

  if (collapsed) {
    return (
      <aside className="panel project-panel collapsed" aria-label="Collapsed command deck">
        <div className="sidebar-rail compact">
          <button
            className="btn icon-btn collapsed-toggle compact"
            onClick={onToggleCollapse}
            aria-label="Expand command deck"
            title="Expand command deck"
          >
            <span className="collapsed-toggle-icon" aria-hidden="true">
              &gt;
            </span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <section className="panel project-panel">
      <header className="panel-header">
        <div>
          <h2>Command Deck</h2>
          <p className="hint">{rootPath}</p>
        </div>
        <div className="header-actions">
          <button
            className="btn secondary"
            onClick={onToggleCollapse}
            aria-label="Collapse command deck"
            title="Collapse command deck"
          >
            Collapse
          </button>
          <button className="btn secondary" onClick={onChooseFolder} disabled={loading}>
            Choose Folder
          </button>
          <button className="btn secondary" onClick={onRefresh} disabled={loading}>
            {loading ? "Scanning..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="deck-filters">
        <div className="deck-search-row">
          <input
            className="deck-search-input"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search project name/path..."
          />
          {searchQuery.trim().length > 0 ? (
            <button className="btn secondary deck-clear-btn" onClick={() => onSearchChange("")}>
              Clear
            </button>
          ) : null}
        </div>
        <div className="deck-filter-group">
          <button
            className={`btn secondary ${filter === "all" ? "selected" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            All
          </button>
          <button
            className={`btn secondary ${filter === "recent" ? "selected" : ""}`}
            onClick={() => onFilterChange("recent")}
          >
            Recent Launch
          </button>
        </div>
        <div className="deck-summary">
          <span>{projects.length} visible</span>
          <span>{selectedProject ? `Selected: ${selectedProject.name}` : "No selection"}</span>
        </div>
      </div>

      <div className="project-grid-wrapper">
        <div className="project-grid compact">
          {error ? <div className="error-box">{error}</div> : null}

          {!error && projects.length === 0 && !loading ? (
            <div className="empty">No project directories found in root.</div>
          ) : null}

          {projects.map((project) => {
            const latestLaunch = latestLaunchByPath.get(project.path);
            const selected = selectedProjectPath === project.path;
            return (
              <article
                key={project.path}
                className={`project-row ${selected ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className="project-row-select"
                  onClick={() => onSelectProject(project.path)}
                >
                  <div className="project-row-main">
                    <div className="project-row-title">{project.name}</div>
                    <div className="project-row-path">{project.path}</div>
                    {project.meta?.note?.trim() ? (
                      <div className="project-row-note-preview">{project.meta.note}</div>
                    ) : null}
                  </div>
                  <div className="project-row-tags">
                    {project.meta?.note ? <span className="pill tag">Note</span> : null}
                    {project.meta?.githubUrl ? <span className="pill tag">GitHub</span> : null}
                    {latestLaunch ? (
                      <>
                        <span className="pill tag accent">{latestLaunch.tool.toUpperCase()}</span>
                        <span className="project-row-launch-time">
                          {formatLaunchTime(latestLaunch.createdAt)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </button>
                <div className="project-row-actions">
                  <button className="btn tiny primary" onClick={() => onLaunch(project, "codex")}>
                    Codex
                  </button>
                  <button className="btn tiny ghost-accent" onClick={() => onLaunch(project, "claude")}>
                    Claude
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <footer className="deck-actions">
        {selectedProject ? (
          <>
            <div className="deck-actions-head">
              <strong>{selectedProject.name}</strong>
              <span className="hint">{selectedProject.path}</span>
            </div>
            <div className="actions primary-actions">
              <button className="btn primary" onClick={() => onLaunch(selectedProject, "codex")}>
                Open Codex
              </button>
              <button className="btn ghost-accent" onClick={() => onLaunch(selectedProject, "claude")}>
                Open Claude
              </button>
            </div>
            <div className="actions secondary-actions">
              <button className="btn secondary" onClick={() => onEditNote(selectedProject)}>
                Note
              </button>
              <button className="btn secondary" onClick={() => onEditGithub(selectedProject)}>
                GitHub
              </button>
              <button className="btn secondary" onClick={() => onCommitPush(selectedProject)}>
                Commit+Push
              </button>
            </div>
          </>
        ) : (
          <div className="empty">Select a project to enable actions.</div>
        )}
      </footer>
    </section>
  );
});

ProjectList.displayName = "ProjectList";
