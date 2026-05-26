import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as pty from '@lydell/node-pty'
import { writeInjectedSession, cleanupInjectedSession, type InjectedSession } from './settings-inject'
import type { TermKind } from '../shared/events'

/** Prefer PowerShell 7 (pwsh) if installed, else Windows PowerShell. */
function resolvePwsh(): string {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const name of ['pwsh.exe', 'powershell.exe']) {
    for (const d of dirs) {
      const full = path.join(d, name)
      try {
        if (fs.existsSync(full)) return full
      } catch {
        /* ignore */
      }
    }
  }
  return 'powershell.exe'
}

/**
 * Resolve the real `claude` executable. We search PATH first (this picks up the WinGet
 * shim), then fall back to known install locations.
 */
export function resolveClaudePath(): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    const full = path.join(d, exe)
    try {
      if (fs.existsSync(full)) return full
    } catch {
      /* ignore */
    }
  }
  const fallbacks = [
    path.join(
      os.homedir(),
      'AppData/Local/Microsoft/WinGet/Packages/Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'claude.exe'
    ),
    path.join(os.homedir(), '.local', 'bin', exe)
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
  private term: pty.IPty | null = null
  private injected: InjectedSession | null = null

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

    if (opts.kind === 'powershell') {
      file = resolvePwsh()
      args = ['-NoLogo']
    } else if (opts.kind === 'cmd') {
      file = process.env.ComSpec || 'cmd.exe'
      args = []
    } else {
      // claude: inject hooks + pass session id/port so the forwarder can reach us
      this.injected = writeInjectedSession()
      file = resolveClaudePath()
      args = ['--settings', this.injected.settingsPath]
      if (opts.resumeId) args.push('--resume', opts.resumeId)
      else if (opts.continueLast) args.push('--continue')
      env.ORBIT_HOOK_PORT = String(opts.hookPort)
      env.ORBIT_HOOK_TOKEN = opts.hookToken
      env.ORBIT_SESSION_ID = opts.sessionId
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
    this.term?.write(data)
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
