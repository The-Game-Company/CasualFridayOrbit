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
  /** Which shell to run in. Windows: powershell/cmd; macOS/Linux: zsh/bash. If the named
   *  shell doesn't exist on the host platform, Orbit falls back to that platform's default. */
  shell?: ShellKind
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

/**
 * An MCP (Model Context Protocol) server configured for a project.
 *
 * Scope mirrors Claude Code's own model:
 *  - `user`    — defined in the top-level `mcpServers` of ~/.claude.json; available everywhere.
 *  - `local`   — defined under `projects[path].mcpServers` in ~/.claude.json; private to this project.
 *  - `project` — defined in a `.mcp.json` file checked into the repo; shared with the team.
 */
export interface McpServer {
  name: string
  scope: 'user' | 'local' | 'project'
  /** stdio (command/args) or a remote transport (url). */
  transport: 'stdio' | 'sse' | 'http'
  /** stdio launcher, e.g. "uv" / "npx". */
  command?: string
  args?: string[]
  /** remote endpoint for sse/http servers. */
  url?: string
  /** env var names declared for the server (values omitted — may hold secrets). */
  envKeys?: string[]
  /** absolute path of the file that defines this server (opened by the editor). */
  configPath: string
  /** false only when explicitly turned off (a `.mcp.json` server the user disabled). */
  enabled: boolean
}

/** Outcome of restarting an MCP server (killing its stdio OS processes so claude respawns it). */
export interface McpRestartResult {
  ok: boolean
  killed: number
  error?: string
}

/** Raw hook event forwarded from claude's hooks -> local server -> renderer. */
export interface HookEvent {
  /** Which claude session this event belongs to. */
  sessionId: string
  /** PreToolUse | PostToolUse | UserPromptSubmit | SessionStart | Stop | Notification */
  event: string
  /** live reasoning effort of the session (from CLAUDE_EFFORT), if claude exposed it */
  effort?: string
  ts: number
  /** The JSON payload claude passed to the hook on stdin. */
  data: any
}

export type ThemeName =
  | 'tokyo-night'
  | 'black'
  | 'github-dark'
  | 'gruvbox'
  | 'nord'
  | 'dracula'
  | 'light'
  | 'solarized-light'

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
  /** user-defined ordering of top-level projects (paths); unknown ones sort to the end */
  projectOrder: string[]
  /** folder names the LOGS tab scans for the newest *.log (per-project, generic) */
  logDirs: string[]
  /** a coordination lease is shown as "stale" once older than this many minutes */
  leaseStaleMin: number
  /** width (px) of the left projects/skills column — drag the divider to resize */
  leftWidth: number
  /** width (px) of the right context/activity column — drag the divider to resize */
  rightWidth: number
  /** auto-jump to a session that just finished and wants input, but only while the session
   *  you're looking at is busy (so you're never yanked away mid-read/type) */
  autoFocus: boolean
}

/** Plain (non-claude) shells Orbit can host. Windows: powershell/cmd; macOS/Linux: zsh/bash. */
export type ShellKind = 'powershell' | 'cmd' | 'zsh' | 'bash'

/** What runs inside a session's terminal. */
export type TermKind = 'claude' | ShellKind

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
  /** UI appearance, so claude's TUI theme matches Orbit's (light diffs in light mode) */
  appearance?: 'dark' | 'light'
}

/** Result of checking whether the installed Claude Code can be upgraded. */
export interface UpdateStatus {
  /** how Claude Code was installed — decides which upgrade command we run */
  installMethod: 'winget' | 'native'
  /** version currently installed (from `claude --version`), or null if it couldn't be read */
  current: string | null
  /** newest version offered by the install source, or null if it couldn't be read */
  latest: string | null
  updateAvailable: boolean
  /** count of claude.exe processes running outside Orbit (they lock the binary during upgrade) */
  externalProcesses: number
  /** the Claude Code version Orbit was built/tested against (baked in at build time), or null */
  builtAgainst: string | null
  /** true when `latest` is newer than `builtAgainst` — i.e. updating enters untested territory */
  latestUntested: boolean
}

/** Outcome of running the upgrade. `output` is the tail of the command's stdout/stderr. */
export interface UpdateResult {
  ok: boolean
  output: string
}

/** A live progress tick streamed from the running upgrade command. */
export interface UpdateProgress {
  /** the latest meaningful line of tool output (carriage-return redraws collapsed) */
  line: string
  /** 0–100 if a percentage could be parsed from the output, else null (show as indeterminate) */
  pct: number | null
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
  /** most recent user prompt, so the pinned-prompt bar can show it after a restore */
  lastPrompt?: string
}

/**
 * A persisted tab: an ordered group of windows (sessions) shown together, belonging to one
 * project. A tab always has >=1 window; splitting adds a window, closing the last one closes
 * the tab. This is the hierarchy the UI restores on launch.
 */
export interface PersistedTab {
  id: string
  projectPath: string
  /** columns left→right; each a vertical stack of session ids top→bottom */
  columns: string[][]
  /** per-column relative widths (fr units), one per live column; omit/empty means equal widths */
  colWeights?: number[]
  /** which window is focused within the tab */
  activeWindow: string | null
  /** @deprecated pre-column flat window list — read only to migrate old workspaces. */
  windows?: string[]
}

/** The whole app workspace we persist so it can be restored after exit/crash. */
export interface WorkspaceState {
  sessions: PersistedSession[]
  /** tabs (each owns its windows). Replaces the old flat panesByProject map. */
  tabs: PersistedTab[]
  activeProject: string | null
  activeTabId: string | null
  /** @deprecated legacy pre-hierarchy fields — read only to migrate old workspaces. */
  panesByProject?: Record<string, string[]>
  /** @deprecated legacy focused-session id — used only to seed activeTabId on migration. */
  activeId?: string | null
}

/** IPC channel names (main <-> renderer). */
export const IPC = {
  // queries (invoke)
  ProjectList: 'project:list',
  SkillsList: 'skills:list',
  McpList: 'mcp:list',
  McpRestart: 'mcp:restart',
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',
  PickFolder: 'dialog:pickFolder',
  ContextRead: 'context:read',
  HistoryList: 'history:list',
  WorkspaceLoad: 'workspace:load',
  WorkspaceSave: 'workspace:save',
  UpdateCheck: 'update:check',
  UpdateRun: 'update:run',
  UpdateCloseExternal: 'update:closeExternal',
  AppRelaunch: 'app:relaunch',
  AppRebuild: 'app:rebuild',
  ReadDir: 'files:readDir',
  ReadTextFile: 'files:readText',
  SaveTextFile: 'files:saveText',
  ClipboardRead: 'clipboard:read',
  ClipboardWriteText: 'clipboard:writeText',
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
  MenuCommand: 'menu:command',
  SessionData: 'session:data',
  SessionExit: 'session:exit',
  HookEvent: 'hook:event',
  ContextTree: 'context:tree',
  ProjectsChanged: 'project:changed',
  UpdateProgress: 'update:progress'
} as const
