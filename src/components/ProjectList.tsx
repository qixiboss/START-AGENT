import { memo } from "react";
import type { ProjectItem, SessionPreset, ToolType } from "../types/ipc";
import { memo, useEffect, useMemo, useState } from "react";
import type { ProjectHealthItem, ProjectItem, ToolType } from "../types/ipc";

type ProjectListProps = {
  collapsed: boolean;
  rootPath: string;
  projects: ProjectItem[];
  sessionPresets: SessionPreset[];
  loading: boolean;
  error: string | null;
  healthItems: ProjectHealthItem[];
  healthLoading: boolean;
  healthError: string | null;
  healthGeneratedAt: number | null;
  onToggleCollapse: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onManagePresets: () => void;
  onRefreshHealth: () => void;
  onLaunch: (project: ProjectItem, tool: ToolType) => void;
  onLaunchPreset: (project: ProjectItem, presetId: string) => void;
  onEditNote: (project: ProjectItem) => void;
  onEditGithub: (project: ProjectItem) => void;
  onCommitPush: (project: ProjectItem) => void;
  onViewConversation: (project: ProjectItem) => void;
};

type ProjectCardProps = {
  project: ProjectItem;
  sessionPresets: SessionPreset[];
  onLaunch: (project: ProjectItem, tool: ToolType) => void;
  onLaunchPreset: (project: ProjectItem, presetId: string) => void;
  onEditNote: (project: ProjectItem) => void;
  onEditGithub: (project: ProjectItem) => void;
  onCommitPush: (project: ProjectItem) => void;
  onViewConversation: (project: ProjectItem) => void;
};

type ProjectHealthCardProps = ProjectCardProps & {
  health: ProjectHealthItem;
};

type HealthViewMode = "projects" | "health";
type HealthSortMode = "risk-first" | "healthy-first";
type HealthFilterMode = "all" | "high-risk" | "dirty" | "build-failed";

const BUILD_STATUS_LABEL: Record<ProjectHealthItem["buildStatus"], string> = {
  pass: "Passing",
  fail: "Failed",
  missing_script: "No Script",
  missing_manifest: "No package.json",
  skipped: "Skipped",
  unknown: "Unknown"
};

const BUILD_STATUS_CLASS: Record<ProjectHealthItem["buildStatus"], string> = {
  pass: "build-pass",
  fail: "build-fail",
  missing_script: "build-missing",
  missing_manifest: "build-missing",
  skipped: "build-skip",
  unknown: "build-unknown"
};

const formatLastCommit = (timestamp: number | null): string => {
  if (!timestamp) {
    return "No commit found";
  }
  const diffMs = Date.now() - timestamp;
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < dayMs) {
    return "Within 24h";
  }
  const days = Math.floor(diffMs / dayMs);
  return `${days}d ago`;
};

const formatDependencyScale = (count: number | null): string => {
  if (count === null) {
    return "N/A";
  }
  if (count < 40) {
    return `${count} (Small)`;
  }
  if (count < 90) {
    return `${count} (Medium)`;
  }
  return `${count} (Large)`;
};

const ActionRows = memo(
  ({
    project,
    onLaunch,
    onEditNote,
    onEditGithub,
    onCommitPush,
    onViewConversation
  }: ProjectCardProps): JSX.Element => (
    <>
      <div className="actions">
        <button className="btn primary" onClick={() => onLaunch(project, "codex")}>
          Open Codex
        </button>
        <button className="btn alt" onClick={() => onLaunch(project, "claude")}>
          Open Claude
        </button>
      </div>
      <div className="actions">
        <button className="btn secondary" onClick={() => onEditNote(project)}>
          Note
        </button>
        <button className="btn secondary" onClick={() => onEditGithub(project)}>
          GitHub
        </button>
        <button className="btn secondary" onClick={() => onCommitPush(project)}>
          Commit+Push
        </button>
        <button className="btn secondary" onClick={() => onViewConversation(project)}>
          Conversation
        </button>
      </div>
    </>
  )
);

ActionRows.displayName = "ActionRows";

const ProjectCard = memo(
  ({
    project,
    sessionPresets,
    onLaunch,
    onLaunchPreset,
    onEditNote,
    onEditGithub,
    onCommitPush,
    onViewConversation
  }: ProjectCardProps): JSX.Element => {
    return (
      <article className="project-card">
        <div className="project-title">{project.name}</div>
        <div className="project-path">{project.path}</div>
        {project.meta?.note ? <div className="project-note">{project.meta.note}</div> : null}
        {project.meta?.githubUrl ? (
          <a className="project-link" href={project.meta.githubUrl} title={project.meta.githubUrl}>
            {project.meta.githubUrl}
          </a>
        ) : null}
        <ActionRows
          project={project}
          onLaunch={onLaunch}
          onEditNote={onEditNote}
          onEditGithub={onEditGithub}
          onCommitPush={onCommitPush}
          onViewConversation={onViewConversation}
        />
      </article>
    );
  }
);

ProjectCard.displayName = "ProjectCard";

