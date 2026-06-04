import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  OrbitCommand,
  CoordState,
  HistoryEntry,
  HookEvent,
  KeyDoc,
  LogState,
  McpServer,
  Project,
  ProjectInfo,
  Skill,
  TermKind,
  UpdateStatus,
  WorkspaceState
} from '../../shared/events'
import { applyEvent, initSession, tabWindows, type SessionState, type Tab } from './session-model'
import { applyTheme, THEMES } from './themes'
import { Terminal, type TermHandle } from './components/Terminal'
import { TabBar } from './components/TabBar'
import { Pane } from './components/Pane'
import { Projects } from './components/Projects'
import { SkillsPanel } from './components/SkillsPanel'
import { McpPanel } from './components/McpPanel'
import { SettingsModal } from './components/SettingsModal'
import { HistoryModal } from './components/HistoryModal'
import { ShortcutsModal } from './components/ShortcutsModal'
import { ConfirmModal } from './components/ConfirmModal'
import { UpdateModal } from './components/UpdateModal'
import { ContextPanel } from './components/ContextPanel'
import { FileTree } from './components/FileTree'
import { EditorModal } from './components/EditorModal'
import { CoordPanel } from './components/CoordPanel'
import { LogPanel } from './components/LogPanel'
import { SubAgents } from './components/SubAgents'
import { SkillHud } from './components/SkillHud'
import { DocsStrip } from './components/DocsStrip'
import { CommandBar } from './components/CommandBar'
import { Activity } from './components/Activity'
import { EyeOffIcon } from './components/icons'
import { KIND_META, defaultShellKind } from './kind-meta'

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

/** Sort top-level projects by the user's saved order; unknown ones keep their original
 *  relative position at the end (Array.sort is stable). */
function orderProjects(projects: Project[], order: string[] | undefined): Project[] {
  if (!order?.length) return projects
  const rank = new Map(order.map((p, i) => [p, i]))
  return [...projects].sort(
    (a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity)
  )
}

function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
}

