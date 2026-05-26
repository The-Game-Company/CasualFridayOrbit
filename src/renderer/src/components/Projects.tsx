import { useState } from 'react'
import type { Project } from '../../../shared/events'
import type { SessionState } from '../session-model'

interface Props {
  root: string
  projects: Project[]
  sessions: SessionState[]
  activeProject: string | null
  restoreExclude: string[]
  hidden: string[]
  onOpen: (p: Project) => void
  onContext: (path: string, x: number, y: number) => void
}

interface ProjectStats {
  open: number
  agents: number
  busy: boolean
  waiting: boolean
}

function statsFor(sessions: SessionState[], path: string): ProjectStats {
  const mine = sessions.filter((s) => s.projectPath === path)
  return {
    open: mine.length,
    agents: mine.reduce((n, s) => n + s.agentsActive, 0),
    busy: mine.some((s) => s.status === 'busy'),
    waiting: mine.some((s) => s.unseen)
  }
}

/** Count projects (incl. subprojects) whose path is in `hidden`. */
function countHidden(projects: Project[], hidden: Set<string>): number {
  let n = 0
  for (const p of projects) {
    if (hidden.has(p.path)) n++
    if (p.subprojects?.length) n += countHidden(p.subprojects, hidden)
  }
  return n
}

interface RowProps {
  p: Project
  depth: number
  sessions: SessionState[]
  activeProject: string | null
  excluded: Set<string>
  hidden: Set<string>
  showHidden: boolean
  onOpen: (p: Project) => void
  onContext: (path: string, x: number, y: number) => void
}

function ProjectRow({
  p,
  depth,
  sessions,
  activeProject,
  excluded,
  hidden,
  showHidden,
  onOpen,
  onContext
}: RowProps): JSX.Element | null {
  const [open, setOpen] = useState(true)
  const isHidden = hidden.has(p.path)
  if (isHidden && !showHidden) return null
  const st = statsFor(sessions, p.path)
  const hasSubs = !!p.subprojects?.length
  return (
    <>
      <li
        className={`project ${p.path === activeProject ? 'active' : ''} ${st.busy ? 'busy' : ''} ${
          isHidden ? 'hidden-proj' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onOpen(p)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContext(p.path, e.clientX, e.clientY)
        }}
        title={
          isHidden
            ? `${p.path} — hidden`
            : excluded.has(p.path)
              ? `${p.path} — starts empty on launch`
              : p.path
        }
      >
        {hasSubs ? (
          <span
            className="project-caret"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
          >
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className={`project-dot ${st.busy ? 'busy' : st.open > 0 ? 'open' : ''}`} />
        )}
        <span className="project-name">{p.name}</span>
        {st.agents > 0 && (
          <span className="agent-badge" title={`${st.agents} agent(s) working`}>
            ⬡ {st.agents}
          </span>
        )}
        {st.open > 0 && <span className="open-count" title={`${st.open} open session(s)`}>{st.open}</span>}
        {isHidden && <span className="proj-hidden" title="hidden">🚫</span>}
        {excluded.has(p.path) && <span className="proj-norestore" title="starts empty on launch">∅</span>}
        {st.waiting && <span className="unseen-dot" title="a session here is waiting for you" />}
      </li>
      {hasSubs &&
        open &&
        p.subprojects!.map((c) => (
          <ProjectRow
            key={c.path}
            p={c}
            depth={depth + 1}
            sessions={sessions}
            activeProject={activeProject}
            excluded={excluded}
            hidden={hidden}
            showHidden={showHidden}
            onOpen={onOpen}
            onContext={onContext}
          />
        ))}
    </>
  )
}

export function Projects({
  root,
  projects,
  sessions,
  activeProject,
  restoreExclude,
  hidden,
  onOpen,
  onContext
}: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const excluded = new Set(restoreExclude)
  const hiddenSet = new Set(hidden)
  const hiddenCount = countHidden(projects, hiddenSet)
  return (
    <div className="panel projects">
      <div className="panel-head">
        <span>PROJECTS</span>
        {hiddenCount > 0 ? (
          <span
            className={`panel-head-toggle ${showHidden ? 'on' : ''}`}
            title={showHidden ? 'hide hidden projects' : 'show hidden projects'}
            onClick={() => setShowHidden((s) => !s)}
          >
            {showHidden ? '👁 hiding' : `🚫 ${hiddenCount} hidden`}
          </span>
        ) : (
          <span className="panel-head-sub" title={root}>
            {root.split(/[\\/]/).pop()}
          </span>
        )}
      </div>
      <ul className="project-list">
        {projects.map((p) => (
          <ProjectRow
            key={p.path}
            p={p}
            depth={0}
            sessions={sessions}
            activeProject={activeProject}
            excluded={excluded}
            hidden={hiddenSet}
            showHidden={showHidden}
            onOpen={onOpen}
            onContext={onContext}
          />
        ))}
        {projects.length === 0 && <li className="project muted">no folders found</li>}
      </ul>
    </div>
  )
}
