import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  OrbitCommand,
  CoordState,
  HistoryEntry,
  HookEvent,
  KeyDoc,
  LogState,
  Project,
  ProjectInfo,
  Skill,
  TermKind,
  WorkspaceState
} from '../../shared/events'
import { applyEvent, initSession, type SessionState } from './session-model'
import { Terminal, type TermHandle } from './components/Terminal'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Pane } from './components/Pane'
import { Projects } from './components/Projects'
import { SkillsPanel } from './components/SkillsPanel'
import { SettingsModal } from './components/SettingsModal'
import { HistoryModal } from './components/HistoryModal'
import { ContextPanel } from './components/ContextPanel'
import { FileTree } from './components/FileTree'
import { EditorModal } from './components/EditorModal'
import { CoordPanel } from './components/CoordPanel'
import { LogPanel } from './components/LogPanel'
import { SubAgents } from './components/SubAgents'
import { DocsStrip } from './components/DocsStrip'
import { CommandBar } from './components/CommandBar'
import { Activity } from './components/Activity'
import { KIND_META } from './kind-meta'

/** Find a project (or sub-project) name by path, searching nested workspace members. */
function findProjectName(list: Project[], targetPath: string): string | null {
  for (const p of list) {
    if (p.path === targetPath) return p.name
    if (p.subprojects) {
      const r = findProjectName(p.subprojects, targetPath)
      if (r) return r
    }
  }
  return null
}

/** Renderer copy of lease→path matching (doc: exact, code: glob with * / **). */
function leaseCoversPath(resource: string, absPath: string, projectPath: string): boolean {
  const m = resource.match(/^(doc|code):(.+)$/)
  if (!m) return false
  const norm = (s: string): string => s.replace(/\\/g, '/')
  const rel = norm(absPath).startsWith(norm(projectPath))
    ? norm(absPath).slice(norm(projectPath).length).replace(/^\//, '')
    : norm(absPath)
  const pat = norm(m[2])
  if (m[1] === 'doc') return rel === pat
  const re = new RegExp(
    '^' +
      pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/ /g, '.*') +
      '$'
  )
  return re.test(rel)
}

function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
}

/** Columns for a grid of n visible panes. */
function gridCols(n: number): number {
  if (n <= 1) return 1
  if (n <= 2) return 2
  if (n <= 4) return 2
  if (n <= 6) return 3
  return Math.ceil(Math.sqrt(n))
}

/**
 * The panes the grid renders for a project. Tabs and split are independent:
 *  - the split set (`split`) is an explicitly-pinned group of sessions tiled together;
 *  - the active tab is just focus and never mutates that set.
 * So if the focused tab belongs to a real (>=2) split we show the whole split; otherwise
 * we show the single active tab. Switching to a tab outside the split shows it alone while
 * the split stays pinned in state — click any of its members to bring the grid back.
 */
function paneIds(
  split: string[],
  activeId: string | null,
  sessions: SessionState[],
  project: string | null
): string[] {
  const set = split.filter((id) => sessions.some((s) => s.id === id && s.projectPath === project))
  if (set.length >= 2 && activeId && set.includes(activeId)) return set
  if (activeId && sessions.some((s) => s.id === activeId && s.projectPath === project)) return [activeId]
  return set.slice(0, 1)
}

interface TabMenu {
  id: string
  x: number
  y: number
}

