import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as pty from '@lydell/node-pty'
import { writeInjectedSession, cleanupInjectedSession, type InjectedSession } from './settings-inject'
import type { TermKind } from '../shared/events'

/** First entry on PATH that contains an executable named `name`, or null. */
function findOnPath(name: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    const full = path.join(d, name)
    try {
      if (fs.existsSync(full)) return full
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Prefer PowerShell 7 (pwsh) if installed, else Windows PowerShell. */
function resolvePwsh(): string {
  return findOnPath('pwsh.exe') ?? findOnPath('powershell.exe') ?? 'powershell.exe'
}

/**
 * Resolve a POSIX login shell. An explicit kind (zsh/bash) is honored when that shell is
 * present; otherwise we use the user's $SHELL, falling back to zsh → bash → sh. This also
 * catches Windows-only kinds (powershell/cmd) that get carried onto a Mac via a restored
 * workspace — they land on the user's default shell rather than failing to spawn.
 */
function resolveUnixShell(kind: TermKind): string {
  if (kind === 'bash') return findOnPath('bash') ?? '/bin/bash'
  if (kind === 'zsh') return findOnPath('zsh') ?? '/bin/zsh'
  return process.env.SHELL || findOnPath('zsh') || findOnPath('bash') || '/bin/sh'
}

/** File + args for a plain (non-claude) shell terminal, resolved for the host platform. */
function resolveShell(kind: TermKind): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // cmd stays cmd; everything else (powershell, or a unix kind from a moved workspace) → PowerShell.
    if (kind === 'cmd') return { file: process.env.ComSpec || 'cmd.exe', args: [] }
    return { file: resolvePwsh(), args: ['-NoLogo'] }
  }
  // macOS / Linux: spawn a login shell so the user's PATH and profile are loaded.
  return { file: resolveUnixShell(kind), args: ['-l'] }
}

/**
 * Resolve the real `claude` executable. We search PATH first (this picks up the WinGet
 * shim), then fall back to known install locations.
 */
export function resolveClaudePath(): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const onPath = findOnPath(exe)
  if (onPath) return onPath
  // npm's global install ships only shims (claude.cmd/.ps1), no claude.exe — pick up the .cmd.
  if (process.platform === 'win32') {
    const cmdOnPath = findOnPath('claude.cmd')
    if (cmdOnPath) return cmdOnPath
  }
  // PATH can be missing the real install dir — notably on macOS, where an app launched from
  // Finder inherits only a minimal PATH (see shell-path.ts). Probe the known install locations.
  const fallbacks = [
    path.join(
      os.homedir(),
      'AppData/Local/Microsoft/WinGet/Packages/Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'claude.exe'
    ),
    // npm global shim location ($APPDATA\npm\claude.cmd) when it isn't on PATH.
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    path.join(os.homedir(), '.local', 'bin', exe),
    '/opt/homebrew/bin/claude', // Apple Silicon Homebrew
    '/usr/local/bin/claude' // Intel Homebrew / common /usr/local install
  ]
  for (const f of fallbacks) {
    try {
      if (fs.existsSync(f)) return f
    } catch {
      /* ignore */
    }
  }
  return exe
}

export interface PtyOptions {
  sessionId: string
  kind: TermKind
  cwd: string
  cols: number
  rows: number
  hookPort: number
  hookToken: string
  continueLast?: boolean
  resumeId?: string
  startupCommand?: string
  appearance?: 'dark' | 'light'
  /** pin reasoning effort via CLAUDE_EFFORT (claude only); see CreateSessionArgs.effort */
  effort?: string
  onData: (data: string) => void
  onExit: (code: number) => void
}

/**
 * One live `claude` session inside a pseudo-terminal. Hooks are injected via a temp
 * settings file; the hook server port/token + this session's id are passed through env
 * so the forwarder (a child of claude) can reach us and tag events. We never set
 * ANTHROPIC_API_KEY — claude uses the user's existing subscription login.
 */
export class PtySession {
  // ConPTY's input pipe (and a CLI busy mid-render) can't take a huge write in one call —
  // a multi-megabyte paste used to wedge the pipe and the session with it. Anything past
  // one chunk goes through a paced queue so the pty and the event loop keep breathing.
  private static readonly WRITE_CHUNK = 4096
  private static readonly WRITE_INTERVAL_MS = 5

