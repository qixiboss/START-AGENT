import { memo } from "react";
import type { ProjectItem, SessionPreset, ToolType } from "../types/ipc";

type ProjectListProps = {
  collapsed: boolean;
  rootPath: string;
  projects: ProjectItem[];
  sessionPresets: SessionPreset[];
  loading: boolean;
  error: string | null;
  onToggleCollapse: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onManagePresets: () => void;
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
        <div className="actions">
          <button className="btn primary" onClick={() => onLaunch(project, "codex")}>
            Open Codex
          </button>
          <button className="btn alt" onClick={() => onLaunch(project, "claude")}>
            Open Claude
          </button>
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
        </div>
      </article>
    );
  }
);

ProjectCard.displayName = "ProjectCard";

export const ProjectList = memo(({
  collapsed,
  rootPath,
  projects,
  sessionPresets,
  loading,
  error,
  onToggleCollapse,
  onChooseFolder,
  onRefresh,
  onManagePresets,
  onLaunch,
  onLaunchPreset,
  onEditNote,
  onEditGithub,
  onCommitPush,
  onViewConversation
}: ProjectListProps): JSX.Element => {
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
      </div>
    </section>
  );
});

ProjectList.displayName = "ProjectList";
