import { useState } from 'react'
import { EyeOffIcon } from './icons'
import { HelpPopup } from './HelpPopup'
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
  /** persist a new top-level ordering (full list of top-level project paths) */
  onReorder: (orderedPaths: string[]) => void
}

interface ProjectStats {
  open: number
  agents: number
  busy: boolean
  waiting: boolean
  /** per-state chat counts: actively working / standing & waiting for you / idle */
  busyN: number
  waitingN: number
  idleN: number
}

/** All paths covered by a project row: itself + every nested subproject. */
function collectPaths(p: Project): string[] {
  const out = [p.path]
  for (const c of p.subprojects ?? []) out.push(...collectPaths(c))
  return out
}

/** Aggregated chat state for a project row (rolls up subprojects so a collapsed parent still
 *  reflects activity happening inside it). */
function statsFor(sessions: SessionState[], project: Project): ProjectStats {
  const paths = new Set(collectPaths(project))
  const mine = sessions.filter((s) => paths.has(s.projectPath))
  // a chat blocked on the user (finished turn / question / unseen output) counts as waiting,
  // even though a pending question technically reads as "busy"
  const isWaiting = (s: SessionState): boolean => s.status === 'waiting' || s.awaitingInput || s.unseen
  const waitingN = mine.filter(isWaiting).length
  const busyN = mine.filter((s) => s.status === 'busy' && !isWaiting(s)).length
  return {
    open: mine.length,
    agents: mine.reduce((n, s) => n + s.agentsActive, 0),
    busy: mine.some((s) => s.status === 'busy'),
    waiting: mine.some((s) => s.unseen),
    busyN,
    waitingN,
    idleN: mine.length - busyN - waitingN
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

/** Drag-to-reorder handlers, threaded only to top-level rows. */
interface RowDrag {
  onStart: (path: string) => void
  onOver: (e: React.DragEvent, path: string) => void
  onDrop: (path: string) => void
  onEnd: () => void
  hint: 'before' | 'after' | null
  dragging: boolean
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
  drag?: RowDrag
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
  onContext,
  drag
}: RowProps): JSX.Element | null {
  const [open, setOpen] = useState(true)
  const isHidden = hidden.has(p.path)
  if (isHidden && !showHidden) return null
  const st = statsFor(sessions, p)
  const hasSubs = !!p.subprojects?.length
  // one obvious state per row: busy > waiting > open > idle
  const state = st.busy ? 'busy' : st.waiting ? 'waiting' : st.open > 0 ? 'open' : 'idle'
  return (
    <>
      <li
        draggable={!!drag}
        onDragStart={drag ? () => drag.onStart(p.path) : undefined}
        onDragOver={drag ? (e) => drag.onOver(e, p.path) : undefined}
        onDrop={drag ? () => drag.onDrop(p.path) : undefined}
        onDragEnd={drag ? () => drag.onEnd() : undefined}
        className={`project ${depth > 0 ? 'subproject' : ''} state-${state} ${
          p.path === activeProject ? 'active' : ''
        } ${isHidden ? 'hidden-proj' : ''} ${drag?.dragging ? 'dragging' : ''} ${
          drag?.hint === 'before' ? 'drop-before' : drag?.hint === 'after' ? 'drop-after' : ''
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
        <span className="project-caret-slot">
          {hasSubs && (
            <span
              className="project-caret"
              onClick={(e) => {
                e.stopPropagation()
                setOpen((o) => !o)
              }}
            >
              {open ? '▾' : '▸'}
            </span>
          )}
        </span>
        {state !== 'idle' && (
          <span
            className={`project-dot ${state}`}
            title={
              state === 'busy' ? 'working' : state === 'waiting' ? 'waiting for you' : 'open (idle)'
            }
          />
        )}
        <span className="project-name">{p.name}</span>
        {st.agents > 0 && (
          <span className="agent-badge" title={`${st.agents} agent(s) working`}>
            ⬡ {st.agents}
          </span>
        )}
        {st.open > 0 && (
          <span
            className={`open-count state-${state}`}
            title={`${st.open} open chat(s): ${st.busyN} working · ${st.waitingN} waiting for you · ${st.idleN} idle`}
          >
            {st.busyN > 0 && <span className="cnt busy">{st.busyN}</span>}
            {st.waitingN > 0 && <span className="cnt waiting">{st.waitingN}</span>}
            {st.idleN > 0 && <span className="cnt idle">{st.idleN}</span>}
          </span>
        )}
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
  onContext,
  onReorder
}: Props): JSX.Element {
  const [showHidden, setShowHidden] = useState(false)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [over, setOver] = useState<{ path: string; after: boolean } | null>(null)
  const excluded = new Set(restoreExclude)
  const hiddenSet = new Set(hidden)
  const hiddenCount = countHidden(projects, hiddenSet)

  const topPaths = projects.map((p) => p.path)
  const commitDrop = (targetPath: string): void => {
    if (dragPath && over && dragPath !== targetPath) {
      const order = topPaths.filter((p) => p !== dragPath)
      let i = order.indexOf(over.path)
      if (i < 0) i = order.length
      else if (over.after) i += 1
      order.splice(i, 0, dragPath)
      onReorder(order)
    }
    setDragPath(null)
    setOver(null)
  }
  const drag = (path: string): RowDrag => ({
    onStart: () => setDragPath(path),
    onOver: (e, target) => {
      if (!dragPath) return
      e.preventDefault()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setOver({ path: target, after: e.clientY > r.top + r.height / 2 })
    },
    onDrop: (target) => commitDrop(target),
    onEnd: () => {
      setDragPath(null)
      setOver(null)
    },
    hint: dragPath && over?.path === path && dragPath !== path ? (over.after ? 'after' : 'before') : null,
    dragging: dragPath === path
  })

  return (
    <div className="panel projects">
      <div className="panel-head">
        <span className="panel-head-titled">
          PROJECTS
          <HelpPopup
            title="Subprojects"
            snippet={'{\n  "subprojects": [\n    { "name": "backend", "path": "app" }\n  ]\n}'}
          >
            Monorepo members are detected from <code>.orbit.json</code> <code>subprojects</code> or a{' '}
            <code>.code-workspace</code> in the project folder, and hot-reload when that file changes.
          </HelpPopup>
        </span>
        {hiddenCount > 0 ? (
          <span
            className={`panel-head-toggle ${showHidden ? 'on' : ''}`}
            title={showHidden ? 'hide hidden projects' : 'show hidden projects'}
            onClick={() => setShowHidden((s) => !s)}
          >
            {showHidden ? (
              '👁 hiding'
            ) : (
              <>
                <EyeOffIcon /> {hiddenCount} hidden
              </>
            )}
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
            drag={drag(p.path)}
          />
        ))}
        {projects.length === 0 && <li className="project muted">no folders found</li>}
      </ul>
    </div>
  )
}