  private term: pty.IPty | null = null
  private injected: InjectedSession | null = null
  private writeQueue: string[] = []
  private writeTimer: NodeJS.Timeout | null = null

  start(opts: PtyOptions): void {
    this.dispose()

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      FORCE_COLOR: '3'
    }
    delete env.ANTHROPIC_API_KEY

    let file: string
    let args: string[] = []

    if (opts.kind === 'claude') {
      // claude: inject hooks + pass session id/port so the forwarder can reach us
      this.injected = writeInjectedSession(opts.appearance)
      file = resolveClaudePath()
      args = ['--settings', this.injected.settingsPath]
      if (opts.resumeId) args.push('--resume', opts.resumeId)
      else if (opts.continueLast) args.push('--continue')
      // ConPTY's CreateProcess can't exec a .cmd/.bat directly — run it through the interpreter.
      if (/\.(cmd|bat)$/i.test(file)) {
        args = ['/c', file, ...args]
        file = process.env.ComSpec || 'cmd.exe'
      }
      env.ORBIT_HOOK_PORT = String(opts.hookPort)
      env.ORBIT_HOOK_TOKEN = opts.hookToken
      env.ORBIT_SESSION_ID = opts.sessionId
      // Pin this chat's reasoning effort. claude reads CLAUDE_EFFORT from its env (it overrides the
      // global settings.json default — which a /effort in any other window rewrites), so this keeps
      // each resumed chat at its own effort instead of all of them inheriting the last global value.
      // Also makes claude export CLAUDE_EFFORT to the hook forwarder, so the live badge is exact.
      if (opts.effort) env.CLAUDE_EFFORT = opts.effort
    } else {
      ;({ file, args } = resolveShell(opts.kind))
    }

    this.term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(opts.cols, 2),
      rows: Math.max(opts.rows, 2),
      cwd: opts.cwd,
      env
    })

    this.term.onData((d) => opts.onData(d))

    // command-bar sessions: type the command once the shell is ready
    if (opts.startupCommand) {
      const cmd = opts.startupCommand
      setTimeout(() => {
        try {
          this.term?.write(cmd + '\r')
        } catch {
          /* terminal may have exited */
        }
      }, 400)
    }

    this.term.onExit(({ exitCode }) => {
      cleanupInjectedSession(this.injected)
      this.injected = null
      opts.onExit(exitCode)
    })
  }

  write(data: string): void {
    if (!this.term) return
    // fast path: small writes (keystrokes) skip the queue entirely when nothing is pending
    if (this.writeQueue.length === 0 && data.length <= PtySession.WRITE_CHUNK) {
      this.term.write(data)
      return
    }
    for (let i = 0; i < data.length; ) {
      let end = Math.min(i + PtySession.WRITE_CHUNK, data.length)
      // never split a surrogate pair across chunks — each half would mangle to U+FFFD
      if (end < data.length) {
        const c = data.charCodeAt(end - 1)
        if (c >= 0xd800 && c <= 0xdbff) end--
      }
      this.writeQueue.push(data.slice(i, end))
      i = end
    }
    this.drainWrites()
  }

  private drainWrites(): void {
    if (this.writeTimer) return
    const tick = (): void => {
      this.writeTimer = null
      if (!this.term) {
        this.writeQueue = []
        return
      }
      const chunk = this.writeQueue.shift()
      if (chunk === undefined) return
      try {
        this.term.write(chunk)
      } catch {
        this.writeQueue = [] // terminal died mid-drain
        return
      }
      if (this.writeQueue.length > 0) this.writeTimer = setTimeout(tick, PtySession.WRITE_INTERVAL_MS)
    }
    this.writeTimer = setTimeout(tick, 0)
  }

  resize(cols: number, rows: number): void {
    if (!this.term) return
    try {
      this.term.resize(Math.max(cols, 2), Math.max(rows, 2))
    } catch {
      /* terminal may have exited */
    }
  }

  dispose(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writeQueue = []
    if (this.term) {
      try {
        this.term.kill()
      } catch {
        /* already gone */
      }
      this.term = null
    }
    cleanupInjectedSession(this.injected)
    this.injected = null
  }
}
