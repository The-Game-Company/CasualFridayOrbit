import type { ContextNode, HookEvent, TermKind } from '../../shared/events'

export type ActivityKind =
  | 'skill'
  | 'mcp'
  | 'agent'
  | 'tool'
  | 'prompt'
  | 'session'
  | 'stop'
  | 'notify'

export interface ActivityItem {
  id: number
  ts: number
  kind: ActivityKind
  icon: string
  label: string
  detail: string
}

export type SessionStatus = 'idle' | 'busy' | 'waiting'

/**
 * A tab: a tiled group of windows (sessions) belonging to one project. The layout is stored
 * explicitly as `columns` (left→right), each a vertical stack of window ids (top→bottom) —
 * so splitting adds a window into the active window's column and closing one only shrinks (or
 * drops) that column, never reflowing windows across columns. A tab always has >=1 window and
 * closes when its last window closes. (This replaces the old per-project "split set" overlay.)
 */
export interface Tab {
  id: string
  projectPath: string
  /** columns left→right; each column is a vertical stack of session ids top→bottom */
  columns: string[][]
  /**
   * Per-column relative widths (left→right), one weight per live column, used as `fr` units.
   * Undefined/missing means equal widths (the default and only legacy behavior). Reset to equal
   * whenever the column count changes (split/close) so weights never go stale against `columns`.
   */
  colWeights?: number[]
  /** the focused window within this tab (always one of the ids in `columns`) */
  activeWindow: string
}

/** Flat list of a tab's window ids, in reading order (left→right, top→bottom). */
export function tabWindows(tab: Tab | null | undefined): string[] {
  return tab ? tab.columns.flat() : []
}

/** A subagent dispatched by this session via the Task tool. */
export interface SubAgent {
  key: number
  type: string
  description: string
  status: 'running' | 'done'
  ts: number
}

/** One step of the agent's live plan (from the TodoWrite tool) — the "road". */
export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** present-tense label TodoWrite supplies for the in-progress step */
  activeForm?: string
}

/** One run of a skill this session — the trail of skills the agent moved through. */
export interface SkillRun {
  key: number
  name: string
  startedAt: number
  endedAt: number | null
}

/** Everything the UI needs to react to one live claude session. */
export interface SessionState {
  id: string
  projectPath: string
  projectName: string
  kind: TermKind
  title: string
  /** real claude session id (from hooks), used to --resume across restarts */
  resumeId?: string
  /** command typed once at spawn (command-bar sessions) */
  startupCommand?: string
  status: SessionStatus
  /** in-flight subagent (Task) count */
  agentsActive: number
  /** in-flight tool calls */
  toolsActive: number
  /** skill currently running, if any (stays set until the turn ends or another takes over) */
  activeSkill: string | null
  /** when the current skill started (for the live elapsed timer) */
  skillStartedAt: number | null
  /** ordered trail of skills entered this turn/session (skill -> skill transitions) */
  skillRuns: SkillRun[]
  /** names of MCP servers whose tools were used this turn (cleared on Stop) — drives the "live" dot */
  mcpActive: string[]
  /** the agent's live plan from TodoWrite — rendered as the skill "road" */
  todos: Todo[]
  /** files with an in-flight Edit/Write/Read */
  busyFiles: string[]
  /** recently touched files (most recent first) */
  recentFiles: string[]
  /** subagents dispatched this session (running + recently done) */
  subagents: SubAgent[]
  /** live reasoning effort (low/medium/high/xhigh…) reported by the session, or null if unknown */
  effort: string | null
  /** something happened while this tab wasn't focused */
  unseen: boolean
  /** the session is mid-turn but blocked on the user (AskUserQuestion / plan approval) — it
   *  reads as "busy" yet the user is actively engaged, so auto-focus must not jump away from it */
  awaitingInput: boolean
  exited: boolean
  /** most recent user prompt text + when it was submitted (drives the pinned-prompt bar) */
  lastPrompt: string
  lastPromptTs: number
  activity: ActivityItem[]
  context: ContextNode[]
}

export function initSession(
  id: string,
  projectPath: string,
  projectName: string,
  kind: TermKind,
  title: string,
  resumeId?: string,
  startupCommand?: string
): SessionState {
  return {
    id,
    projectPath,
    projectName,
    kind,
    title,
    resumeId,
    startupCommand,
    status: 'idle',
    agentsActive: 0,
    toolsActive: 0,
    activeSkill: null,
    skillStartedAt: null,
    skillRuns: [],
    mcpActive: [],
    todos: [],
    busyFiles: [],
    recentFiles: [],
    subagents: [],
    effort: null,
    unseen: false,
    awaitingInput: false,
    exited: false,
    lastPrompt: '',
    lastPromptTs: 0,
    activity: [],
    context: []
  }
}

