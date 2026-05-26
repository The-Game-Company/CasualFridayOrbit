import type { ContextNode, HookEvent, TermKind } from '../../shared/events'

export type ActivityKind = 'skill' | 'agent' | 'tool' | 'prompt' | 'session' | 'stop' | 'notify'

export interface ActivityItem {
  id: number
  ts: number
  kind: ActivityKind
  icon: string
  label: string
  detail: string
}

export type SessionStatus = 'idle' | 'busy' | 'waiting'

/** A subagent dispatched by this session via the Task tool. */
export interface SubAgent {
  key: number
  type: string
  description: string
  status: 'running' | 'done'
  ts: number
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
  /** skill currently running, if any */
  activeSkill: string | null
  /** files with an in-flight Edit/Write/Read */
  busyFiles: string[]
  /** recently touched files (most recent first) */
  recentFiles: string[]
  /** subagents dispatched this session (running + recently done) */
  subagents: SubAgent[]
  /** something happened while this tab wasn't focused */
  unseen: boolean
  exited: boolean
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
    busyFiles: [],
    recentFiles: [],
    subagents: [],
    unseen: false,
    exited: false,
    activity: [],
    context: []
  }
}

let activityId = 1
let subKey = 1
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

  switch (evt.event) {
    case 'UserPromptSubmit':
      next.status = 'busy'
      next.unseen = false
      break
    case 'PreToolUse': {
      const tool = d.tool_name
      next.status = 'busy'
      next.toolsActive = s.toolsActive + 1
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
      if (tool === 'Skill') next.activeSkill = skillName(d.tool_input)
      const f = fileOf(tool, d.tool_input)
      if (f) next.busyFiles = uniq([...s.busyFiles, f])
      break
    }
    case 'PostToolUse': {
      const tool = d.tool_name
      next.toolsActive = Math.max(0, s.toolsActive - 1)
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
      if (tool === 'Skill') next.activeSkill = null
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
      next.agentsActive = 0
      next.toolsActive = 0
      next.busyFiles = []
      next.activeSkill = null
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
      break
  }

  const item = summarize(evt)
  if (item) next.activity = [item, ...s.activity].slice(0, 300)
  return next
}
