import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
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
import { applyTheme, readableOn, THEMES } from './themes'
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
import { startPathDrag } from './components/drag'
import { EditorModal, type ChatRef } from './components/EditorModal'
import { FileTypesHelp } from './components/FileTypesHelp'
import { CoordPanel } from './components/CoordPanel'
import { LogPanel } from './components/LogPanel'
import { SubAgents } from './components/SubAgents'
import { SkillHud } from './components/SkillHud'
import { DocsStrip } from './components/DocsStrip'
import { CommandBar } from './components/CommandBar'
import { HelpPopup } from './components/HelpPopup'
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

/** Width each Ctrl+Shift+←/→ press shifts across the divider, and the floor any column keeps. */
const RESIZE_STEP = 0.05
const MIN_COL_WEIGHT = 0.15

/** Pixels each Ctrl+Shift+←/→ press grows/shrinks the file-viewer dock (when it has focus). */
const EDITOR_RESIZE_STEP = 60

/**
 * The grid's `gridTemplateColumns`. With explicit per-column weights it renders them as `fr`
 * units (kept as `minmax(0, Xfr)` so panes can still shrink below their content); without them
 * (the default / any legacy workspace) it falls back to equal `repeat(cols, …)` — pixel-identical
 * to the pre-weights behavior. Weights only apply when their count matches the live column count;
 * a mismatch (stale data) safely degrades to equal widths.
 */
function gridTemplateColumns(cols: number, weights?: number[]): string {
  if (weights && weights.length === cols) {
    return weights.map((w) => `minmax(0, ${w}fr)`).join(' ')
  }
  return `repeat(${cols}, minmax(0, 1fr))`
}

/**
 * Shift the divider on the active column's right edge (or its left edge when the active column is
 * the rightmost) by one step in the given direction, returning new weights. Moving the divider
 * left shrinks the active column and grows its right neighbor; moving right does the mirror. Both
 * columns are clamped to MIN_COL_WEIGHT so neither collapses, and the moved amount is conserved
 * (one side gains exactly what the other loses), keeping the total constant.
 */