let activityId = 1
let subKey = 1
let skillRunKey = 1
const uniq = (arr: string[]): string[] => Array.from(new Set(arr))

function fileOf(tool: string, input: any): string | null {
  if (!input) return null
  if (tool === 'Edit' || tool === 'Write' || tool === 'Read' || tool === 'NotebookEdit') {
    return typeof input.file_path === 'string' ? input.file_path : null
  }
  return null
}

function trunc(s: unknown, n = 90): string {
  const str = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s)
  const oneLine = str.replace(/\s+/g, ' ').trim()
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine
}

function toolDetail(tool: string, input: any): string {
  if (!input) return ''
  switch (tool) {
    case 'Bash':
      return trunc(input.command)
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return trunc(input.file_path)
    case 'Glob':
    case 'Grep':
      return trunc(input.pattern)
    case 'Task':
    case 'Agent':
      return trunc(input.description ?? input.prompt)
    default:
      return trunc(input)
  }
}

/** MCP tools are named `mcp__<server>__<tool>`; pull the server name out, or null if not an MCP tool. */
function mcpServerOf(tool: unknown): string | null {
  if (typeof tool !== 'string' || !tool.startsWith('mcp__')) return null
  const rest = tool.slice(5)
  const i = rest.indexOf('__')
  const name = i === -1 ? rest : rest.slice(0, i)
  return name || null
}

function skillName(input: any): string {
  return String(input?.skill ?? input?.skill_name ?? input?.name ?? input?.command ?? '?')
}

/** Build a feed item for an event, or null to drop it from the feed. */
export function summarize(evt: HookEvent): ActivityItem | null {
  const d = evt.data ?? {}
  const base = { id: activityId++, ts: evt.ts }
  switch (evt.event) {
    case 'PreToolUse': {
      const tool = d.tool_name ?? 'tool'
      if (tool === 'Skill')
        return { ...base, kind: 'skill', icon: '✦', label: 'Skill', detail: skillName(d.tool_input) }
      if (tool === 'Task' || tool === 'Agent')
        return { ...base, kind: 'agent', icon: '⬡', label: 'Agent', detail: toolDetail(tool, d.tool_input) }
      const mcp = mcpServerOf(tool)
      if (mcp) {
        // mcp__<server>__<sub-tool> — surface the server (what it connected to) + the call
        const sub = String(tool).slice('mcp__'.length + mcp.length + '__'.length)
        return { ...base, kind: 'mcp', icon: '⧉', label: mcp, detail: sub || toolDetail(tool, d.tool_input) }
      }
      return { ...base, kind: 'tool', icon: '⏵', label: tool, detail: toolDetail(tool, d.tool_input) }
    }
    case 'UserPromptSubmit':
      return { ...base, kind: 'prompt', icon: '❯', label: 'You', detail: trunc(d.prompt) }
    case 'SessionStart':
      return { ...base, kind: 'session', icon: '◆', label: 'Session', detail: String(d.source ?? '') }
    case 'Stop':
      return { ...base, kind: 'stop', icon: '✓', label: 'Turn complete', detail: '' }
    case 'Notification':
      return { ...base, kind: 'notify', icon: '●', label: 'Notification', detail: trunc(d.message) }
    default:
      return null // drop PostToolUse etc. from the visible feed
  }
}

/**
 * Pure reducer: fold one hook event into a session's reactive state.
 * `focused` = whether this session's tab is currently the active one.
 */