/** Columns for a grid of n visible windows. */
function gridCols(n: number): number {
  if (n <= 1) return 1
  if (n <= 2) return 2
  if (n <= 4) return 2
  if (n <= 6) return 3
  return Math.ceil(Math.sqrt(n))
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

interface Cell {
  col: number
  rowStart: number
  rowSpan: number
}

/**
 * Grid placement from an explicit column layout. Each column is a vertical stack; a column
 * with fewer windows lets each take more height. The grid is always completely filled (row
 * count is the LCM of the per-column window counts, so every span is a whole number of rows).
 * Returns a map from window id to its cell so placement follows the stored structure exactly —
 * splitting/closing manipulate the columns, and the layout never reflows on its own.
 */
function columnLayout(columns: string[][]): { cols: number; rows: number; cellOf: Map<string, Cell> } {
  const live = columns.filter((c) => c.length > 0)
  const cellOf = new Map<string, Cell>()
  if (live.length === 0) return { cols: 1, rows: 1, cellOf }
  const rows = live.reduce((m, c) => (m * c.length) / gcd(m, c.length), 1)
  live.forEach((col, ci) => {
    const span = rows / col.length
    col.forEach((id, j) => cellOf.set(id, { col: ci + 1, rowStart: j * span + 1, rowSpan: span }))
  })
  return { cols: live.length, rows, cellOf }
}

/** A tab's columns with dead/closed sessions filtered out and now-empty columns dropped. */
function liveColumns(tab: Tab | null | undefined, sessions: SessionState[]): string[][] {
  if (!tab) return []
  return tab.columns
    .map((col) => col.filter((w) => sessions.some((s) => s.id === w)))
    .filter((col) => col.length > 0)
}

/**
 * Distribute a flat, ordered window list into balanced columns — used to seed a column layout
 * from legacy/persisted data that only had a flat list. Mirrors the old count-based tiling
 * (gridCols columns, leftmost columns hold the extra window) so restored layouts read the same.
 */
function columnsFromFlat(ids: string[]): string[][] {
  if (ids.length <= 1) return ids.length ? [[...ids]] : []
  const cols = gridCols(ids.length)
  const base = Math.floor(ids.length / cols)
  const rem = ids.length % cols
  const out: string[][] = []
  let k = 0
  for (let c = 0; c < cols; c++) {
    const cnt = c < rem ? base + 1 : base
    if (cnt > 0) out.push(ids.slice(k, k + cnt))
    k += cnt
  }
  return out
}

/**
 * Place a freshly-split window relative to the active window. Matches the old grid's *feel*
 * without its reflow: when the balanced grid would gain a column (gridCols grows), the new
 * window opens a fresh column right after the active one; otherwise it stacks directly below
 * the active window in its own column ("split the height where the column is"). Either way the
 * existing windows keep their columns, so a later close only shrinks the affected one.
 */
function splitInsert(columns: string[][], activeWindow: string, id: string): string[][] {
  const cols = columns.map((c) => [...c])
  const n = cols.reduce((a, c) => a + c.length, 0)
  let ci = cols.findIndex((c) => c.includes(activeWindow))
  if (ci < 0) ci = cols.length - 1
  if (cols.length === 0) return [[id]]
  if (gridCols(n + 1) > cols.length) {
    cols.splice(ci + 1, 0, [id])
  } else {
    const col = cols[ci]
    const at = col.indexOf(activeWindow)
    col.splice(at >= 0 ? at + 1 : col.length, 0, id)
  }
  return cols
}

/** Windows of a tab that still have a live session (filters out closed/excluded ids). */
function liveWindows(tab: Tab | null | undefined, sessions: SessionState[]): string[] {
  if (!tab) return []
  return tabWindows(tab).filter((w) => sessions.some((s) => s.id === w))
}

/**
 * Build the tab hierarchy from a legacy (pre-hierarchy) workspace, where "splits" were a
 * separate per-project set layered over a flat session list. Each >=2 split group becomes
 * one multi-window tab; every other session becomes its own single-window tab. Order follows
 * the persisted session order so the restored layout reads the same left-to-right.
 */
function buildTabsFromLegacy(
  sessions: { id: string; projectPath: string }[],
  panesByProject?: Record<string, string[]>
): Tab[] {
  const memberToFirst = new Map<string, string>()
  const groupOf = new Map<string, string[]>()
  for (const [proj, ids] of Object.entries(panesByProject ?? {})) {
    const f = (ids ?? []).filter((id) => sessions.some((s) => s.id === id && s.projectPath === proj))
    if (f.length >= 2) {
      groupOf.set(f[0], f)
      f.forEach((id) => memberToFirst.set(id, f[0]))
    }
  }
  const tabs: Tab[] = []
  const emitted = new Set<string>()
  for (const s of sessions) {
    const first = memberToFirst.get(s.id)
    if (first) {
      if (!emitted.has(first)) {
        emitted.add(first)
        const w = groupOf.get(first)!
        tabs.push({ id: uid(), projectPath: s.projectPath, columns: columnsFromFlat(w), activeWindow: w[0] })
      }
    } else {
      tabs.push({ id: uid(), projectPath: s.projectPath, columns: [[s.id]], activeWindow: s.id })
    }
  }
  return tabs
}

interface TabMenu {
  /** the tab this menu acts on */
  id: string
  x: number
  y: number
}

export default function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [root, setRoot] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [sessions, setSessions] = useState<SessionState[]>([])
  // tabs own their windows; splitting = adding a window to a tab. Independent per tab.
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // names of busy chats when a rebuild is requested mid-turn; non-null shows the confirm modal
  const [rebuildBusy, setRebuildBusy] = useState<string[] | null>(null)
  // launch-time Claude Code upgrade gate (see the update-check effect below)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateChecked, setUpdateChecked] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
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
  // side-column widths (px), drag the dividers to resize; seeded from + persisted to config
  const [widths, setWidths] = useState({ left: 230, right: 340 })
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  // window id that auto-focus just jumped to — shows a highlight until the user interacts
  const [autoFocused, setAutoFocused] = useState<string | null>(null)
  // ordered queue of background windows that have finished and want attention (oldest first);
  // auto-focus drains it one at a time as the user hands off the window they're on
  const [finishedQueue, setFinishedQueue] = useState<string[]>([])

  const handles = useRef<Map<string, TermHandle>>(new Map())
  const activeIdRef = useRef<string | null>(null)
  const activeProjectRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef<string>('')
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const configRef = useRef<AppConfig | null>(config)
  configRef.current = config
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const widthsSeeded = useRef(false)

  // The active tab and, within it, the focused window (= what the toolbar/skills act on).
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activeId =
    activeTab && sessions.some((s) => s.id === activeTab.activeWindow)
      ? activeTab.activeWindow
      : liveWindows(activeTab, sessions)[0] ?? null

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])
  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  // seed the side-column widths from config once it has loaded
  useEffect(() => {
    if (config && !widthsSeeded.current) {
      widthsSeeded.current = true
      setWidths({ left: config.leftWidth ?? 230, right: config.rightWidth ?? 340 })
    }
  }, [config])

  // start dragging a column divider: track the mouse, resize live, persist on release
  const startResize = (which: 'left' | 'right') => (e: React.MouseEvent): void => {
    e.preventDefault()
    setDragging(which)
    const startX = e.clientX
    const start = which === 'left' ? widthsRef.current.left : widthsRef.current.right
    const clamp = (n: number): number => Math.max(160, Math.min(620, n))
    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const next = clamp(which === 'left' ? start + delta : start - delta)
      setWidths((w) => ({ ...w, [which]: next }))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDragging(null)
      const cfg = configRef.current
      if (cfg) window.orbit.setConfig({ ...cfg, leftWidth: widthsRef.current.left, rightWidth: widthsRef.current.right })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const updateSession = useCallback((id: string, fn: (s: SessionState) => SessionState) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  // projects shown in the user's saved order (drag-to-reorder in the Projects panel)
  const orderedProjects = useMemo(
    () => orderProjects(projects, config?.projectOrder),
    [projects, config?.projectOrder]
  )

  // flat, display-order list of selectable projects (top-level + nested), minus hidden ones —
  // used by the Ctrl+Shift+↑/↓ "move between projects" shortcut.
  const visibleProjectsFlat = useMemo(() => {
    const hidden = new Set(config?.hidden ?? [])
    const out: Project[] = []
    const walk = (list: Project[]): void => {
      for (const p of list) {
        if (hidden.has(p.path)) continue
        out.push(p)
        if (p.subprojects?.length) walk(p.subprojects)
      }
    }
    walk(orderedProjects)
    return out
  }, [orderedProjects, config?.hidden])

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
            keep.map((p) => ({
              ...initSession(p.id, p.projectPath, p.projectName, p.kind, p.title, p.resumeId),
              lastPrompt: p.lastPrompt ?? ''
            }))
          )

          // Tabs: use the persisted hierarchy if present, else migrate the legacy split map.
          let restoredTabs: Tab[]
          if (Array.isArray(ws.tabs) && ws.tabs.length) {
            restoredTabs = ws.tabs
              .filter((t) => !exclude.has(t.projectPath))
              .map((t) => {
                // new data carries `columns`; pre-column data only had a flat `windows` list
                const columns = t.columns
                  ? t.columns.map((col) => col.filter((id) => keptIds.has(id))).filter((col) => col.length > 0)
                  : columnsFromFlat((t.windows ?? []).filter((id) => keptIds.has(id)))
                if (!columns.length) return null
                const flat = columns.flat()
                const aw = t.activeWindow && flat.includes(t.activeWindow) ? t.activeWindow : flat[0]
                return { id: t.id, projectPath: t.projectPath, columns, activeWindow: aw } as Tab
              })
              .filter((t): t is Tab => !!t)
          } else {
            restoredTabs = buildTabsFromLegacy(keep, ws.panesByProject)
          }
          // any kept session not covered by a tab (partial/old data) gets its own tab
          const covered = new Set(restoredTabs.flatMap((t) => tabWindows(t)))
          for (const s of keep)
            if (!covered.has(s.id))
              restoredTabs.push({ id: uid(), projectPath: s.projectPath, columns: [[s.id]], activeWindow: s.id })
          setTabs(restoredTabs)

          // Active tab: persisted activeTabId → tab holding legacy activeId → active project → first.
          let atid = ws.activeTabId && restoredTabs.some((t) => t.id === ws.activeTabId) ? ws.activeTabId : null
          if (!atid && ws.activeId) atid = restoredTabs.find((t) => tabWindows(t).includes(ws.activeId!))?.id ?? null
          if (!atid) {
            const ap0 = ws.activeProject && !exclude.has(ws.activeProject) ? ws.activeProject : null
            atid = (ap0 && restoredTabs.find((t) => t.projectPath === ap0)?.id) || restoredTabs[0]?.id || null
          }
          const at = restoredTabs.find((t) => t.id === atid) ?? null
          setActiveTabId(atid)
          setActiveProject(
            at?.projectPath ??
              (ws.activeProject && !exclude.has(ws.activeProject) ? ws.activeProject : keep[0].projectPath)
          )
          // we filtered, so allow the first persist to rewrite the trimmed workspace
          lastSaved.current = ''
        })
        .finally(() => setRestored(true))
    })
  }, [])

  // Hot-reload the project list when a `.orbit.json`/`.code-workspace` changes on disk.
  useEffect(() => {
    return window.orbit.onProjectsChanged(() => {
      window.orbit.listProjects().then(({ root, projects }) => {
        setRoot(root)
        setProjects(projects)
      })
    })
  }, [])

  // On launch, ask the main process whether Claude Code can be upgraded. Claude can't be
  // replaced while a session holds the binary open, so if an upgrade is available we raise the
  // gate *before* any terminal spawns (see the lazy-resume effect, which waits on updateChecked).
  // A fallback timer guarantees we never block startup if the version probe hangs.
  useEffect(() => {
    let settled = false
    const finish = (s?: UpdateStatus): void => {
      if (settled) return
      settled = true
      if (s) {
        setUpdate(s)
        if (s.updateAvailable) setUpdateOpen(true)
      }
      setUpdateChecked(true)
    }
    window.orbit
      .checkUpdate()
      .then(finish)
      .catch(() => finish())
    const t = setTimeout(() => finish(), 8000)
    return () => clearTimeout(t)
  }, [])

  // persist the workspace whenever the restartable shape changes (debounced, crash-safe).
  // When restore-on-launch is off we skip saving so the last layout is preserved for when
  // it's re-enabled (rather than being overwritten with the empty boot state).
  useEffect(() => {
    // While upgrading we deliberately clear tabs/sessions; don't let that wipe the saved layout
    // so the user's windows come back after the post-upgrade relaunch.
    if (!restored || !config?.restoreOnLaunch || upgrading) return
    const snapshot: WorkspaceState = {
      sessions: sessions.map((s) => ({
        id: s.id,
        projectPath: s.projectPath,
        projectName: s.projectName,
        kind: s.kind,
        title: s.title,
        resumeId: s.resumeId,
        lastPrompt: s.lastPrompt ? s.lastPrompt.slice(0, 500) : undefined
      })),
      tabs: tabs.map((t) => ({
        id: t.id,
        projectPath: t.projectPath,
        columns: t.columns,
        activeWindow: t.activeWindow
      })),
      activeProject,
      activeTabId
    }
    const str = JSON.stringify(snapshot)
    if (str === lastSaved.current) return
    lastSaved.current = str
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.orbit.saveWorkspace(snapshot), 400)
  }, [sessions, tabs, activeProject, activeTabId, restored, config?.restoreOnLaunch, upgrading])

  useEffect(() => {
    window.orbit.listSkills(activeProject).then(setSkills)
    window.orbit.listMcp(activeProject).then(setMcpServers)
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
    if (!config) return
    applyTheme(config.theme)
    // applyTheme rewrites every token (incl. --accent); restore the active
    // project's accent override on top so a theme switch doesn't drop it
    if (projectInfo.accent) document.documentElement.style.setProperty('--accent', projectInfo.accent)
  }, [config?.theme, projectInfo.accent])

  // claude reads its TUI theme once, at spawn — so a live session can't recolor on the fly.
  // When the appearance flips (dark <-> light), refresh each live claude session by relaunching
  // it with --resume (same conversation, repainted in the matching theme) — a soft "reload".
  const prevAppearance = useRef<'dark' | 'light' | null>(null)
  useEffect(() => {
    if (!config) return
    const appearance = THEMES[config.theme].appearance
    const prev = prevAppearance.current
    prevAppearance.current = appearance
    if (prev === null || prev === appearance) return
    for (const h of handles.current.values()) h.refresh()
  }, [config?.theme])

  // mark the active tab's windows as "started" so their Terminals spawn (lazy-resume).
  // Held until the launch update check resolves, and while the upgrade gate is open, so we
  // never spawn a claude.exe that would lock the binary out of an in-progress upgrade.
  useEffect(() => {
    if (!updateChecked || updateOpen) return
    const eff = liveWindows(activeTab, sessions)
    if (!eff.length) return
    setStarted((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of eff) if (!next.has(id)) (next.add(id), (changed = true))
      return changed ? next : prev
    })
  }, [tabs, activeTabId, sessions, updateChecked, updateOpen])

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
      }),
    [updateSession]
  )

  // open Settings / History from the native menu bar (the in-app titlebar/toolbar are gone)
  useEffect(() => {
    return window.orbit.onMenuCommand((cmd) => {
      if (cmd === 'settings') {
        setSettingsOpen(true)
      } else if (cmd === 'rebuild') {
        // Warn before tearing the app down if any chat is mid-turn — a rebuild kills
        // every running session, losing work in progress. Use an in-app modal (not the
        // native window.confirm, which is unstyled and yanks terminal focus).
        const busy = sessionsRef.current.filter((s) => s.status === 'busy')
        if (busy.length > 0) setRebuildBusy(busy.map((s) => s.projectName))
        else window.orbit.rebuildApp()
      } else if (cmd === 'shortcuts') {
        setShortcutsOpen(true)
      } else if (cmd === 'history') {
        const ap = activeProjectRef.current
        if (!ap) return
        setHistoryOpen(true)
        setHistoryLoading(true)
        window.orbit.listHistory(ap).then((entries) => {
          setHistoryEntries(entries)
          setHistoryLoading(false)
        })
      }
    })
  }, [])

  // claude sets the terminal title (OSC) to a short summary of the conversation. Use it to
  // label the tab as "Project - <summary>". We ignore the noise titles a shell/claude emits
  // before it has anything meaningful (a path, the bare exe name, or an empty string).
  function retitleFromTerminal(id: string, raw: string): void {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t) return
    const lower = t.toLowerCase()
    if (lower === 'claude' || t.includes('\\') || t.includes('/') || /^[a-z]:/i.test(t)) return
    updateSession(id, (s) => {
      const summary = t.length > 60 ? t.slice(0, 60) + '…' : t
      const title = `${s.projectName} - ${summary}`
      return s.title === title ? s : { ...s, title }
    })
  }

  // ---- creating / focusing / splitting ----
  function projectNameFor(projectPath: string): string {
    return (
      sessions.find((s) => s.projectPath === projectPath)?.projectName ??
      findProjectName(projects, projectPath) ??
      projectPath.split(/[\\/]/).pop() ??
      'project'
    )
  }

  /**
   * Create a session. Where it lands:
   *  - `targetTabId`  → a new window inside that specific tab (context-menu split),
   *  - `split: true`  → a new window inside the *current* tab (if it's this project),
   *  - otherwise      → a brand-new single-window tab.
   */
  function createSession(
    projectPath: string,
    kind: TermKind,
    opts?: {
      split?: boolean
      targetTabId?: string
      resumeId?: string
      startupCommand?: string
      titleOverride?: string
    }
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

    const target =
      (opts?.targetTabId ? tabs.find((t) => t.id === opts.targetTabId) : undefined) ??
      (opts?.split ? tabs.find((t) => t.id === activeTabId && t.projectPath === projectPath) : undefined)

    if (target) {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== target.id) return t
          return { ...t, columns: splitInsert(t.columns, t.activeWindow, id), activeWindow: id }
        })
      )
      setActiveTabId(target.id)
    } else {
      const tabId = uid()
      setTabs((prev) => [...prev, { id: tabId, projectPath, columns: [[id]], activeWindow: id }])
      setActiveTabId(tabId)
    }
  }

  function runCommand(cmd: OrbitCommand): void {
    if (!activeProject) return
    createSession(activeProject, cmd.shell ?? defaultShellKind(window.orbit.platform), {
      split: true,
      startupCommand: cmd.run,
      titleOverride: cmd.label
    })
  }

  // ---- history ----
  function pickHistory(entry: HistoryEntry): void {
    setHistoryOpen(false)
    if (!activeProject) return
    // if it's already open, just focus its window instead of resuming a duplicate
    const existing = sessions.find((s) => s.resumeId === entry.sessionId)
    if (existing) {
      focusWindow(existing.id)
      return
    }
    createSession(activeProject, 'claude', { resumeId: entry.sessionId })
  }

  /** Focus a whole tab (its current active window). */
  function focusTab(tabId: string): void {
    const t = tabs.find((x) => x.id === tabId)
    if (!t) return
    setActiveProject(t.projectPath)
    setActiveTabId(tabId)
    const win = sessions.some((s) => s.id === t.activeWindow) ? t.activeWindow : liveWindows(t, sessions)[0]
    if (win) {
      updateSession(win, (x) => ({ ...x, unseen: false, status: x.status === 'waiting' ? 'idle' : x.status }))
      setTimeout(() => handles.current.get(win)?.focus(), 0)
    }
  }

  /** Focus a specific window (and the tab that owns it). */
  function focusWindow(windowId: string): void {
    const t = tabs.find((x) => tabWindows(x).includes(windowId))
    if (!t) return
    setActiveProject(t.projectPath)
    setActiveTabId(t.id)
    setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, activeWindow: windowId } : x)))
    updateSession(windowId, (x) => ({ ...x, unseen: false, status: x.status === 'waiting' ? 'idle' : x.status }))
    setTimeout(() => handles.current.get(windowId)?.focus(), 0)
  }

  function openProject(p: Project): void {
    const projTabs = tabs.filter((t) => t.projectPath === p.path)
    if (projTabs.length > 0) {
      setActiveProject(p.path)
      focusTab(projTabs[projTabs.length - 1].id)
    } else {
      createSession(p.path, 'claude')
    }
  }

  /** Remove a tab and move focus to a sensible neighbour (sessions removed by the caller). */
  function dropTab(tabId: string): void {
    const tab = tabs.find((t) => t.id === tabId)
    const rest = tabs.filter((t) => t.id !== tabId)
    setTabs(rest)
    if (activeTabId === tabId && tab) {
      const sameProj = rest.filter((t) => t.projectPath === tab.projectPath)
      const next = sameProj[sameProj.length - 1] ?? rest[rest.length - 1] ?? null
      setActiveTabId(next?.id ?? null)
      if (next) setActiveProject(next.projectPath)
    }
  }

  /**
   * Close one window. If it's the tab's last window, the tab closes too — except when it's
   * also the only tab left: closing it would leave zero tabs (which looks broken), so we no-op.
   */
  function closeWindow(windowId: string): void {
    const tab = tabs.find((t) => tabWindows(t).includes(windowId))
    if (!tab) {
      setSessions((prev) => prev.filter((s) => s.id !== windowId))
      return
    }
    // Pick the focus successor *before* removing — prefer a neighbour in the same column (below,
    // then above), so closing a window keeps focus local instead of jumping to another column.
    const owningCol = tab.columns.find((c) => c.includes(windowId)) ?? []
    const at = owningCol.indexOf(windowId)
    const neighbour = owningCol[at + 1] ?? owningCol[at - 1]
    // Drop the window from its column; an emptied column is removed (columns to its right shift left).
    const columns = tab.columns.map((c) => c.filter((w) => w !== windowId)).filter((c) => c.length > 0)
    const remaining = columns.flat()
    if (remaining.length === 0 && tabs.length === 1) return
    setSessions((prev) => prev.filter((s) => s.id !== windowId))
    if (remaining.length > 0) {
      const nextActive =
        tab.activeWindow === windowId ? neighbour ?? remaining[remaining.length - 1] : tab.activeWindow
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, columns, activeWindow: nextActive } : t)))
      return
    }
    dropTab(tab.id)
  }

  /** Close a whole tab (every window inside it). */
  function closeTab(tabId: string): void {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    const winSet = new Set(tabWindows(tab))
    setSessions((prev) => prev.filter((s) => !winSet.has(s.id)))
    dropTab(tabId)
  }

  // keyboard:
  //   • Ctrl+\           split the active tab with a new Claude window
  //   • Ctrl+W           close the active window (and its tab if it was the last window)
  //   • Ctrl+1..9        focus the Nth tab of the active project (by position)
  //   • Ctrl+Shift+↑/↓   move to the previous/next project (and focus/open it)
  useEffect(() => {
    // Capture phase: xterm consumes Ctrl+key combos (sends them to the PTY) before they reach
    // a bubble-phase window listener, so we must intercept here and stop propagation when we act.
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('.modal-overlay')) return
      const grab = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }

      if (!e.shiftKey && (e.code === 'Backslash' || e.key === '\\')) {
        grab()
        if (activeProject) createSession(activeProject, 'claude', { split: true })
        return
      }

      // Ctrl+T → new tab (Claude window) in the active project
      if (!e.shiftKey && e.key.toLowerCase() === 't') {
        if (activeProject) {
          grab()
          createSession(activeProject, 'claude')
        }
        return
      }

      // Ctrl+W → close the active window (drops the tab too if it was the last window)
      if (!e.shiftKey && e.key.toLowerCase() === 'w') {
        if (activeId) {
          grab()
          closeWindow(activeId)
        }
        return
      }

      // Ctrl+1..9 → tab by index within the active project
      if (!e.shiftKey && e.code.startsWith('Digit') && e.key >= '1' && e.key <= '9') {
        const projTabs = tabs.filter((t) => t.projectPath === activeProject)
        const target = projTabs[Number(e.key) - 1]
        if (target) {
          grab()
          focusTab(target.id)
        }
        return
      }

      // Ctrl+Shift+↑/↓ → previous/next project
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!visibleProjectsFlat.length) return
        grab()
        const cur = visibleProjectsFlat.findIndex((p) => p.path === activeProject)
        const step = e.key === 'ArrowDown' ? 1 : -1
        const base = cur < 0 ? (step > 0 ? -1 : 0) : cur
        const next = visibleProjectsFlat[(base + step + visibleProjectsFlat.length) % visibleProjectsFlat.length]
        openProject(next)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, sessions, projects, tabs, activeTabId, visibleProjectsFlat])

  // keyboard: Alt+Arrows move between open windows, spatially.
  //   • within the active tab's tiled grid, move to the neighbouring window in that direction
  //   • at a left/right edge (or a single-window tab), ←/→ switch to the prev/next tab
  // Capture-phase so we intercept before xterm's word-nav; we only swallow the key when
  // there's somewhere to go, and never while a modal or the code editor has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const dir = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' }[e.key]
      if (!dir) return
      if (document.querySelector('.modal-overlay')) return
      // don't hijack arrows while editing in the docked code editor (plain textarea / Monaco)
      if ((document.activeElement as HTMLElement | null)?.closest?.('.editor, .monaco-editor')) return

      const tab = tabs.find((t) => t.id === activeTabId) ?? null
      const cols = liveColumns(tab, sessions)
      const lay = columnLayout(cols)
      const aw = tab?.activeWindow ?? ''
      let myCi = -1
      let myRi = -1
      cols.forEach((col, ci) => {
        const ri = col.indexOf(aw)
        if (ri >= 0) {
          myCi = ci
          myRi = ri
        }
      })

      // 1) move to the neighbouring window in that direction within the tab's tiled layout
      let target = ''
      if (myCi >= 0) {
        if (dir === 'U' || dir === 'D') {
          // previous/next window stacked in the same column
          const pos = myRi + (dir === 'D' ? 1 : -1)
          if (pos >= 0 && pos < cols[myCi].length) target = cols[myCi][pos]
        } else {
          // window in the adjacent column whose row range covers our vertical centre
          const tc = myCi + (dir === 'R' ? 1 : -1)
          const me = lay.cellOf.get(aw)
          if (me && tc >= 0 && tc < cols.length) {
            const center = me.rowStart + me.rowSpan / 2
            const col = cols[tc]
            target =
              col.find((id) => {
                const c = lay.cellOf.get(id)!
                return center >= c.rowStart && center <= c.rowStart + c.rowSpan
              }) ??
              col.reduce((best, id) => {
                if (!best) return id
                const c = lay.cellOf.get(id)!
                const bc = lay.cellOf.get(best)!
                const d = Math.abs(c.rowStart + c.rowSpan / 2 - center)
                const bd = Math.abs(bc.rowStart + bc.rowSpan / 2 - center)
                return d < bd ? id : best
              }, '') ??
              ''
          }
        }
      }
      if (target) {
        e.preventDefault()
        e.stopPropagation()
        focusWindow(target)
        return
      }

      // 2) horizontal edge -> switch tabs within the active project
      if (dir === 'L' || dir === 'R') {
        const ids = tabs.filter((t) => t.projectPath === activeProject).map((t) => t.id)
        if (ids.length < 2) return
        const ti = Math.max(0, ids.indexOf(activeTabId ?? ''))
        const next = ids[(ti + (dir === 'R' ? 1 : -1) + ids.length) % ids.length]
        e.preventDefault()
        e.stopPropagation()
        focusTab(next)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, activeTabId, tabs, sessions])

  // Dismiss the auto-focus highlight as soon as the user does anything (types, clicks, or
  // navigates) — that's the signal they've seen the jump and taken over the window.
  useEffect(() => {
    if (!autoFocused) return
    const clear = (): void => setAutoFocused(null)
    window.addEventListener('keydown', clear, true)
    window.addEventListener('mousedown', clear, true)
    return () => {
      window.removeEventListener('keydown', clear, true)
      window.removeEventListener('mousedown', clear, true)
    }
  }, [autoFocused])

  // Auto-focus queue: keep an ordered list of background windows that have finished and want
  // attention. A window is "pending" exactly while its status is 'waiting' (set on a background
  // Stop / Notification) and it isn't the one we're on. We keep discovery order and drop any
  // window that's no longer waiting (e.g. the user visited it -> focusWindow flips it to idle).
  useEffect(() => {
    setFinishedQueue((prev) => {
      const pending = new Set(
        sessions.filter((s) => s.status === 'waiting' && s.id !== activeId).map((s) => s.id)
      )
      const next = prev.filter((id) => pending.has(id))
      for (const s of sessions)
        if (s.status === 'waiting' && s.id !== activeId && !next.includes(s.id)) next.push(s.id)
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
    })
  }, [sessions, activeId])

  // Drain the queue: the moment the window you're on is busy again (you handed it off by
  // submitting input) — and you're not mid-question on it — jump to the oldest finished chat.
  // This also covers the instant case: if you're already watching a busy chat when another
  // finishes, it gets queued and immediately drained here.
  useEffect(() => {
    if (!config?.autoFocus) return
    const cur = sessions.find((s) => s.id === activeId)
    if (!cur || cur.status !== 'busy' || cur.awaitingInput) return
    const nextId = finishedQueue.find((id) => id !== activeId)
    if (!nextId) return
    focusWindow(nextId)
    setAutoFocused(nextId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, finishedQueue, activeId, config?.autoFocus])

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
  const reorderProjects = (orderedPaths: string[]): void => {
    if (!config) return
    saveConfig({ ...config, projectOrder: orderedPaths })
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
  const projectTabs = tabs.filter((t) => t.projectPath === activeProject)
  // union of files being touched / recently touched across ALL sessions (any agent)
  const allBusy = new Set(sessions.flatMap((s) => s.busyFiles))
  const allRecent = new Set(sessions.flatMap((s) => s.recentFiles))
  const isLeased = (p: string): boolean =>
    !!activeProject && !!coord && coord.leases.some((l) => leaseCoversPath(l.resource, p, activeProject))
  const editorLeasedBy =
    editorPath && activeProject && coord
      ? (coord.leases.find((l) => leaseCoversPath(l.resource, editorPath, activeProject))?.agent ?? null)
      : null
  // the windows the grid renders right now = the active tab's live windows
  const visibleEffective = liveWindows(activeTab, sessions)
  const layout = columnLayout(liveColumns(activeTab, sessions))
  const menuTab = tabMenu ? tabs.find((t) => t.id === tabMenu.id) ?? null : null

  return (
    <div className="app">
      <div className={`columns ${dragging ? 'resizing' : ''}`}>
        <aside className="col col-left" style={{ flex: `0 0 ${widths.left}px` }}>
          <Projects
            root={root}
            projects={orderedProjects}
            sessions={sessions}
            activeProject={activeProject}
            restoreExclude={config.restoreExclude ?? []}
            hidden={config.hidden ?? []}
            onOpen={openProject}
            onContext={(path, x, y) => setProjMenu({ path, x, y })}
            onReorder={reorderProjects}
          />
          <SkillsPanel skills={skills} activeSkill={active?.activeSkill ?? null} onPick={pickSkill} />
          <McpPanel
            servers={mcpServers}
            activeMcp={active?.mcpActive ?? []}
            onOpenFile={setEditorPath}
          />
        </aside>

        <div
          className={`col-resizer ${dragging === 'left' ? 'dragging' : ''}`}
          onMouseDown={startResize('left')}
          title="Drag to resize"
        />

        <main className="col col-center">
          <TabBar
            tabs={projectTabs}
            sessions={sessions}
            activeTabId={activeTabId}
            startedIds={started}
            onSelect={focusTab}
            onClose={closeTab}
            onNew={(kind) => activeProject && createSession(activeProject, kind)}
            onContext={(id, x, y) => setTabMenu({ id, x, y })}
            canNew={!!activeProject}
          />
          <CommandBar commands={projectInfo.commands} onRun={runCommand} />
          <div className={`center-body ${editorDocked && editorPath ? 'split' : ''}`}>
          <div
            className="terminals"
            style={{
              gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
            }}
          >
            {sessions.length === 0 && (
              <div className="terminal-empty">
                <p>Pick a project on the left to launch a Claude session.</p>
                <p className="hint">
                  Runs your logged-in <code>claude.exe</code> — no API key.
                </p>
              </div>
            )}
            {sessions.map((s) => {
              const cell = layout.cellOf.get(s.id) ?? null
              return (
                <div
                  key={s.id}
                  className="term-slot"
                  style={
                    cell
                      ? {
                          display: 'flex',
                          gridColumn: cell.col,
                          gridRow: `${cell.rowStart} / span ${cell.rowSpan}`
                        }
                      : { display: 'none' }
                  }
                >
                  <Pane
                    session={s}
                    active={s.id === activeId}
                    canRemove={visibleEffective.length > 1}
                    autoFocused={s.id === autoFocused}
                    onFocus={() => focusWindow(s.id)}
                    onSplit={() => createSession(s.projectPath, 'claude', { split: true })}
                    onRemove={() => closeWindow(s.id)}
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
                      lastPrompt={s.lastPrompt}
                      lastPromptTs={s.lastPromptTs}
                      onTitle={(t) => retitleFromTerminal(s.id, t)}
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

        <div
          className={`col-resizer ${dragging === 'right' ? 'dragging' : ''}`}
          onMouseDown={startResize('right')}
          title="Drag to resize"
        />

        <aside className="col col-right" style={{ flex: `0 0 ${widths.right}px` }}>
          <SkillHud session={active} />
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

      {tabMenu && menuTab && (
        <>
          <div className="menu-backdrop" onClick={() => setTabMenu(null)} />
          <div className="context-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
            <div
              className="dropdown-item"
              onClick={() => {
                createSession(menuTab.projectPath, 'claude', { targetTabId: menuTab.id })
                setTabMenu(null)
              }}
            >
              Split — new Claude window
            </div>
            <div
              className="dropdown-item danger"
              onClick={() => {
                closeTab(menuTab.id)
                setTabMenu(null)
              }}
            >
              Close tab{tabWindows(menuTab).length > 1 ? ` (${tabWindows(menuTab).length} windows)` : ''}
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
              {(config.hidden ?? []).includes(projMenu.path) ? (
                '👁 Unhide project'
              ) : (
                <>
                  <EyeOffIcon /> Hide project
                </>
              )}
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

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {rebuildBusy && (
        <ConfirmModal
          title="Rebuild & Restart"
          confirmLabel="Rebuild anyway"
          danger
          onConfirm={() => {
            setRebuildBusy(null)
            window.orbit.rebuildApp()
          }}
          onCancel={() => {
            setRebuildBusy(null)
            const id = activeIdRef.current
            if (id) setTimeout(() => handles.current.get(id)?.focus(), 0)
          }}
        >
          <p>
            {rebuildBusy.length} chat{rebuildBusy.length > 1 ? 's are' : ' is'} still running (
            {rebuildBusy.join(', ')}).
          </p>
          <p>Rebuilding will stop them and restart Orbit. Continue?</p>
        </ConfirmModal>
      )}

      {updateOpen && update && (
        <UpdateModal
          status={update}
          onDismiss={() => setUpdateOpen(false)}
          onCloseEverything={() => {
            // freeze persistence (so the saved layout survives), then tear down every tab/window
            // so nothing holds claude.exe open while winget replaces the binary
            setUpgrading(true)
            setSessions([])
            setTabs([])
            setActiveTabId(null)
            setActiveProject(null)
          }}
        />
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