function resizeWeights(weights: number[], activeCol: number, dir: 'L' | 'R'): number[] {
  // Pick the divider: prefer the one to the active column's right, else its left edge.
  const hasRight = activeCol < weights.length - 1
  const leftIdx = hasRight ? activeCol : activeCol - 1
  const rightIdx = leftIdx + 1
  if (leftIdx < 0 || rightIdx >= weights.length) return weights
  // 'L' moves the divider left: the left column shrinks. 'R' moves it right: the left column grows.
  const delta = dir === 'L' ? -RESIZE_STEP : RESIZE_STEP
  const nextLeft = weights[leftIdx] + delta
  const nextRight = weights[rightIdx] - delta
  if (nextLeft < MIN_COL_WEIGHT || nextRight < MIN_COL_WEIGHT) return weights
  const next = [...weights]
  next[leftIdx] = nextLeft
  next[rightIdx] = nextRight
  return next
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

/** Where a dragged window lands relative to the pane it's dropped on. */
type DropZone = 'left' | 'right' | 'top' | 'bottom'

/**
 * Move a window next to another via drag-and-drop. 'left'/'right' carve out a brand-new column
 * on that side of the target's column; 'top'/'bottom' stack it within the target's column. The
 * dragged window is removed first (its emptied column collapses), then re-inserted relative to
 * the target's position *after* that collapse, so indices stay honest.
 */
function moveWindow(columns: string[][], dragId: string, targetId: string, zone: DropZone): string[][] {
  if (dragId === targetId) return columns
  const cols = columns.map((c) => c.filter((w) => w !== dragId)).filter((c) => c.length > 0)
  const ci = cols.findIndex((c) => c.includes(targetId))
  if (ci < 0) return columns
  if (zone === 'left' || zone === 'right') {
    cols.splice(zone === 'left' ? ci : ci + 1, 0, [dragId])
  } else {
    const at = cols[ci].indexOf(targetId)
    cols[ci] = [...cols[ci]]
    cols[ci].splice(zone === 'top' ? at : at + 1, 0, dragId)
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

/**
 * A window the user just closed, kept so Ctrl+Shift+W can reopen it where it was (undo-close).
 * We snapshot enough to recreate the session and drop it back into the same tab/column/row. If
 * the closed session had a `resumeId` it gets resumed into the same conversation; if it was an
 * empty chat (no transcript was ever written, so no resumeId) we reopen a fresh chat in its
 * place instead — there's nothing to resume.
 */
interface ClosedWindow {
  session: {
    projectPath: string
    projectName: string
    kind: TermKind
    title: string
    resumeId?: string
    startupCommand?: string
    lastPrompt: string
  }
  /** id of the tab it lived in (recreated with this id if the tab itself was dropped) */
  tabId: string
  tabProjectPath: string
  /** index of the owning tab among all tabs at close time (where to re-insert a dropped tab) */
  tabIndex: number
  /** column / row of the window within its tab at close time */
  colIndex: number
  rowIndex: number
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
  const [fileTabMenu, setFileTabMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [rightView, setRightView] = useState<'context' | 'files' | 'coord' | 'logs'>('files')
  // AGENTS+ACTIVITY collapsed to a slim header bar — auto-derived from the tab (FILES needs the
  // vertical space), manually toggleable until the next tab switch re-derives it
  const [actCollapsed, setActCollapsed] = useState(false)
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set())
  const [editorWidth, setEditorWidth] = useState(520)
  const [closeRequestedFor, setCloseRequestedFor] = useState<string | null>(null)
  const [showEditorHelp, setShowEditorHelp] = useState(false)
  const [coord, setCoord] = useState<CoordState | null>(null)
  const [log, setLog] = useState<LogState | null>(null)
  const [gitChanged, setGitChanged] = useState<Set<string>>(new Set())
  const [keyDocs, setKeyDocs] = useState<KeyDoc[]>([])
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>({ commands: [], prompts: [], accent: null })
  // side-column widths (px), drag the dividers to resize; seeded from + persisted to config
  const [widths, setWidths] = useState({ left: 230, right: 340 })
  // side columns collapsed to a thin strip (chevron on the divider / strip toggles)
  const [collapsed, setCollapsed] = useState({ left: false, right: false })
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  // relative heights of each side column's stacked sections (left: projects/skills/mcp,
  // right: context-tabs/activity) — drag the horizontal dividers to rebalance them
  const [splits, setSplits] = useState<{ left: number[]; right: number[] }>({
    left: [42, 28, 30],
    right: [45, 55]
  })
  const [vDragging, setVDragging] = useState(false)
  // window id that auto-focus just jumped to — shows a highlight until the user interacts
  const [autoFocused, setAutoFocused] = useState<string | null>(null)
  // window-id being dragged to a new grid position, and the current drop hint under the cursor
  const [dragWin, setDragWin] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ target: string; zone: DropZone } | null>(null)
  // ordered queue of background windows that have finished and want attention (oldest first);
  // auto-focus drains it one at a time as the user hands off the window they're on
  const [finishedQueue, setFinishedQueue] = useState<string[]>([])

  const handles = useRef<Map<string, TermHandle>>(new Map())
  // stack of recently closed windows for Ctrl+Shift+W (undo-close); newest on top
  const closedStack = useRef<ClosedWindow[]>([])
  const activeIdRef = useRef<string | null>(null)
  const activeProjectRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef<string>('')
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const editorWidthRef = useRef(520)
  const editorWidthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const splitsRef = useRef(splits)
  splitsRef.current = splits
  const configRef = useRef<AppConfig | null>(config)
  configRef.current = config
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const openFilesRef = useRef<string[]>([])
  openFilesRef.current = openFiles
  const activeFilePathRef = useRef<string | null>(null)
  activeFilePathRef.current = activeFilePath
  const prevActiveProject = useRef<string | null>(null)
  const openFilesByProject = useRef<Record<string, { files: string[]; active: string | null }>>({});
  const widthsSeeded = useRef(false)

  // The active tab and, within it, the focused window (= what the toolbar/skills act on).
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activeId =
    activeTab && sessions.some((s) => s.id === activeTab.activeWindow)
      ? activeTab.activeWindow
      : liveWindows(activeTab, sessions)[0] ?? null

  useEffect(() => {
    activeIdRef.current = activeId
    // keep main posted on the focused session, so it can skip toasts the user is already seeing
    window.orbit.setNotifyActiveSession(activeId)
  }, [activeId])
  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  // FILES is the one tab starved for vertical space — collapse AGENTS+ACTIVITY while it's open,
  // restore the split on any other tab (manual toggles last until the next switch re-derives)
  useEffect(() => {
    setActCollapsed(rightView === 'files')
  }, [rightView])

  // seed the side-column widths from config once it has loaded
  useEffect(() => {
    if (config && !widthsSeeded.current) {
      widthsSeeded.current = true
      setWidths({ left: config.leftWidth ?? 230, right: config.rightWidth ?? 340 })
      editorWidthRef.current = config.editorWidth ?? 520
      setEditorWidth(config.editorWidth ?? 520)
      setCollapsed({ left: !!config.leftCollapsed, right: !!config.rightCollapsed })
      // section heights only apply when the stored count matches (stale data degrades to defaults)
      setSplits((s) => ({
        left: config.leftSplit?.length === s.left.length ? config.leftSplit : s.left,
        right: config.rightSplit?.length === s.right.length ? config.rightSplit : s.right
      }))
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

  // Collapse/expand a side column (chevron on the divider collapses; clicking the leftover
  // strip expands). The dragged width stays in state/config, so expanding restores the column
  // at the size it was collapsed from. Current widths are written along with the flags so a
  // collapse never persists a stale width over one dragged earlier in the session.
  const toggleCollapse = (side: 'left' | 'right'): void => {
    const next = { ...collapsed, [side]: !collapsed[side] }
    setCollapsed(next)
    const cfg = configRef.current
    if (cfg)
      saveConfig({
        ...cfg,
        leftCollapsed: next.left,
        rightCollapsed: next.right,
        leftWidth: widthsRef.current.left,
        rightWidth: widthsRef.current.right
      })
  }

  // Drag the left edge of the editor panel to resize it
  const startEditorResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = editorWidthRef.current
    const clamp = (n: number): number => Math.max(320, Math.min(1400, n))
    const onMove = (ev: MouseEvent): void => {
      const next = clamp(startW - (ev.clientX - startX))
      editorWidthRef.current = next
      setEditorWidth(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const cfg = configRef.current
      if (cfg) window.orbit.setConfig({ ...cfg, editorWidth: editorWidthRef.current })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Keyboard resize of the editor dock (Ctrl/Alt+Shift+←/→ when the viewer has focus). The dock is
  // right-anchored with its drag handle on the left edge, so — matching the mouse drag — ArrowLeft
  // grows it and ArrowRight shrinks it. The config write is debounced so key-repeat doesn't spam disk.
  const resizeEditor = useCallback((dir: 'L' | 'R'): void => {
    const clamp = (n: number): number => Math.max(320, Math.min(1400, n))
    const next = clamp(editorWidthRef.current + (dir === 'L' ? EDITOR_RESIZE_STEP : -EDITOR_RESIZE_STEP))
    editorWidthRef.current = next
    setEditorWidth(next)
    if (editorWidthSaveTimer.current) clearTimeout(editorWidthSaveTimer.current)
    editorWidthSaveTimer.current = setTimeout(() => {
      const cfg = configRef.current
      if (cfg) window.orbit.setConfig({ ...cfg, editorWidth: editorWidthRef.current })
    }, 400)
  }, [])

  const openFile = (path: string): void => {
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setActiveFilePath(path)
  }

  const closeFile = (path: string): void => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path)
      setActiveFilePath((active) => {
        if (active !== path) return active
        const idx = prev.indexOf(path)
        return next[idx] ?? next[idx - 1] ?? null
      })
      return next
    })
    setDirtyFiles((prev) => { const n = new Set(prev); n.delete(path); return n })
  }

  const handleTabClose = (path: string): void => {
    if (dirtyFiles.has(path)) {
      setActiveFilePath(path)
      setCloseRequestedFor(path)
    } else {
      closeFile(path)
    }
  }

  // Start dragging the horizontal divider between section i and i+1 of a side column. Works in
  // pixels against the two neighbours' real heights at mousedown, converted back to relative
  // weights so the pair's total is conserved and the rest of the column doesn't move.
  const startSectResize = (side: 'left' | 'right', i: number) => (e: React.MouseEvent): void => {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    const prev = handle.previousElementSibling as HTMLElement | null
    const next = handle.nextElementSibling as HTMLElement | null
    if (!prev || !next) return
    setVDragging(true)
    const startY = e.clientY
    const hA = prev.getBoundingClientRect().height
    const hB = next.getBoundingClientRect().height
    const weights = splitsRef.current[side]
    const pair = weights[i] + weights[i + 1]
    // keep each section at least ~48px so a header never disappears entirely
    const minW = hA + hB > 0 ? pair * (48 / (hA + hB)) : 0
    const onMove = (ev: MouseEvent): void => {
      const dy = ev.clientY - startY
      const wA = Math.max(minW, Math.min(pair - minW, pair * ((hA + dy) / (hA + hB))))
      setSplits((s) => {
        const arr = [...s[side]]
        arr[i] = wA
        arr[i + 1] = pair - wA
        return { ...s, [side]: arr }
      })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setVDragging(false)
      const cfg = configRef.current
      if (cfg)
        window.orbit.setConfig({
          ...cfg,
          leftSplit: splitsRef.current.left,
          rightSplit: splitsRef.current.right
        })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const updateSession = useCallback((id: string, fn: (s: SessionState) => SessionState) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  // Resize the active tab's split by moving the divider of the active window's column. Shared by
  // the Ctrl+Shift+←/→ and Alt+Shift+←/→ keyboard branches so the two paths can't drift. No-op
  // (returns false) with fewer than 2 live columns, so each branch can decide whether to swallow
  // the key.
  const resizeSplit = useCallback(
    (dir: 'L' | 'R'): boolean => {
      const tab = tabs.find((t) => t.id === activeTabId) ?? null
      const cols = liveColumns(tab, sessions)
      if (!tab || cols.length < 2) return false
      const activeCol = cols.findIndex((c) => c.includes(tab.activeWindow))
      if (activeCol < 0) return false
      // Seed from equal weights when none are stored yet (legacy/just-split tabs).
      const base = tab.colWeights?.length === cols.length ? tab.colWeights : cols.map(() => 1)
      const next = resizeWeights(base, activeCol, dir)
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, colWeights: next } : t)))
      return true
    },
    [tabs, sessions, activeTabId]
  )

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
          if (!ws) return
          // Restore the open file-viewer tabs (order + active) independently of sessions, so
          // files come back even when there were no terminals open. The per-project switch
          // effect re-derives openFiles from this map when openFilesPerProject is on.
          if (ws.editorsByProject) openFilesByProject.current = ws.editorsByProject
          if (ws.openEditors?.length) {
            setOpenFiles(ws.openEditors)
            setActiveFilePath(ws.activeEditor ?? ws.openEditors[0])
          }
          if (!ws.sessions.length) return
          const exclude = new Set(cfg.restoreExclude ?? [])
          const keep = ws.sessions.filter((p) => !exclude.has(p.projectPath))
          if (!keep.length) return
          const keptIds = new Set(keep.map((s) => s.id))
          setSessions(
            keep.map((p) => ({
              ...initSession(p.id, p.projectPath, p.projectName, p.kind, p.title, p.resumeId),
              lastPrompt: p.lastPrompt ?? '',
              recentFiles: p.recentFiles ?? []
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
                // Keep persisted widths only when they still line up with the (possibly trimmed)
                // live column count; otherwise drop to equal so weights never go stale. Older
                // workspaces have no colWeights at all and simply load as equal widths.
                const colWeights = t.colWeights?.length === columns.length ? t.colWeights : undefined
                return { id: t.id, projectPath: t.projectPath, columns, colWeights, activeWindow: aw } as Tab
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
        lastPrompt: s.lastPrompt ? s.lastPrompt.slice(0, 500) : undefined,
        recentFiles: s.recentFiles.length ? s.recentFiles : undefined
      })),
      tabs: tabs.map((t) => ({
        id: t.id,
        projectPath: t.projectPath,
        columns: t.columns,
        colWeights: t.colWeights,
        activeWindow: t.activeWindow
      })),
      activeProject,
      activeTabId,
      openEditors: openFiles,
      activeEditor: activeFilePath,
      editorsByProject: openFilesByProject.current
    }
    const str = JSON.stringify(snapshot)
    if (str === lastSaved.current) return
    lastSaved.current = str
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.orbit.saveWorkspace(snapshot), 400)
  }, [sessions, tabs, activeProject, activeTabId, openFiles, activeFilePath, restored, config?.restoreOnLaunch, upgrading])

  useEffect(() => {
    window.orbit.listSkills(activeProject).then(setSkills)
    window.orbit.listMcp(activeProject).then(setMcpServers)
    // re-point coordination + log watchers and pinned docs at the active project
    setCoord(null)
    setLog(null)
    setKeyDocs([])
    setProjectInfo({ commands: [], prompts: [], accent: null })
    setGitChanged(new Set())
    if (activeProject) {
      window.orbit.coordWatch(activeProject)
      window.orbit.logWatch(activeProject)
      window.orbit.listKeyDocs(activeProject).then(setKeyDocs)
      window.orbit.getProjectInfo(activeProject).then(setProjectInfo)
      window.orbit.gitStatus(activeProject).then((paths) => setGitChanged(new Set(paths)))
    }
  }, [activeProject])

  // save/restore open editor tabs per project when openFilesPerProject is enabled
  useEffect(() => {
    const prev = prevActiveProject.current
    const perProject = configRef.current?.openFilesPerProject ?? false
    if (perProject && prev !== null && prev !== activeProject) {
      openFilesByProject.current[prev] = {
        files: openFilesRef.current,
        active: activeFilePathRef.current
      }
    }
    if (perProject && prev !== activeProject) {
      const saved = activeProject !== null ? openFilesByProject.current[activeProject] : null
      setOpenFiles(saved?.files ?? [])
      setActiveFilePath(saved?.active ?? null)
    }
    prevActiveProject.current = activeProject
  }, [activeProject])

  // color-code the UI with the active project's declared accent (revert to theme if none)
  useEffect(() => {
    const root = document.documentElement
    if (projectInfo.accent) {
      root.style.setProperty('--accent', projectInfo.accent)
      root.style.setProperty('--accent-fg', readableOn(projectInfo.accent))
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-fg')
    }
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
    // applyTheme rewrites every token (incl. --accent/--accent-fg); restore the
    // active project's accent override on top so a theme switch doesn't drop it
    if (projectInfo.accent) {
      document.documentElement.style.setProperty('--accent', projectInfo.accent)
      document.documentElement.style.setProperty('--accent-fg', readableOn(projectInfo.accent))
    }
  }, [config?.theme, projectInfo.accent])

  // UI scaling: uiScale zooms the whole window (panels, text, icons, terminals alike);
  // windowUiScale scales just the chat-window chrome via the --window-ui-scale CSS var
  // (pane title bar, pinned prompt, jump arrow, quick prompts). Terminals refit themselves
  // automatically — the zoom changes their layout size, which fires their ResizeObserver.
  useEffect(() => {
    if (!config) return
    window.orbit.setUiZoom(config.uiScale || 1)
    document.documentElement.style.setProperty('--window-ui-scale', String(config.windowUiScale || 1))
  }, [config?.uiScale, config?.windowUiScale])

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
        // /clear discarded the conversation — wipe the terminal scrollback behind the fresh
        // screen too, so scrolling up doesn't show the dead conversation. Delayed a beat so
        // claude's own clear+repaint lands first (we erase saved lines, not the visible screen).
        if (evt.event === 'SessionStart' && evt.data?.source === 'clear') {
          const id = evt.sessionId
          setTimeout(() => handles.current.get(id)?.clearScrollback(), 150)
        }
      }),
    [updateSession]
  )

  // A desktop-notification click: main has already raised the window; jump to the session
  // that raised the toast. (Ref-indirected so the subscription survives re-renders without
  // capturing a stale focusWindow closure.)
  const focusWindowRef = useRef<(id: string) => void>(() => {})
  focusWindowRef.current = focusWindow
  useEffect(() => window.orbit.onNotifyActivate((id) => focusWindowRef.current(id)), [])

  // open Settings / History from the app menu (hidden bar — popped via the tab bar's ☰,
  // or driven directly by its accelerators)
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
          const columns = splitInsert(t.columns, t.activeWindow, id)
          // Reset to equal widths whenever the column count changes, so weights never go stale
          // against `columns`; a same-count split (stacked into an existing column) keeps them.
          const colWeights = columns.length === t.columns.length ? t.colWeights : undefined
          return { ...t, columns, colWeights, activeWindow: id }
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
      setActiveProject(next?.projectPath ?? null)
    }
  }

  /** Close all tabs and sessions belonging to a project. */
  function closeProject(projectPath: string): void {
    const projTabs = tabs.filter((t) => t.projectPath === projectPath)
    projTabs.forEach((tab) => {
      tabWindows(tab).forEach((w) => snapshotClosed(w))
    })
    const winSet = new Set(projTabs.flatMap((t) => tabWindows(t)))
    setSessions((prev) => prev.filter((s) => !winSet.has(s.id)))
    const rest = tabs.filter((t) => t.projectPath !== projectPath)
    setTabs(rest)
    if (activeProject === projectPath) {
      const next = rest[rest.length - 1] ?? null
      setActiveTabId(next?.id ?? null)
      setActiveProject(next?.projectPath ?? null)
    }
  }

  /** Remember a window we're about to close so Ctrl+Shift+W can reopen it where it was. */
  function snapshotClosed(windowId: string): void {
    const sess = sessions.find((s) => s.id === windowId)
    if (!sess) return
    const tab = tabs.find((t) => tabWindows(t).includes(windowId)) ?? null
    let colIndex = 0
    let rowIndex = 0
    let tabIndex = tabs.length
    let tabId = ''
    let tabProjectPath = sess.projectPath
    if (tab) {
      tabId = tab.id
      tabProjectPath = tab.projectPath
      tabIndex = tabs.findIndex((t) => t.id === tab.id)
      tab.columns.forEach((col, ci) => {
        const ri = col.indexOf(windowId)
        if (ri >= 0) {
          colIndex = ci
          rowIndex = ri
        }
      })
    }
    closedStack.current.push({
      session: {
        projectPath: sess.projectPath,
        projectName: sess.projectName,
        kind: sess.kind,
        title: sess.title,
        resumeId: sess.resumeId,
        startupCommand: sess.startupCommand,
        lastPrompt: sess.lastPrompt
      },
      tabId,
      tabProjectPath,
      tabIndex,
      colIndex,
      rowIndex
    })
    if (closedStack.current.length > 25) closedStack.current.shift()
  }

  /**
   * Reopen the most recently closed window (Ctrl+Shift+W). Restores it into the same tab and
   * column/row it was closed from — recreating the tab if it was dropped. A chat that held a
   * real conversation comes back resumed (--resume via its resumeId); an empty chat (no
   * resumeId) just reopens fresh in its place, since there's no transcript to resume.
   */
  function reopenClosed(): void {
    const entry = closedStack.current.pop()
    if (!entry) return
    const s = entry.session
    const resumeId = s.resumeId
    // already reopened (e.g. via History)? just focus it and drop the entry.
    if (resumeId) {
      const open = sessions.find((x) => x.resumeId === resumeId)
      if (open) {
        focusWindow(open.id)
        return
      }
    }
    const id = uid()
    setSessions((prev) => [
      ...prev,
      {
        ...initSession(id, s.projectPath, s.projectName, s.kind, s.title, resumeId, s.startupCommand),
        lastPrompt: resumeId ? s.lastPrompt : ''
      }
    ])
    setActiveProject(s.projectPath)

    const existing = tabs.find((t) => t.id === entry.tabId)
    if (existing) {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== entry.tabId) return t
          const columns = t.columns.map((c) => [...c])
          const ci = Math.min(entry.colIndex, columns.length)
          if (ci >= columns.length) columns.push([id])
          else columns[ci].splice(Math.min(entry.rowIndex, columns[ci].length), 0, id)
          return { ...t, columns, activeWindow: id }
        })
      )
      setActiveTabId(entry.tabId)
    } else {
      const tabId = entry.tabId || uid()
      setTabs((prev) => {
        const at = Math.min(Math.max(entry.tabIndex, 0), prev.length)
        const next = [...prev]
        next.splice(at, 0, { id: tabId, projectPath: entry.tabProjectPath, columns: [[id]], activeWindow: id })
        return next
      })
      setActiveTabId(tabId)
    }
    setTimeout(() => handles.current.get(id)?.focus(), 0)
  }

  /**
   * Close one window. If it's the tab's last window, the tab closes too; closing the very
   * last tab falls back to another open project's tab, or the empty state if none remain.
   */
  function closeWindow(windowId: string): void {
    const tab = tabs.find((t) => tabWindows(t).includes(windowId))
    if (!tab) {
      snapshotClosed(windowId)
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
    snapshotClosed(windowId)
    setSessions((prev) => prev.filter((s) => s.id !== windowId))
    if (remaining.length > 0) {
      const nextActive =
        tab.activeWindow === windowId ? neighbour ?? remaining[remaining.length - 1] : tab.activeWindow
      // Reset to equal widths if closing dropped a whole column (count change); otherwise keep them.
      const colWeights = columns.length === tab.columns.length ? tab.colWeights : undefined
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, columns, colWeights, activeWindow: nextActive } : t))
      )
      return
    }
    dropTab(tab.id)
  }

  /** Close a whole tab (every window inside it). */
  function closeTab(tabId: string): void {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    const wins = tabWindows(tab)
    wins.forEach((w) => snapshotClosed(w))
    const winSet = new Set(wins)
    setSessions((prev) => prev.filter((s) => !winSet.has(s.id)))
    dropTab(tabId)
  }

  // keyboard:
  //   • Ctrl+\           split the active tab with a new Claude window
  //   • Ctrl+W           close the active window (and its tab if it was the last window)
  //   • Ctrl+Shift+W     reopen the most recently closed window where it was (undo-close)
  //   • Ctrl+(Shift+)Tab next/previous tab of the active project (cycles)
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

      // Ctrl+Shift+W → reopen the most recently closed window where it was (undo-close)
      if (e.shiftKey && e.key.toLowerCase() === 'w') {
        grab()
        reopenClosed()
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → next/previous tab of the active project (cycles)
      if (e.key === 'Tab') {
        const projTabs = tabs.filter((t) => t.projectPath === activeProject)
        if (projTabs.length < 2) return
        grab()
        const cur = projTabs.findIndex((t) => t.id === activeTabId)
        const step = e.shiftKey ? -1 : 1
        focusTab(projTabs[(Math.max(cur, 0) + step + projTabs.length) % projTabs.length].id)
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

      // Ctrl+Shift+←/→ → resize the split: move the divider of the active window's column.
      // We pick the divider on the RIGHT edge of the active column when one exists, else its LEFT
      // edge (active column is the rightmost). ArrowLeft moves that divider left, ArrowRight right.
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Focus inside the file viewer → resize the editor dock width instead of the columns.
        if (openFilesRef.current.length && document.activeElement?.closest?.('.editor-dock')) {
          grab()
          resizeEditor(e.key === 'ArrowLeft' ? 'L' : 'R')
          return
        }
        // No-op (don't swallow the key) with fewer than 2 columns — resizeSplit returns false.
        if (resizeSplit(e.key === 'ArrowLeft' ? 'L' : 'R')) grab()
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
  }, [activeProject, sessions, projects, tabs, activeTabId, visibleProjectsFlat, resizeSplit])

  // keyboard: Alt+Arrows move between open windows, spatially.
  //   • within the active tab's tiled grid, move to the neighbouring window in that direction
  //   • at a left/right edge (or a single-window tab), ←/→ switch to the prev/next tab
  // Capture-phase so we intercept before xterm's word-nav; we only swallow the key when
  // there's somewhere to go, and never while a modal or the code editor has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return

      // Alt+Shift+←/→ → resize the split (Windows Terminal convention). Same behaviour as the
      // Ctrl+Shift+←/→ branch: move the divider of the active window's column, and only swallow
      // the key when the resize actually happened (resizeSplit returns false with <2 columns).
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (document.querySelector('.modal-overlay')) return
        // Focus inside the file viewer → resize the editor dock width instead of the columns.
        if (openFilesRef.current.length && document.activeElement?.closest?.('.editor-dock')) {
          e.preventDefault()
          e.stopPropagation()
          resizeEditor(e.key === 'ArrowLeft' ? 'L' : 'R')
          return
        }
        if (resizeSplit(e.key === 'ArrowLeft' ? 'L' : 'R')) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (e.shiftKey) return

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
  }, [activeProject, activeTabId, tabs, sessions, resizeSplit])

  // OS file drops are only meaningful on a terminal (which handles them itself, capturing the
  // event). Anywhere else, swallow the drop — Electron's default would navigate the window to
  // the dropped file's file:// URL, replacing the whole app.
  useEffect(() => {
    // (Event, not DragEvent — the React DragEvent type imported above shadows the DOM one)
    const block = (e: Event): void => {
      const dt = (e as { dataTransfer?: DataTransfer | null }).dataTransfer
      if (dt?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

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

  // Windows auto-focus already showed the user once. If they navigate away without engaging,
  // that's a deliberate "not now" — the window is treated as seen and never re-queued for the
  // same turn (a stray Notification would otherwise flip it back to 'waiting' and auto-focus
  // would keep dragging the user back). The snooze lifts when the window starts a new turn.
  const autoFocusSeen = useRef<Set<string>>(new Set())

  // Auto-focus queue: keep an ordered list of background windows that have finished and want
  // attention. A window is "pending" while its status is 'waiting' (set on a background
  // Stop / Notification) OR it's blocked on a question / plan approval (awaitingInput) — both
  // mean it needs the user — and it isn't the one we're on. We keep discovery order and drop
  // any window that's no longer pending (e.g. the user visited it -> focusWindow flips it to
  // idle, or the question got answered).
  useEffect(() => {
    // a new turn re-arms auto-focus for a previously snoozed window
    for (const s of sessions) if (s.status === 'busy') autoFocusSeen.current.delete(s.id)
    const needsUser = (s: SessionState): boolean =>
      (s.status === 'waiting' || s.awaitingInput) && !autoFocusSeen.current.has(s.id)
    setFinishedQueue((prev) => {
      const pending = new Set(
        sessions.filter((s) => needsUser(s) && s.id !== activeId).map((s) => s.id)
      )
      const next = prev.filter((id) => pending.has(id))
      for (const s of sessions)
        if (needsUser(s) && s.id !== activeId && !next.includes(s.id)) next.push(s.id)
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
    })
  }, [sessions, activeId])

  // Drain the queue: the moment the window you're on is busy again (you handed it off by
  // submitting input) — and you're not mid-question on it — jump to the oldest finished chat.
  // This also covers the instant case: if you're already watching a busy chat when another
  // finishes, it gets queued and immediately drained here. Crucially this only fires on a
  // real hand-off — the window you were *already on* turning busy, or a new finished window
  // arriving while you stayed put — never on the render where you manually switched windows,
  // so clicking onto a busy session doesn't get hijacked.
  const drainRef = useRef<{ activeId: string | null; busy: boolean; queueHead: string | undefined }>({
    activeId: null,
    busy: false,
    queueHead: undefined
  })
  useEffect(() => {
    const cur = sessions.find((s) => s.id === activeId)
    const nextId = finishedQueue.find((id) => id !== activeId)
    const prev = drainRef.current
    drainRef.current = { activeId, busy: cur?.status === 'busy', queueHead: nextId }
    if (!config?.autoFocus) return
    if (!cur || cur.status !== 'busy' || cur.awaitingInput) return
    if (!nextId) return
    // user just navigated here themselves — don't yank them away
    if (prev.activeId !== activeId) return
    // nothing new happened on this window: it was already busy and the queue head is unchanged
    if (prev.busy && prev.queueHead === nextId) return
    focusWindow(nextId)
    setAutoFocused(nextId)
    // one jump per turn: even if the user leaves without engaging, don't bring them back here
    autoFocusSeen.current.add(nextId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, finishedQueue, activeId, config?.autoFocus])

  /** Which side of a pane the cursor is over while dragging — outer quarters split into a new
   *  column left/right; the middle half stacks above/below within the target's column. */
  function zoneAt(e: DragEvent, el: HTMLElement): DropZone {
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    if (x < 0.25) return 'left'
    if (x > 0.75) return 'right'
    return (e.clientY - r.top) / r.height < 0.5 ? 'top' : 'bottom'
  }

  /** Commit a drag-rearrange: move the dragged window next to `targetId` in the active tab. */
  function dropWindow(targetId: string, zone: DropZone): void {
    const dragId = dragWin
    setDragWin(null)
    setDropHint(null)
    if (!dragId || dragId === targetId) return
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTabId || !tabWindows(t).includes(dragId)) return t
        const columns = moveWindow(t.columns, dragId, targetId, zone)
        if (columns === t.columns) return t
        // a changed column count invalidates the stored widths (same rule as split/close)
        const colWeights = columns.length === t.columns.length ? t.colWeights : undefined
        return { ...t, columns, colWeights, activeWindow: dragId }
      })
    )
    focusWindow(dragId)
  }

  /** Commit a drag onto a tab in the tab bar: move the dragged window out of its own tab and
   *  merge it into `targetTabId` (split next to that tab's active window). The emptied source
   *  tab disappears; weights reset wherever the column count changed (same rule as split/close). */
  function dropWindowOnTab(targetTabId: string): void {
    const dragId = dragWin
    setDragWin(null)
    setDropHint(null)
    if (!dragId) return
    const source = tabs.find((t) => tabWindows(t).includes(dragId))
    const target = tabs.find((t) => t.id === targetTabId)
    if (!source || !target || source.id === target.id) return
    if (source.projectPath !== target.projectPath) return
    setTabs((prev) =>
      prev
        .map((t) => {
          if (t.id === source.id) {
            const columns = t.columns.map((c) => c.filter((w) => w !== dragId)).filter((c) => c.length > 0)
            const colWeights = columns.length === t.columns.length ? t.colWeights : undefined
            const activeWindow = t.activeWindow === dragId ? (columns[0]?.[0] ?? '') : t.activeWindow
            return { ...t, columns, colWeights, activeWindow }
          }
          if (t.id === target.id) {
            const columns = splitInsert(t.columns, t.activeWindow, dragId)
            const colWeights = columns.length === t.columns.length ? t.colWeights : undefined
            return { ...t, columns, colWeights, activeWindow: dragId }
          }
          return t
        })
        .filter((t) => t.columns.length > 0)
    )
    setActiveProject(target.projectPath)
    setActiveTabId(target.id)
    updateSession(dragId, (x) => ({ ...x, unseen: false, status: x.status === 'waiting' ? 'idle' : x.status }))
    setTimeout(() => handles.current.get(dragId)?.focus(), 0)
  }

  const pickSkill = (sk: Skill): void => {
    if (!activeId) return
    window.orbit.sessionInput(activeId, sk.command + ' ')
    handles.current.get(activeId)?.focus()
  }

  // "Add to chat" from a file viewer: stage a `path:row` + raw-value reference in
  // the focused session's input (bracketed paste, never submitted), then focus it
  // so the user can write their question around it.
  const addRefToChat = (ref: ChatRef): void => {
    const target = activeIdRef.current
    const handle = target ? handles.current.get(target) : null
    if (!handle) return
    const root = activeProjectRef.current
    let rel = ref.path
    if (root && ref.path.startsWith(root)) rel = ref.path.slice(root.length).replace(/^[\\/]+/, '') || ref.path
    rel = rel.replace(/\\/g, '/')
    const loc = ref.startLine === ref.endLine ? `${rel}:${ref.startLine}` : `${rel}:${ref.startLine}-${ref.endLine}`
    // fence longer than any backtick run inside the selection, so code containing ``` survives
    let maxTicks = 0
    for (const run of ref.text.match(/`+/g) ?? []) maxTicks = Math.max(maxTicks, run.length)
    const fence = '`'.repeat(Math.max(3, maxTicks + 1))
    handle.paste(`${loc}\n${fence}\n${ref.text}\n${fence}\n`)
    handle.focus()
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
  // ordered recent files (most recent first), deduped — preserves Set insertion order
  const allRecentOrdered = Array.from(new Set(sessions.flatMap((s) => s.recentFiles)))
  const isLeased = (p: string): boolean =>
    !!activeProject && !!coord && coord.leases.some((l) => leaseCoversPath(l.resource, p, activeProject))
  const getLeasedBy = (p: string): string | null =>
    activeProject && coord
      ? (coord.leases.find((l) => leaseCoversPath(l.resource, p, activeProject))?.agent ?? null)
      : null
  const getBusyAgent = (p: string): string | null =>
    sessions.find((s) => s.busyFiles.includes(p))?.title ?? null
  // the windows the grid renders right now = the active tab's live windows
  const visibleEffective = liveWindows(activeTab, sessions)
  const layout = columnLayout(liveColumns(activeTab, sessions))
  const menuTab = tabMenu ? tabs.find((t) => t.id === tabMenu.id) ?? null : null

  return (
    <div
      className="app"
      onMouseDown={(e) => {
        const EDGE = 6
        const { clientX: x, clientY: y } = e
        const { innerWidth: w, innerHeight: h } = window
        if (x <= EDGE || y <= EDGE || x >= w - EDGE || y >= h - EDGE) {
          window.orbit.startWindowMove()
          return
        }
        // panel-head areas and collapsed col-strips are secondary drag handles
        const t = e.target as Element
        if (
          (t.closest('.panel-head') && !t.closest('button, .panel-head-toggle, .seg, .help-trigger')) ||
          t.closest('.col-strip')
        ) {
          window.orbit.startWindowMove()
        }
      }}
    >
      {/* single top bar: doubles as the window titlebar (native title/menu bars are hidden) */}
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
        dragWin={dragWin}
        onDropWindow={dropWindowOnTab}
      />
      <div className={`columns ${dragging ? 'resizing' : ''} ${vDragging ? 'vresizing' : ''}`}>
        {collapsed.left ? (
          <div
            className="col-strip left"
            onClick={() => toggleCollapse('left')}
            title="Expand panel"
          >
            ›
          </div>
        ) : (
          <>
        <aside className="col col-left" style={{ flex: `0 0 ${widths.left}px` }}>
          <div className="sect" style={{ flex: `${splits.left[0]} 1 0%` }}>
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
          </div>
          <div className="row-resizer" onMouseDown={startSectResize('left', 0)} title="Drag to resize" />
          <div className="sect" style={{ flex: `${splits.left[1]} 1 0%` }}>
            <SkillsPanel skills={skills} activeSkill={active?.activeSkill ?? null} onPick={pickSkill} />
          </div>
          <div className="row-resizer" onMouseDown={startSectResize('left', 1)} title="Drag to resize" />
          <div className="sect" style={{ flex: `${splits.left[2]} 1 0%` }}>
            <McpPanel
              servers={mcpServers}
              activeMcp={active?.mcpActive ?? []}
              onOpenFile={openFile}
            />
          </div>
        </aside>

        <div
          className={`col-resizer ${dragging === 'left' ? 'dragging' : ''}`}
          onMouseDown={startResize('left')}
          title="Drag to resize"
        >
          <button
            className="col-collapse"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => toggleCollapse('left')}
            title="Collapse panel"
          >
            ‹
          </button>
        </div>
          </>
        )}

        <main className="col col-center">
          <CommandBar commands={projectInfo.commands} onRun={runCommand} />
          <div className={`center-body ${openFiles.length > 0 ? 'split' : ''}`}>
          <div
            className="terminals"
            style={{
              gridTemplateColumns: gridTemplateColumns(layout.cols, activeTab?.colWeights),
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
                  onDragOver={(e) => {
                    if (!dragWin || dragWin === s.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const zone = zoneAt(e, e.currentTarget)
                    setDropHint((prev) =>
                      prev?.target === s.id && prev.zone === zone ? prev : { target: s.id, zone }
                    )
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDropHint((prev) => (prev?.target === s.id ? null : prev))
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropWindow(s.id, zoneAt(e, e.currentTarget))
                  }}
                >
                  <Pane
                    session={s}
                    active={s.id === activeId}
                    canRemove={visibleEffective.length > 1}
                    autoFocused={s.id === autoFocused}
                    draggable={visibleEffective.length > 1 || projectTabs.length > 1}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', s.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragWin(s.id)
                    }}
                    onDragEnd={() => {
                      setDragWin(null)
                      setDropHint(null)
                    }}
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
                      quickPrompts={projectInfo.prompts}
                      onTitle={(t) => retitleFromTerminal(s.id, t)}
                    />
                  </Pane>
                  {dropHint?.target === s.id && dragWin && dragWin !== s.id && (
                    <div className={`drop-zone drop-${dropHint.zone}`} />
                  )}
                </div>
              )
            })}
          </div>
          {openFiles.length > 0 && (
            <div className="editor-dock" style={{ flex: `0 0 ${editorWidth}px` }}>
              <div className="editor-resizer" onMouseDown={startEditorResize} />
              <div className="editor-tab-bar">
                {openFiles.map((p) => (
                  <button
                    key={p}
                    className={`editor-tab${p === activeFilePath ? ' active' : ''}${dirtyFiles.has(p) ? ' dirty' : ''}`}
                    draggable
                    onDragStart={(e) => startPathDrag(e, p)}
                    onClick={() => setActiveFilePath(p)}
                    onContextMenu={(e) => { e.preventDefault(); setFileTabMenu({ path: p, x: e.clientX, y: e.clientY }) }}
                  >
                    {dirtyFiles.has(p) && <span className="tab-dot">*</span>}
                    {p.split(/[\\/]/).pop() || p}
                    <span
                      className="tab-close"
                      onClick={(e) => { e.stopPropagation(); handleTabClose(p) }}
                    >×</span>
                  </button>
                ))}
                <button
                  className={`editor-tab-help-btn${showEditorHelp ? ' on' : ''}`}
                  onClick={() => setShowEditorHelp((v) => !v)}
                  title="Supported file types &amp; features"
                >?</button>
              </div>
              <div className="editor-instances">
                {openFiles.map((p) => (
                  <div
                    key={p}
                    className="editor-instance"
                    style={{ display: p === activeFilePath ? 'flex' : 'none' }}
                  >
                    <EditorModal
                      path={p}
                      busy={allBusy.has(p)}
                      leasedBy={getLeasedBy(p)}
                      autoSave={config?.autoSave ?? false}
                      autoSaveDelay={config?.autoSaveDelay ?? 1000}
                      shouldConfirmClose={closeRequestedFor === p}
                      onConfirmCloseHandled={() => setCloseRequestedFor(null)}
                      onDirtyChange={(isDirty) =>
                        setDirtyFiles((prev) => {
                          const n = new Set(prev)
                          if (isDirty) n.add(p)
                          else n.delete(p)
                          return n
                        })
                      }
                      onClose={() => closeFile(p)}
                      onAddToChat={addRefToChat}
                    />
                  </div>
                ))}
              </div>
              {showEditorHelp && <FileTypesHelp onClose={() => setShowEditorHelp(false)} />}
            </div>
          )}
          </div>
        </main>

        {collapsed.right ? (
          <div
            className="col-strip right"
            onClick={() => toggleCollapse('right')}
            title="Expand panel"
          >
            ‹
          </div>
        ) : (
          <>
        <div
          className={`col-resizer ${dragging === 'right' ? 'dragging' : ''}`}
          onMouseDown={startResize('right')}
          title="Drag to resize"
        >
          <button
            className="col-collapse"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => toggleCollapse('right')}
            title="Collapse panel"
          >
            ›
          </button>
        </div>

        <aside className="col col-right" style={{ flex: `0 0 ${widths.right}px` }}>
          <SkillHud session={active} />
          <div
            className="panel right-top"
            style={{ flex: actCollapsed ? '1 1 auto' : `${splits.right[0]} 1 0%` }}
          >
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
              <span className="rt-help">
                {rightView === 'coord' && (
                  <HelpPopup
                    title="Coordination"
                    snippet={
                      '{\n  "coordination": {\n    "leaseDir": ".claude/leases",\n    "wipFile": "WIP.md",\n    "wipSection": "Active"\n  }\n}'
                    }
                  >
                    Reads agent leases from <code>.claude/leases/*.lease.json</code>, the{' '}
                    <code>WIP.md</code> Active section, and a takeovers log — all overridable via{' '}
                    <code>.orbit.json</code> <code>coordination</code>.
                  </HelpPopup>
                )}
                {rightView === 'logs' && (
                  <HelpPopup
                    title="Logs"
                    snippet={'{\n  "logDirs": ["PlayLogs", "logs", "Logs"]\n}'}
                  >
                    Scans <code>logDirs</code> for the newest <code>*.log</code> file; uses the global
                    default from settings unless a project overrides it via <code>.orbit.json</code>.
                  </HelpPopup>
                )}
              </span>
            </div>
            {(rightView === 'context' || rightView === 'files') && (
              <DocsStrip docs={keyDocs} onOpen={openFile} />
            )}
            <div className="rt-body">
              {rightView === 'context' && (
                <ContextPanel
                  tree={active?.context ?? []}
                  busy={allBusy}
                  recent={allRecent}
                  active={!!active}
                  isLeased={isLeased}
                  onOpenFile={openFile}
                />
              )}
              {rightView === 'files' && (
                <FileTree
                  key={activeProject ?? 'none'}
                  root={activeProject}
                  busy={allBusy}
                  recent={allRecent}
                  recentOrdered={allRecentOrdered}
                  gitChanged={gitChanged}
                  isLeased={isLeased}
                  getLeasedBy={getLeasedBy}
                  getBusyAgent={getBusyAgent}
                  onOpenFile={openFile}
                  keyDocs={keyDocs}
                />
              )}
              {rightView === 'coord' && <CoordPanel coord={coord} />}
              {rightView === 'logs' && <LogPanel log={log} />}
            </div>
          </div>
          {!actCollapsed && (
            <div className="row-resizer" onMouseDown={startSectResize('right', 0)} title="Drag to resize" />
          )}
          {actCollapsed ? (
            <div className="panel activity-wrap collapsed">
              <button
                className="panel-head act-collapsed-head"
                onClick={() => setActCollapsed(false)}
                title="Expand activity"
              >
                <span>▸ ACTIVITY</span>
                {(() => {
                  const running = (active?.subagents ?? []).filter((s) => s.status === 'running').length
                  return running > 0 ? <span className="panel-head-sub">{running} running</span> : null
                })()}
              </button>
            </div>
          ) : (
            <div className="panel activity-wrap" style={{ flex: `${splits.right[1]} 1 0%` }}>
              <SubAgents items={active?.subagents ?? []} />
              <Activity items={active?.activity ?? []} onCollapse={() => setActCollapsed(true)} />
            </div>
          )}
        </aside>
          </>
        )}
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
                void window.orbit.openInExplorer(projMenu.path)
                setProjMenu(null)
              }}
            >
              {window.orbit.platform === 'darwin' ? '🔍 Reveal in Finder' : '📂 Open in Explorer'}
            </div>
            <div className="dropdown-separator" />
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
            {tabs.some((t) => t.projectPath === projMenu.path) && (
              <>
                <div className="dropdown-separator" />
                <div
                  className="dropdown-item danger"
                  onClick={() => {
                    closeProject(projMenu.path)
                    setProjMenu(null)
                  }}
                >
                  Close project
                </div>
              </>
            )}
          </div>
        </>
      )}

      {fileTabMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setFileTabMenu(null)} />
          <div className="context-menu" style={{ left: fileTabMenu.x, top: fileTabMenu.y }}>
            <div
              className="dropdown-item"
              onClick={() => {
                void window.orbit.openInExplorer(fileTabMenu.path)
                setFileTabMenu(null)
              }}
            >
              {window.orbit.platform === 'darwin' ? '🔍 Reveal in Finder' : '📂 Open in Explorer'}
            </div>
            <div className="dropdown-separator" />
            <div
              className="dropdown-item danger"
              onClick={() => {
                handleTabClose(fileTabMenu.path)
                setFileTabMenu(null)
              }}
            >
              Close tab
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

    </div>
  )
}