export default function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [root, setRoot] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeProject, setActiveProject] = useState<string | null>(null)
  // explicitly-pinned split set per project (tiled grid). Independent of the active tab:
  // switching tabs never mutates this — see paneIds().
  const [splitByProject, setSplitByProject] = useState<Record<string, string[]>>({})
  const [skillFlash, setSkillFlash] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  // sessions whose backend has been spawned (lazy-resume: only those that became visible)
  const [started, setStarted] = useState<Set<string>>(new Set())
  const [projMenu, setProjMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [rightView, setRightView] = useState<'context' | 'files' | 'coord' | 'logs'>('context')
  const [editorPath, setEditorPath] = useState<string | null>(null)
  const [editorDocked, setEditorDocked] = useState(false)
  const [coord, setCoord] = useState<CoordState | null>(null)
  const [log, setLog] = useState<LogState | null>(null)
  const [keyDocs, setKeyDocs] = useState<KeyDoc[]>([])
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>({ commands: [], accent: null })

  const handles = useRef<Map<string, TermHandle>>(new Map())
  const activeIdRef = useRef<string | null>(null)
  const activeProjectRef = useRef<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef<string>('')
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])
  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  const updateSession = useCallback((id: string, fn: (s: SessionState) => SessionState) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  // initial load + (optionally) restore the previous workspace
  useEffect(() => {
    window.orbit.listProjects().then(({ root, projects }) => {
      setRoot(root)
      setProjects(projects)
    })
    window.orbit.getConfig().then((cfg) => {
      setConfig(cfg)
      if (!cfg.restoreOnLaunch) {
        setRestored(true)
        return
      }
      window.orbit
        .loadWorkspace()
        .then((ws) => {
          if (!ws || !ws.sessions.length) return
          const exclude = new Set(cfg.restoreExclude ?? [])
          const keep = ws.sessions.filter((p) => !exclude.has(p.projectPath))
          if (!keep.length) return
          const keptIds = new Set(keep.map((s) => s.id))
          setSessions(
            keep.map((p) => initSession(p.id, p.projectPath, p.projectName, p.kind, p.title, p.resumeId))
          )
          const splits: Record<string, string[]> = {}
          for (const [proj, ids] of Object.entries(ws.panesByProject ?? {})) {
            if (exclude.has(proj)) continue
            const f = ids.filter((id) => keptIds.has(id))
            // only >=2 panes is a real split; a single id is just a normal tab
            if (f.length >= 2) splits[proj] = f
          }
          setSplitByProject(splits)
          let ai = ws.activeId && keptIds.has(ws.activeId) ? ws.activeId : null
          const ap = ai
            ? keep.find((s) => s.id === ai)!.projectPath
            : ws.activeProject && !exclude.has(ws.activeProject)
              ? ws.activeProject
              : keep[0].projectPath
          if (!ai) ai = splits[ap]?.[0] ?? keep.find((s) => s.projectPath === ap)?.id ?? null
          setActiveProject(ap)
          setActiveId(ai)
          // we filtered, so allow the first persist to rewrite the trimmed workspace
          lastSaved.current = ''
        })
        .finally(() => setRestored(true))
    })
  }, [])

  // persist the workspace whenever the restartable shape changes (debounced, crash-safe).
  // When restore-on-launch is off we skip saving so the last layout is preserved for when
  // it's re-enabled (rather than being overwritten with the empty boot state).
  useEffect(() => {
    if (!restored || !config?.restoreOnLaunch) return
    const snapshot: WorkspaceState = {
      sessions: sessions.map((s) => ({
        id: s.id,
        projectPath: s.projectPath,
        projectName: s.projectName,
        kind: s.kind,
        title: s.title,
        resumeId: s.resumeId
      })),
      panesByProject: splitByProject,
      activeProject,
      activeId
    }
    const str = JSON.stringify(snapshot)
    if (str === lastSaved.current) return
    lastSaved.current = str
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.orbit.saveWorkspace(snapshot), 400)
  }, [sessions, splitByProject, activeProject, activeId, restored, config?.restoreOnLaunch])

  useEffect(() => {
    window.orbit.listSkills(activeProject).then(setSkills)
    // re-point coordination + log watchers and pinned docs at the active project
    setCoord(null)
    setLog(null)
    setKeyDocs([])
    setProjectInfo({ commands: [], accent: null })
    if (activeProject) {
      window.orbit.coordWatch(activeProject)
      window.orbit.logWatch(activeProject)
      window.orbit.listKeyDocs(activeProject).then(setKeyDocs)
      window.orbit.getProjectInfo(activeProject).then(setProjectInfo)
    }
  }, [activeProject])

  // color-code the UI with the active project's declared accent (revert to theme if none)
  useEffect(() => {
    const root = document.documentElement
    if (projectInfo.accent) root.style.setProperty('--accent', projectInfo.accent)
    else root.style.removeProperty('--accent')
  }, [projectInfo.accent])

  // re-target coordination/log watchers when their settings change (apply live)
  useEffect(() => {
    if (activeProjectRef.current) {
      window.orbit.coordWatch(activeProjectRef.current)
      window.orbit.logWatch(activeProjectRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.logDirs?.join(','), config?.leaseStaleMin])

  // coordination + log pushes (ignore stale snapshots for other projects)
  useEffect(
    () => window.orbit.onCoordUpdate((c) => setCoord((cur) => (c.projectPath === activeProjectRef.current ? c : cur))),
    []
  )
  useEffect(
    () => window.orbit.onLogUpdate((s) => setLog((cur) => (s.projectPath === activeProjectRef.current ? s : cur))),
    []
  )

  useEffect(() => {
    if (config) document.documentElement.dataset.theme = config.theme
  }, [config])

  // mark currently-visible sessions as "started" so their Terminals spawn (lazy-resume)
  useEffect(() => {
    const eff = paneIds(splitByProject[activeProject ?? ''] ?? [], activeId, sessions, activeProject)
    if (!eff.length) return
    setStarted((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of eff) if (!next.has(id)) (next.add(id), (changed = true))
      return changed ? next : prev
    })
  }, [splitByProject, activeProject, activeId, sessions])

  useEffect(
    () => window.orbit.onContextTree((sid, tree) => updateSession(sid, (s) => ({ ...s, context: tree }))),
    [updateSession]
  )

  useEffect(
    () =>
      window.orbit.onSessionExit((sid) =>
        updateSession(sid, (s) => ({
          ...s,
          exited: true,
          status: 'idle',
          agentsActive: 0,
          toolsActive: 0,
          busyFiles: [],
          activeSkill: null
        }))
      ),
    [updateSession]
  )

  useEffect(
    () =>
      window.orbit.onHookEvent((evt: HookEvent) => {
        const focused = evt.sessionId === activeIdRef.current
        updateSession(evt.sessionId, (s) => applyEvent(s, evt, focused))
        if (evt.event === 'PreToolUse' && evt.data?.tool_name === 'Skill') {
          const i = evt.data?.tool_input ?? {}
          const name = String(i.skill ?? i.skill_name ?? i.name ?? 'skill')
          setSkillFlash(name)
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setSkillFlash(null), 4000)
        }
      }),
    [updateSession]
  )

  // ---- creating / focusing / splitting ----
  function projectNameFor(projectPath: string): string {
    return (
      sessions.find((s) => s.projectPath === projectPath)?.projectName ??
      findProjectName(projects, projectPath) ??
      projectPath.split(/[\\/]/).pop() ??
      'project'
    )
  }

  function createSession(
    projectPath: string,
    kind: TermKind,
    opts?: { split?: boolean; resumeId?: string; startupCommand?: string; titleOverride?: string }
  ): void {
    const id = uid()
    const name = projectNameFor(projectPath)
    const count = sessions.filter((s) => s.projectPath === projectPath).length
    const label =
      opts?.titleOverride ??
      (kind === 'claude' ? `${name} #${count + 1}` : `${KIND_META[kind].label} #${count + 1}`)
    setSessions((prev) => [
      ...prev,
      initSession(id, projectPath, name, kind, label, opts?.resumeId, opts?.startupCommand)
    ])
    setActiveProject(projectPath)
    setActiveId(id)
    // A plain new tab never touches the split set (they're independent). A split adds the
    // new session to the project's pinned grid, seeding it with the current tab if empty.
    if (opts?.split) {
      const seed =
        activeId && sessions.some((s) => s.id === activeId && s.projectPath === projectPath)
          ? activeId
          : null
      setSplitByProject((prev) => {
        const cur = prev[projectPath] ?? []
        const base = cur.length ? cur : seed ? [seed] : []
        return { ...prev, [projectPath]: [...base, id] }
      })
    }
  }

  function runCommand(cmd: OrbitCommand): void {
    if (!activeProject) return
    createSession(activeProject, cmd.shell ?? 'powershell', {
      split: true,
      startupCommand: cmd.run,
      titleOverride: cmd.label
    })
  }

  // ---- history ----
  function openHistory(): void {
    if (!activeProject) return
    setHistoryOpen(true)
    setHistoryLoading(true)
    window.orbit.listHistory(activeProject).then((entries) => {
      setHistoryEntries(entries)
      setHistoryLoading(false)
    })
  }

  function pickHistory(entry: HistoryEntry): void {
    setHistoryOpen(false)
    if (!activeProject) return
    // if it's already open, just focus it instead of resuming a duplicate
    const existing = sessions.find((s) => s.resumeId === entry.sessionId)
    if (existing) {
      focusSession(existing.id)
      return
    }
    createSession(activeProject, 'claude', { resumeId: entry.sessionId })
  }

  function focusSession(id: string): void {
    const s = sessions.find((x) => x.id === id)
    if (!s) return
    // Tabs are independent of split: focusing only moves the active tab. If the focused
    // session is part of the project's split, the grid keeps showing the whole split;
    // otherwise it shows this session alone. Either way the split set is left intact.
    setActiveProject(s.projectPath)
    setActiveId(id)
    updateSession(id, (x) => ({ ...x, unseen: false, status: x.status === 'waiting' ? 'idle' : x.status }))
    setTimeout(() => handles.current.get(id)?.focus(), 0)
  }

  function openProject(p: Project): void {
    const existing = sessions.filter((s) => s.projectPath === p.path)
    if (existing.length > 0) {
      setActiveProject(p.path)
      const split = splitByProject[p.path]
      focusSession(split && split.length ? split[0] : existing[existing.length - 1].id)
    } else {
      createSession(p.path, 'claude')
    }
  }

  function addToSplit(id: string): void {
    const s = sessions.find((x) => x.id === id)
    if (!s) return
    // pin `id` into the project's split, seeding with the current tab so a lone tab
    // becomes a real 2-up split. Focus `id` so the grid shows the split.
    setSplitByProject((prev) => {
      const cur = prev[s.projectPath] ?? []
      if (cur.includes(id)) return prev
      const base = cur.length ? cur : activeId && activeId !== id ? [activeId] : []
      return { ...prev, [s.projectPath]: [...base, id] }
    })
    setActiveProject(s.projectPath)
    setActiveId(id)
  }

  function removeFromSplit(id: string): void {
    const s = sessions.find((x) => x.id === id)
    if (!s) return
    const next = (splitByProject[s.projectPath] ?? []).filter((x) => x !== id)
    setSplitByProject((prev) => {
      // a split of <=1 pane is just a normal tab — drop it so we fall back to single view
      const n = (prev[s.projectPath] ?? []).filter((x) => x !== id)
      const out = { ...prev }
      if (n.length >= 2) out[s.projectPath] = n
      else delete out[s.projectPath]
      return out
    })
    // keep focus on a pane that's still visible
    if (activeId === id) setActiveId(next[0] ?? null)
  }

  function closeTab(id: string): void {
    const closing = sessions.find((s) => s.id === id)
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)
    setSplitByProject((prev) => {
      const out: Record<string, string[]> = {}
      for (const [proj, ids] of Object.entries(prev)) {
        const f = ids.filter((x) => x !== id)
        if (f.length >= 2) out[proj] = f // collapse a now-single split back to a plain tab
      }
      return out
    })
    if (activeId === id && closing) {
      const sameProj = remaining.filter((s) => s.projectPath === closing.projectPath)
      const next = sameProj[sameProj.length - 1] ?? remaining[remaining.length - 1] ?? null
      setActiveId(next?.id ?? null)
      if (next) setActiveProject(next.projectPath)
    }
  }

  // keyboard: Ctrl+\ splits the active project with a new Claude session
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault()
        if (activeProject) createSession(activeProject, 'claude', { split: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, sessions, projects])

  // ---- toolbar actions ----
  function doRestart(continueLast: boolean): void {
    if (!activeId) return
    handles.current.get(activeId)?.restart(continueLast)
    updateSession(activeId, (s) => ({
      ...s,
      status: 'idle',
      agentsActive: 0,
      toolsActive: 0,
      busyFiles: [],
      activeSkill: null,
      exited: false
    }))
  }
  const doInterrupt = (): void => {
    if (activeId) handles.current.get(activeId)?.interrupt()
  }
  const doClear = (): void => {
    if (activeId) handles.current.get(activeId)?.clear()
  }
  const doSplit = (): void => {
    if (activeProject) createSession(activeProject, 'claude', { split: true })
  }
  const setFont = (delta: number): void => {
    if (!config) return
    const fontSize = Math.min(24, Math.max(9, config.fontSize + delta))
    const next = { ...config, fontSize }
    setConfig(next)
    window.orbit.setConfig(next)
  }
  const pickSkill = (sk: Skill): void => {
    if (!activeId) return
    window.orbit.sessionInput(activeId, sk.command + ' ')
    handles.current.get(activeId)?.focus()
  }
  const saveConfig = (next: AppConfig): void => {
    const rootChanged = next.projectRoot !== config?.projectRoot
    setConfig(next)
    window.orbit.setConfig(next)
    if (rootChanged) {
      window.orbit.listProjects().then(({ root, projects }) => {
        setRoot(root)
        setProjects(projects)
      })
    }
  }
  const toggleExclude = (path: string): void => {
    if (!config) return
    const set = new Set(config.restoreExclude ?? [])
    if (set.has(path)) set.delete(path)
    else set.add(path)
    saveConfig({ ...config, restoreExclude: [...set] })
  }
  const toggleHidden = (path: string): void => {
    if (!config) return
    const set = new Set(config.hidden ?? [])
    if (set.has(path)) set.delete(path)
    else set.add(path)
    saveConfig({ ...config, hidden: [...set] })
  }

  if (!config) return <div className="app loading">loading…</div>

  const active = sessions.find((s) => s.id === activeId) ?? null
  const projectTabs = sessions.filter((s) => s.projectPath === activeProject)
  // union of files being touched / recently touched across ALL sessions (any agent)
  const allBusy = new Set(sessions.flatMap((s) => s.busyFiles))
  const allRecent = new Set(sessions.flatMap((s) => s.recentFiles))
  const isLeased = (p: string): boolean =>
    !!activeProject && !!coord && coord.leases.some((l) => leaseCoversPath(l.resource, p, activeProject))
  const editorLeasedBy =
    editorPath && activeProject && coord
      ? (coord.leases.find((l) => leaseCoversPath(l.resource, editorPath, activeProject))?.agent ?? null)
      : null
  // the project's pinned split set (independent of the active tab), and the panes the grid
  // actually renders right now (the split when the active tab is part of it, else just the tab)
  const splitSet = (splitByProject[activeProject ?? ''] ?? []).filter((id) =>
    sessions.some((s) => s.id === id && s.projectPath === activeProject)
  )
  const visibleEffective = paneIds(splitSet, activeId, sessions, activeProject)
  const cols = gridCols(visibleEffective.length)
  const menuSession = tabMenu ? sessions.find((s) => s.id === tabMenu.id) ?? null : null
  const menuInSplit = tabMenu ? splitSet.includes(tabMenu.id) : false

  return (
    <div className="app">
      <header className="titlebar">
        <span className="logo">◆ Orbit</span>
        <span className="subtitle">{active ? active.projectPath : 'pick a project to start a session'}</span>
        {skillFlash && <span className="skill-flash">✦ Skill: {skillFlash}</span>}
        <button className="gear" onClick={() => setSettingsOpen(true)} title="Settings">
          ⚙
        </button>
      </header>

      <div className="columns">
        <aside className="col col-left">
          <Projects
            root={root}
            projects={projects}
            sessions={sessions}
            activeProject={activeProject}
            restoreExclude={config.restoreExclude ?? []}
            hidden={config.hidden ?? []}
            onOpen={openProject}
            onContext={(path, x, y) => setProjMenu({ path, x, y })}
          />
          <SkillsPanel skills={skills} activeSkill={active?.activeSkill ?? null} onPick={pickSkill} />
        </aside>

        <main className="col col-center">
          <TabBar
            sessions={projectTabs}
            activeId={activeId}
            split={splitSet}
            startedIds={started}
            onSelect={focusSession}
            onClose={closeTab}
            onNew={(kind) => activeProject && createSession(activeProject, kind)}
            onContext={(id, x, y) => setTabMenu({ id, x, y })}
            canNew={!!activeProject}
          />
          <Toolbar
            session={active}
            onRestart={() => doRestart(false)}
            onContinue={() => doRestart(true)}
            onInterrupt={doInterrupt}
            onClear={doClear}
            onSplit={doSplit}
            onHistory={openHistory}
            canHistory={!!activeProject}
            fontSize={config.fontSize}
            onFont={setFont}
            onSettings={() => setSettingsOpen(true)}
          />
          <CommandBar commands={projectInfo.commands} onRun={runCommand} />
          <div className={`center-body ${editorDocked && editorPath ? 'split' : ''}`}>
          <div className="terminals" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {sessions.length === 0 && (
              <div className="terminal-empty">
                <p>Pick a project on the left to launch a Claude session.</p>
                <p className="hint">
                  Runs your logged-in <code>claude.exe</code> — no API key.
                </p>
              </div>
            )}
            {sessions.map((s) => {
              const shown = visibleEffective.includes(s.id)
              return (
                <div key={s.id} className="term-slot" style={{ display: shown ? 'flex' : 'none' }}>
                  <Pane
                    session={s}
                    active={s.id === activeId}
                    canRemove={visibleEffective.length > 1}
                    onFocus={() => setActiveId(s.id)}
                    onSplit={() => createSession(s.projectPath, 'claude', { split: true })}
                    onRemove={() => removeFromSplit(s.id)}
                  >
                    <Terminal
                      ref={(h) => {
                        if (h) handles.current.set(s.id, h)
                        else handles.current.delete(s.id)
                      }}
                      sessionId={s.id}
                      projectPath={s.projectPath}
                      kind={s.kind}
                      resumeId={s.resumeId}
                      startupCommand={s.startupCommand}
                      live={started.has(s.id)}
                      active={s.id === activeId}
                      fontSize={config.fontSize}
                      theme={config.theme}
                    />
                  </Pane>
                </div>
              )
            })}
          </div>
          {editorDocked && editorPath && (
            <div className="editor-dock">
              <EditorModal
                path={editorPath}
                busy={allBusy.has(editorPath)}
                leasedBy={editorLeasedBy}
                docked
                onToggleDock={() => setEditorDocked(false)}
                onClose={() => setEditorPath(null)}
              />
            </div>
          )}
          </div>
        </main>

        <aside className="col col-right">
          <div className="panel right-top">
            <div className="panel-head rt-tabs">
              <button className={`rt ${rightView === 'context' ? 'on' : ''}`} onClick={() => setRightView('context')}>
                CONTEXT
              </button>
              <button className={`rt ${rightView === 'files' ? 'on' : ''}`} onClick={() => setRightView('files')}>
                FILES
              </button>
              <button className={`rt ${rightView === 'coord' ? 'on' : ''}`} onClick={() => setRightView('coord')}>
                COORD{coord && coord.leases.length > 0 ? ` (${coord.leases.length})` : ''}
              </button>
              <button className={`rt ${rightView === 'logs' ? 'on' : ''}`} onClick={() => setRightView('logs')}>
                LOGS
              </button>
            </div>
            {(rightView === 'context' || rightView === 'files') && (
              <DocsStrip docs={keyDocs} onOpen={setEditorPath} />
            )}
            <div className="rt-body">
              {rightView === 'context' && (
                <ContextPanel
                  tree={active?.context ?? []}
                  busy={allBusy}
                  recent={allRecent}
                  active={!!active}
                  isLeased={isLeased}
                  onOpenFile={setEditorPath}
                />
              )}
              {rightView === 'files' && (
                <FileTree
                  key={activeProject ?? 'none'}
                  root={activeProject}
                  busy={allBusy}
                  recent={allRecent}
                  isLeased={isLeased}
                  onOpenFile={setEditorPath}
                />
              )}
              {rightView === 'coord' && <CoordPanel coord={coord} />}
              {rightView === 'logs' && <LogPanel log={log} />}
            </div>
          </div>
          <div className="panel activity-wrap">
            <SubAgents items={active?.subagents ?? []} />
            <Activity items={active?.activity ?? []} />
          </div>
        </aside>
      </div>

      {tabMenu && menuSession && (
        <>
          <div className="menu-backdrop" onClick={() => setTabMenu(null)} />
          <div className="context-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
            {menuInSplit ? (
              <div
                className="dropdown-item"
                onClick={() => {
                  removeFromSplit(tabMenu.id)
                  setTabMenu(null)
                }}
              >
                Remove from split
              </div>
            ) : (
              <div
                className="dropdown-item"
                onClick={() => {
                  addToSplit(tabMenu.id)
                  setTabMenu(null)
                }}
              >
                Add to split view
              </div>
            )}
            <div
              className="dropdown-item"
              onClick={() => {
                createSession(menuSession.projectPath, 'claude', { split: true })
                setTabMenu(null)
              }}
            >
              Split → new Claude
            </div>
            <div
              className="dropdown-item danger"
              onClick={() => {
                closeTab(tabMenu.id)
                setTabMenu(null)
              }}
            >
              Close session
            </div>
          </div>
        </>
      )}

      {projMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setProjMenu(null)} />
          <div className="context-menu" style={{ left: projMenu.x, top: projMenu.y }}>
            <div
              className="dropdown-item"
              onClick={() => {
                toggleExclude(projMenu.path)
                setProjMenu(null)
              }}
            >
              {(config.restoreExclude ?? []).includes(projMenu.path)
                ? '↻ Restore on launch'
                : '∅ Start empty on launch'}
            </div>
            <div
              className="dropdown-item"
              onClick={() => {
                toggleHidden(projMenu.path)
                setProjMenu(null)
              }}
            >
              {(config.hidden ?? []).includes(projMenu.path) ? '👁 Unhide project' : '🚫 Hide project'}
            </div>
          </div>
        </>
      )}

      {historyOpen && (
        <HistoryModal
          projectName={activeProject ? projectNameFor(activeProject) : ''}
          entries={historyEntries}
          loading={historyLoading}
          openIds={new Set(sessions.map((s) => s.resumeId).filter((x): x is string => !!x))}
          onPick={pickHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal config={config} onChange={saveConfig} onClose={() => setSettingsOpen(false)} />
      )}

      {editorPath && !editorDocked && (
        <EditorModal
          path={editorPath}
          busy={allBusy.has(editorPath)}
          leasedBy={editorLeasedBy}
          docked={false}
          onToggleDock={() => setEditorDocked(true)}
          onClose={() => setEditorPath(null)}
        />
      )}
    </div>
  )
}
