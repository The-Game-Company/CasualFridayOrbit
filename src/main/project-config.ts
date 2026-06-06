import fs from 'node:fs'
import path from 'node:path'
import type { ShellKind } from '../shared/events'

/**
 * How Orbit should read a project's coordination state. A project can override any of
 * this by dropping a `.orbit.json` at its root — Orbit never hardcodes one project's
 * format, it reads the project's own declaration (falling back to these defaults).
 */
export interface CoordAdapter {
  /** dir (relative to project) holding lease files */
  leaseDir: string
  /** glob for lease files inside leaseDir (only `*` supported) */
  leaseGlob: string
  /** map Orbit's fields <- candidate JSON keys (first present wins) */
  leaseFields: {
    resource: string[]
    agent: string[]
    intent: string[]
    acquired: string[]
    heartbeat: string[]
  }
  /** path (relative to project) to a plaintext takeovers log, or '' to disable */
  takeoversLog: string
  /** markdown file holding the narrative work registry */
  wipFile: string
  /** the `## <section>` heading whose `### entries` are parsed */
  wipSection: string
}

export interface OrbitCommand {
  label: string
  run: string
  shell?: ShellKind
}

const SHELL_KINDS: ReadonlySet<ShellKind> = new Set(['powershell', 'cmd', 'zsh', 'bash'])

export interface QuickPrompt {
  label: string
  prompt: string
}

export interface SubProjectDecl {
  name: string
  path: string
}

export interface ProjectConfig {
  coordination: CoordAdapter
  /** optional per-project override of the LOGS-tab scan folders */
  logDirs?: string[]
  /** quick-command buttons surfaced in the command bar */
  commands: OrbitCommand[]
  /** quick-prompt buttons overlaid on the focused claude window (insert + submit) */
  prompts: QuickPrompt[]
  /** accent color (hex) to color-code this project across the UI */
  accent: string | null
  /** explicit always-on docs list (overrides the built-in pinned-docs set) */
  docs: string[] | null
  /** declared workspace members (monorepo) */
  subprojects: SubProjectDecl[]
}

const DEFAULT_COORD: CoordAdapter = {
  leaseDir: '.claude/leases',
  leaseGlob: '*.lease.json',
  leaseFields: {
    resource: ['resource', 'id', 'path'],
    agent: ['agent', 'owner', 'holder'],
    intent: ['intent', 'reason', 'note'],
    acquired: ['acquired', 'acquiredAt', 'created'],
    heartbeat: ['heartbeat', 'heartbeatAt', 'updated', 'acquired']
  },
  takeoversLog: '.claude/leases/takeovers.log',
  wipFile: 'WIP.md',
  wipSection: 'Active'
}

export const PROJECT_CONFIG_FILE = '.orbit.json'

/** Read + merge a project's `.orbit.json` over the built-in defaults. */
export function readProjectConfig(projectPath: string): ProjectConfig {
  let raw: any = {}
  try {
    raw = JSON.parse(fs.readFileSync(path.join(projectPath, PROJECT_CONFIG_FILE), 'utf8'))
  } catch {
    raw = {}
  }
  const c = raw.coordination ?? {}
  const coordination: CoordAdapter = {
    leaseDir: typeof c.leaseDir === 'string' ? c.leaseDir : DEFAULT_COORD.leaseDir,
    leaseGlob: typeof c.leaseGlob === 'string' ? c.leaseGlob : DEFAULT_COORD.leaseGlob,
    leaseFields: {
      resource: c.leaseFields?.resource ?? DEFAULT_COORD.leaseFields.resource,
      agent: c.leaseFields?.agent ?? DEFAULT_COORD.leaseFields.agent,
      intent: c.leaseFields?.intent ?? DEFAULT_COORD.leaseFields.intent,
      acquired: c.leaseFields?.acquired ?? DEFAULT_COORD.leaseFields.acquired,
      heartbeat: c.leaseFields?.heartbeat ?? DEFAULT_COORD.leaseFields.heartbeat
    },
    takeoversLog: typeof c.takeoversLog === 'string' ? c.takeoversLog : DEFAULT_COORD.takeoversLog,
    wipFile: typeof c.wipFile === 'string' ? c.wipFile : DEFAULT_COORD.wipFile,
    wipSection: typeof c.wipSection === 'string' ? c.wipSection : DEFAULT_COORD.wipSection
  }
  const logDirs = Array.isArray(raw.logDirs) ? raw.logDirs.filter((x: unknown) => typeof x === 'string') : undefined

  const commands: OrbitCommand[] = Array.isArray(raw.commands)
    ? raw.commands
        .filter((c: any) => c && typeof c.label === 'string' && typeof c.run === 'string')
        // Keep an explicitly declared shell only if it's one we know; otherwise leave it
        // unset so the renderer can pick the host platform's default shell at runtime.
        .map((c: any) => ({
          label: c.label,
          run: c.run,
          ...(SHELL_KINDS.has(c.shell) ? { shell: c.shell as ShellKind } : {})
        }))
    : []
  const prompts: QuickPrompt[] = Array.isArray(raw.prompts)
    ? raw.prompts
        .filter((p: any) => p && typeof p.label === 'string' && typeof p.prompt === 'string')
        .map((p: any) => ({ label: p.label, prompt: p.prompt }))
    : []
  const accent = typeof raw.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw.accent) ? raw.accent : null
  const docs = Array.isArray(raw.docs) ? raw.docs.filter((x: unknown) => typeof x === 'string') : null
  const subprojects: SubProjectDecl[] = Array.isArray(raw.subprojects)
    ? raw.subprojects
        .filter((s: any) => s && typeof s.path === 'string')
        .map((s: any) => ({ name: typeof s.name === 'string' ? s.name : String(s.path), path: s.path }))
    : []

  return { coordination, logDirs, commands, prompts, accent, docs, subprojects }
}

/** First present, non-empty value among candidate keys. */
export function pickField(obj: any, keys: string[], fallback = ''): string {
  for (const k of keys) {
    const v = obj?.[k]
    if (v != null && v !== '') return String(v)
  }
  return fallback
}

/** Filename matches a simple `*` glob (no path separators). */
export function globMatch(glob: string, name: string): boolean {
  const re = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  return re.test(name)
}