const ProjectHealthCard = memo(
  ({
    project,
    health,
    onLaunch,
    onEditNote,
    onEditGithub,
    onCommitPush,
    onViewConversation
  }: ProjectHealthCardProps): JSX.Element => {
    return (
      <article className={`project-card health-card risk-${health.riskLevel}`}>
        <div className="health-card-top">
          <div>
            <div className="project-title">{project.name}</div>
            <div className="project-path">{project.path}</div>
          </div>
          <div className={`health-score ${health.riskLevel}`}>
            <span>Health</span>
            <strong>{health.score}</strong>
          </div>
        </div>
        {sessionPresets.length > 0 ? (
          <>
            <div className="preset-label">Session Presets</div>
            <div className="preset-actions">
              {sessionPresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`btn secondary preset-btn ${preset.readonly ? "builtin" : "custom"}`}
                  title={preset.systemPrompt || `Launch with ${preset.name}`}
                  onClick={() => onLaunchPreset(project, preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <div className="actions">
          <button className="btn secondary" onClick={() => onEditNote(project)}>
            Note
          </button>
          <button className="btn secondary" onClick={() => onEditGithub(project)}>
            GitHub
          </button>
          <button className="btn secondary" onClick={() => onCommitPush(project)}>
            Commit+Push
          </button>
          <button className="btn secondary" onClick={() => onViewConversation(project)}>
            Conversation
          </button>

        <div className="health-metric-grid">
          <div className="health-metric">
            <span>Last Commit</span>
            <strong>{formatLastCommit(health.lastCommitAt)}</strong>
            <small>
              {health.lastCommitAt ? new Date(health.lastCommitAt).toLocaleString() : "Not a git repo"}
            </small>
          </div>
          <div className="health-metric">
            <span>Uncommitted</span>
            <strong>{health.uncommittedChanges ?? "N/A"}</strong>
            <small>
              {health.uncommittedChanges === null
                ? "Git status unavailable"
                : health.uncommittedChanges === 0
                  ? "Clean working tree"
                  : "Needs review"}
            </small>
          </div>
          <div className="health-metric">
            <span>Dependencies</span>
            <strong>{formatDependencyScale(health.dependencyCount)}</strong>
            <small>{health.dependencyCount === null ? "No manifest parsed" : "deps + devDeps"}</small>
          </div>
          <div className="health-metric">
            <span>Build</span>
            <strong className={`health-build-pill ${BUILD_STATUS_CLASS[health.buildStatus]}`}>
              {BUILD_STATUS_LABEL[health.buildStatus]}
            </strong>
            <small>{health.buildMessage ?? "No details"}</small>
          </div>
        </div>

        <ActionRows
          project={project}
          onLaunch={onLaunch}
          onEditNote={onEditNote}
          onEditGithub={onEditGithub}
          onCommitPush={onCommitPush}
          onViewConversation={onViewConversation}
        />
      </article>
    );
  }
);

ProjectHealthCard.displayName = "ProjectHealthCard";

export const ProjectList = memo(({
  collapsed,
  rootPath,
  projects,
  sessionPresets,
  loading,
  error,
  healthItems,
  healthLoading,
  healthError,
  healthGeneratedAt,
  onToggleCollapse,
  onChooseFolder,
  onRefresh,
  onManagePresets,
  onRefreshHealth,
  onLaunch,
  onLaunchPreset,
  onEditNote,
  onEditGithub,
  onCommitPush,
  onViewConversation
}: ProjectListProps): JSX.Element => {
  const [viewMode, setViewMode] = useState<HealthViewMode>("projects");
  const [healthSort, setHealthSort] = useState<HealthSortMode>("risk-first");
  const [healthFilter, setHealthFilter] = useState<HealthFilterMode>("all");

  useEffect(() => {
    if (
      viewMode === "health" &&
      projects.length > 0 &&
      healthItems.length === 0 &&
      !healthLoading &&
      !healthError
    ) {
      onRefreshHealth();
    }
  }, [healthError, healthItems.length, healthLoading, onRefreshHealth, projects.length, viewMode]);

  const healthByPath = useMemo(
    () => new Map(healthItems.map((item) => [item.projectPath, item])),
    [healthItems]
  );

  const healthRows = useMemo(() => {
    const rows = projects
      .map((project) => ({ project, health: healthByPath.get(project.path) }))
      .filter((row): row is { project: ProjectItem; health: ProjectHealthItem } => !!row.health);

    const filtered = rows.filter((row) => {
      if (healthFilter === "all") {
        return true;
      }
      if (healthFilter === "high-risk") {
        return row.health.riskLevel === "high";
      }
      if (healthFilter === "dirty") {
        return (row.health.uncommittedChanges ?? 0) > 0;
      }
      return row.health.buildStatus === "fail";
    });

    return filtered.sort((a, b) => {
      const scoreDiff =
        healthSort === "risk-first" ? a.health.score - b.health.score : b.health.score - a.health.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.project.name.localeCompare(b.project.name, "zh-CN");
    });
  }, [healthByPath, healthFilter, healthSort, projects]);

  const healthUpdatedText = healthGeneratedAt
    ? new Date(healthGeneratedAt).toLocaleString()
    : "Not scanned yet";

  if (collapsed) {
    return (
      <aside className="panel project-panel collapsed" aria-label="Collapsed project panel">
        <div className="sidebar-rail">
          <button
            className="btn icon-btn"
            onClick={onToggleCollapse}
            aria-label="Expand project sidebar"
            title="Expand projects"
          >
            Projects
          </button>
        </div>
      </aside>
    );
  }

  return (
    <section className="panel project-panel">
      <header className="panel-header">
        <div>
          <h2>Projects</h2>
          <p className="hint">{rootPath}</p>
        </div>
        <div className="header-actions">
          <button
            className="btn secondary"
            onClick={onToggleCollapse}
            aria-label="Collapse project sidebar"
            title="Collapse projects"
          >
            Hide
          </button>
          <button className="btn secondary" onClick={onChooseFolder} disabled={loading}>
            Choose Folder
          </button>
          <button className="btn secondary" onClick={onRefresh} disabled={loading}>
            {loading ? "Scanning..." : "Refresh"}
          </button>
          <button className="btn secondary" onClick={onManagePresets}>
            Session Presets
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {!error && projects.length === 0 && !loading ? (
        <div className="empty">No project directories found in root.</div>
      ) : null}

      <div className="project-grid">
        {projects.map((project) => (
          <ProjectCard
            key={project.path}
            project={project}
            sessionPresets={sessionPresets}
            onLaunch={onLaunch}
            onLaunchPreset={onLaunchPreset}
            onEditNote={onEditNote}
            onEditGithub={onEditGithub}
            onCommitPush={onCommitPush}
            onViewConversation={onViewConversation}
          />
        ))}
      <div className="project-view-toolbar">
        <div className="view-switch">
          <button
            className={`btn secondary ${viewMode === "projects" ? "selected" : ""}`}
            onClick={() => setViewMode("projects")}
          >
            Projects
          </button>
          <button
            className={`btn secondary ${viewMode === "health" ? "selected" : ""}`}
            onClick={() => setViewMode("health")}
          >
            Health Dashboard
          </button>
        </div>

        {viewMode === "health" ? (
          <div className="health-toolbar">
            <button
              className="btn secondary"
              onClick={() =>
                setHealthSort((prev) => (prev === "risk-first" ? "healthy-first" : "risk-first"))
              }
            >
              {healthSort === "risk-first" ? "Sort: High Risk First" : "Sort: Healthy First"}
            </button>
            <div className="chip-actions">
              <button
                className={`btn secondary ${healthFilter === "all" ? "selected" : ""}`}
                onClick={() => setHealthFilter("all")}
              >
                All
              </button>
              <button
                className={`btn secondary ${healthFilter === "high-risk" ? "selected" : ""}`}
                onClick={() => setHealthFilter("high-risk")}
              >
                High Risk
              </button>
              <button
                className={`btn secondary ${healthFilter === "dirty" ? "selected" : ""}`}
                onClick={() => setHealthFilter("dirty")}
              >
                Dirty
              </button>
              <button
                className={`btn secondary ${healthFilter === "build-failed" ? "selected" : ""}`}
                onClick={() => setHealthFilter("build-failed")}
              >
                Build Failed
              </button>
            </div>
            <button className="btn secondary" onClick={onRefreshHealth} disabled={healthLoading}>
              {healthLoading ? "Checking..." : "Refresh Health"}
            </button>
          </div>
        ) : null}
      </div>

      {viewMode === "projects" ? (
        <>
          {!error && projects.length === 0 && !loading ? (
            <div className="empty">No project directories found in root.</div>
          ) : null}
          <div className="project-grid">
            {projects.map((project) => (
              <ProjectCard
                key={project.path}
                project={project}
                onLaunch={onLaunch}
                onEditNote={onEditNote}
                onEditGithub={onEditGithub}
                onCommitPush={onCommitPush}
                onViewConversation={onViewConversation}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="health-summary">
            <span>Updated: {healthUpdatedText}</span>
            <span>
              Showing {healthRows.length}/{healthItems.length || projects.length}
            </span>
          </div>

          {healthError ? <div className="error-box">Health scan failed: {healthError}</div> : null}

          {projects.length === 0 && !loading ? (
            <div className="empty">No projects available for health scan.</div>
          ) : null}

          {projects.length > 0 && healthItems.length === 0 && !healthLoading && !healthError ? (
            <div className="empty">Health data is empty. Click "Refresh Health" to scan now.</div>
          ) : null}

          {healthRows.length === 0 && healthItems.length > 0 && !healthLoading ? (
            <div className="empty">No projects match this filter.</div>
          ) : null}

          <div className="project-grid health-grid">
            {healthRows.map(({ project, health }) => (
              <ProjectHealthCard
                key={project.path}
                project={project}
                health={health}
                onLaunch={onLaunch}
                onEditNote={onEditNote}
                onEditGithub={onEditGithub}
                onCommitPush={onCommitPush}
                onViewConversation={onViewConversation}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
});

ProjectList.displayName = "ProjectList";
