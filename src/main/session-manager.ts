import { PtySession } from './pty'
import { ContextWatcher } from './context-watch'
import type { ContextNode, CreateSessionArgs } from '../shared/events'

interface Entry {
  pty: PtySession
  watcher: ContextWatcher
}

export interface SessionCallbacks {
  onData: (sessionId: string, data: string) => void
  onExit: (sessionId: string, code: number) => void
  onContextTree: (sessionId: string, tree: ContextNode[]) => void
}

/** Owns all live sessions: each is a PTY + a context-file watcher, keyed by id. */
export class SessionManager {
  private sessions = new Map<string, Entry>()

  constructor(
    private cb: SessionCallbacks,
    private hook: { port: number; token: string }
  ) {}

  create(args: CreateSessionArgs): void {
    this.close(args.sessionId)

    const ptySession = new PtySession()
    ptySession.start({
      sessionId: args.sessionId,
      kind: args.kind,
      cwd: args.projectPath,
      cols: args.cols,
      rows: args.rows,
      hookPort: this.hook.port,
      hookToken: this.hook.token,
      continueLast: args.continueLast,
      resumeId: args.resumeId,
      startupCommand: args.startupCommand,
      appearance: args.appearance,
      onData: (d) => this.cb.onData(args.sessionId, d),
      onExit: (c) => this.cb.onExit(args.sessionId, c)
    })

    const watcher = new ContextWatcher()
    watcher.watch(args.projectPath, (tree) => this.cb.onContextTree(args.sessionId, tree))

    this.sessions.set(args.sessionId, { pty: ptySession, watcher })
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  close(id: string): void {
    const e = this.sessions.get(id)
    if (e) {
      e.pty.dispose()
      e.watcher.dispose()
      this.sessions.delete(id)
    }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