export function applyEvent(s: SessionState, evt: HookEvent, focused: boolean): SessionState {
  const d = evt.data ?? {}
  const next: SessionState = { ...s }

  // Capture the real claude session id (stable across resumes) for later --resume.
  if (typeof d.session_id === 'string' && d.session_id) next.resumeId = d.session_id
  // Track the live reasoning effort (every hook carries it; updates if changed mid-session).
  if (evt.effort) next.effort = evt.effort

  switch (evt.event) {
    case 'UserPromptSubmit':
      next.status = 'busy'
      next.unseen = false
      next.awaitingInput = false
      next.lastPrompt = typeof d.prompt === 'string' ? d.prompt : ''
      next.lastPromptTs = evt.ts
      break
    case 'PreToolUse': {
      const tool = d.tool_name
      next.status = 'busy'
      next.toolsActive = s.toolsActive + 1
      // interactive tools block the turn on the user — keep the user here, don't auto-focus away
      if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') next.awaitingInput = true
      if (tool === 'Task' || tool === 'Agent') {
        next.agentsActive = s.agentsActive + 1
        const sub: SubAgent = {
          key: subKey++,
          type: String(d.tool_input?.subagent_type ?? d.tool_input?.agent ?? 'agent'),
          description: String(d.tool_input?.description ?? d.tool_input?.prompt ?? '').slice(0, 120),
          status: 'running',
          ts: evt.ts
        }
        next.subagents = [sub, ...s.subagents].slice(0, 24)
      }
      if (tool === 'Skill') {
        // A skill stays "active" from invocation until the turn ends (Stop) or another skill
        // takes over — the Skill tool's PostToolUse fires when the skill is *loaded*, not when
        // its work finishes, so we deliberately don't clear on PostToolUse. Record the trail.
        const name = skillName(d.tool_input)
        const runs = s.skillRuns.map((r) => (r.endedAt === null ? { ...r, endedAt: evt.ts } : r))
        runs.push({ key: skillRunKey++, name, startedAt: evt.ts, endedAt: null })
        next.skillRuns = runs.slice(-12)
        next.activeSkill = name
        next.skillStartedAt = evt.ts
      }
      const mcp = mcpServerOf(tool)
      if (mcp) next.mcpActive = uniq([...s.mcpActive, mcp])
      const f = fileOf(tool, d.tool_input)
      if (f) next.busyFiles = uniq([...s.busyFiles, f])
      break
    }
    case 'PostToolUse': {
      const tool = d.tool_name
      next.toolsActive = Math.max(0, s.toolsActive - 1)
      // the user answered the question / approved the plan — they're free to be moved again
      if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') next.awaitingInput = false
      if (tool === 'Task' || tool === 'Agent') {
        next.agentsActive = Math.max(0, s.agentsActive - 1)
        // mark the most recent running subagent of this type (or any) as done
        const wantType = String(d.tool_input?.subagent_type ?? d.tool_input?.agent ?? '')
        let marked = false
        next.subagents = s.subagents.map((sa) => {
          if (!marked && sa.status === 'running' && (!wantType || sa.type === wantType)) {
            marked = true
            return { ...sa, status: 'done' as const }
          }
          return sa
        })
      }
      // NOTE: intentionally do NOT clear activeSkill here (see PreToolUse Skill above).
      const f = fileOf(tool, d.tool_input)
      if (f) {
        next.busyFiles = s.busyFiles.filter((x) => x !== f)
        next.recentFiles = uniq([f, ...s.recentFiles]).slice(0, 10)
      }
      break
    }
    case 'Stop':
      // turn complete -> reset in-flight counters; flag for attention if not focused
      next.status = focused ? 'idle' : 'waiting'
      next.unseen = focused ? false : true
      next.awaitingInput = false
      next.agentsActive = 0
      next.toolsActive = 0
      next.busyFiles = []
      next.activeSkill = null
      next.skillStartedAt = null
      next.mcpActive = []
      next.skillRuns = s.skillRuns.map((r) => (r.endedAt === null ? { ...r, endedAt: evt.ts } : r))
      next.subagents = s.subagents.map((sa) => (sa.status === 'running' ? { ...sa, status: 'done' as const } : sa))
      break
    case 'Notification':
      if (!focused) {
        next.unseen = true
        if (next.status !== 'busy') next.status = 'waiting'
      }
      break
    case 'SessionStart':
      next.status = 'idle'
      next.awaitingInput = false
      break
  }

  // The agent's live plan: TodoWrite carries the full todo list on both Pre/PostToolUse.
  // This is the dynamically-executed "road" — pending → in_progress → completed.
  if ((evt.event === 'PreToolUse' || evt.event === 'PostToolUse') && d.tool_name === 'TodoWrite') {
    const list = d.tool_input?.todos
    if (Array.isArray(list)) {
      next.todos = list
        .map((t: any) => ({
          content: String(t.content ?? t.activeForm ?? ''),
          status: t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending',
          activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined
        }))
        .slice(0, 40)
    }
  }

  const item = summarize(evt)
  if (item) next.activity = [item, ...s.activity].slice(0, 300)
  return next
}
