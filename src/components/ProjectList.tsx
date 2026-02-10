import type { ProjectItem, ToolType } from "../types/ipc";

type ProjectListProps = {
  collapsed: boolean;
  rootPath: string;
  projects: ProjectItem[];
  loading: boolean;
  error: string | null;
  onToggleCollapse: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onLaunch: (project: ProjectItem, tool: ToolType) => void;
  onEditNote: (project: ProjectItem) => void;
  onEditGithub: (project: ProjectItem) => void;
  onCommitPush: (project: ProjectItem) => void;
  onViewConversation: (project: ProjectItem) => void;
};

export const ProjectList = ({
  collapsed,
  rootPath,
  projects,
  loading,
  error,
  onToggleCollapse,
  onChooseFolder,
  onRefresh,
  onLaunch,
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
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      {!error && projects.length === 0 && !loading ? (
        <div className="empty">No project directories found in root.</div>
      ) : null}

      <div className="project-grid">
        {projects.map((project) => (
          <article key={project.path} className="project-card">
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
        ))}
      </div>
    </section>
  );
};
