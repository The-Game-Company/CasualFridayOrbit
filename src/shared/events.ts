// Shared types used across main / preload / renderer.

/** A project the user can open a claude session in. */
export interface Project {
  name: string
  path: string
  /** declared/auto-detected workspace members (monorepo), each a full project */
  subprojects?: Project[]
}

/** A project-declared quick command (rendered in the command bar). */
export interface OrbitCommand {
  label: string
  run: string
  shell?: 'powershell' | 'cmd'
}

/** Project-declared UI metadata surfaced by Orbit. */
export interface ProjectInfo {
  commands: OrbitCommand[]
  accent: string | null
}

/** A node in the context-files tree (CLAUDE.md, .claude/**, etc.). */
export interface ContextNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: ContextNode[]
}

/** A single entry when lazily listing a directory in the project file browser. */
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
}

/** Result of reading a text file for editing. */
export interface ReadFileResult {
  ok: boolean
  content?: string
  hash?: string
  mtimeMs?: number
  size?: number
  binary?: boolean
  tooLarge?: boolean
  missing?: boolean
  error?: string
}

/** Result of attempting to save. `conflict` => disk changed since the baseline. */
export interface SaveResult {
  ok: boolean
  conflict?: boolean
  hash?: string
  mtimeMs?: number
  error?: string
}

/** Pushed when a file currently open in the editor changes on disk. */
export interface ExternalChange {
  path: string
  deleted?: boolean
  content?: string
  hash?: string
  mtimeMs?: number
}

/** A held file/resource lease (parsed from .claude/leases/*.lease.json). */
export interface Lease {
  resource: string
  agent: string
  intent: string
  acquired: string
  heartbeat: string
  ageSec: number
  expirySec: number
  stale: boolean
}

/** A narrative WIP.md Active entry. */
export interface WipEntry {
  agent: string
  title: string
  started?: string
  scope?: string
  leases?: string
  status?: string
  initiative?: string
}

/** Parallel-agent coordination snapshot for a project. */
export interface CoordState {
  projectPath: string
  leases: Lease[]
  wip: WipEntry[]
  takeovers: string[]
}

/** A pinned "always-on" doc that exists in a project. */
export interface KeyDoc {
  name: string
  path: string
  mtimeMs: number
}

/** Tail of the newest log file for a project. */
export interface LogState {
  projectPath: string
  path: string | null
  content: string
}

/** A discoverable skill (project- or user-level). */
export interface Skill {
  name: string
  description: string
  source: 'project' | 'user'
  /** Slash command to insert, e.g. "/my-skill". */
  command: string
}

/** Raw hook event forwarded from claude's hooks -> local server -> renderer. */
export interface HookEvent {
  /** Which claude session this event belongs to. */
  sessionId: string
  /** PreToolUse | PostToolUse | UserPromptSubmit | SessionStart | Stop | Notification */
  event: string
  ts: number
  /** The JSON payload claude passed to the hook on stdin. */
  data: any
}

export type ThemeName = 'tokyo-night' | 'github-dark' | 'gruvbox'

export interface AppConfig {
  projectRoot: string
  theme: ThemeName
  fontSize: number
  /** master switch: reopen the previous workspace on launch */
  restoreOnLaunch: boolean
  /** project paths that should always start empty on launch (per-project override) */
  restoreExclude: string[]
  /** project paths hidden from the Projects panel (irrelevant/idle ones) */
  hidden: string[]
  /** folder names the LOGS tab scans for the newest *.log (per-project, generic) */
  logDirs: string[]
  /** a coordination lease is shown as "stale" once older than this many minutes */
  leaseStaleMin: number
}

/** What runs inside a session's terminal. */
export type TermKind = 'claude' | 'powershell' | 'cmd'

/** Options for creating a new session. */
export interface CreateSessionArgs {
  sessionId: string
  projectPath: string
  kind: TermKind
  cols: number
  rows: number
  /** Pass --continue to resume the most recent conversation in that dir (claude only). */
  continueLast?: boolean
  /** Resume a specific past claude session by its real session id (claude only). */
  resumeId?: string
  /** a command written to the terminal once after spawn (used by the command bar) */
  startupCommand?: string
}

/** A past claude conversation found on disk (a transcript). */
export interface HistoryEntry {
  sessionId: string
  title: string
  updatedAt: number
}

/** The minimal, restartable description of a session we persist to disk. */
export interface PersistedSession {
  id: string
  projectPath: string
  projectName: string
  kind: TermKind
  title: string
  /** real claude session id, captured from hooks; used to --resume on next boot */
  resumeId?: string
}

/** The whole app workspace we persist so it can be restored after exit/crash. */
export interface WorkspaceState {
  sessions: PersistedSession[]
  panesByProject: Record<string, string[]>
  activeProject: string | null
  activeId: string | null
}

/** IPC channel names (main <-> renderer). */
export const IPC = {
  // queries (invoke)
  ProjectList: 'project:list',
  SkillsList: 'skills:list',
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',
  PickFolder: 'dialog:pickFolder',
  ContextRead: 'context:read',
  HistoryList: 'history:list',
  WorkspaceLoad: 'workspace:load',
  WorkspaceSave: 'workspace:save',
  ReadDir: 'files:readDir',
  ReadTextFile: 'files:readText',
  SaveTextFile: 'files:saveText',
  SaveClipboardImage: 'clipboard:saveImage',
  WatchFile: 'files:watch',
  UnwatchFile: 'files:unwatch',
  FileExternalChange: 'files:externalChange',
  CoordWatch: 'coord:watch',
  CoordUpdate: 'coord:update',
  KeyDocs: 'docs:key',
  ProjectInfo: 'project:info',
  LogWatch: 'log:watch',
  LogUnwatch: 'log:unwatch',
  LogUpdate: 'log:update',
  // session control
  SessionCreate: 'session:create',
  SessionClose: 'session:close',
  SessionInput: 'session:input',
  SessionResize: 'session:resize',
  // push (main -> renderer)
  SessionData: 'session:data',
  SessionExit: 'session:exit',
  HookEvent: 'hook:event',
  ContextTree: 'context:tree'
} as const
