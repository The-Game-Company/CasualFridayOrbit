import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { KeyDoc, LogState } from '../shared/events'
import { readProjectConfig } from './project-config'

// (KEY_DOCS default is defined below; a project can override via .orbit.json "docs".)

const DEFAULT_LOG_DIRS = ['PlayLogs', 'logs', 'Logs']
const TAIL_BYTES = 250 * 1024

const KEY_DOCS = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'ASSISTANT_RULES.md',
  'STATUS.md',
  'WIP.md',
  'DOCS.md',
  'INITIATIVES.md',
  'AGENTS.md',
  'README.md'
]

/** Pinned "always-on" docs that exist in a project, with mtimes for staleness. */
export function listKeyDocs(projectPath: string): KeyDoc[] {
  const declared = readProjectConfig(projectPath).docs
  const names = declared && declared.length ? declared : KEY_DOCS
  const out: KeyDoc[] = []
  for (const name of names) {
    const p = path.join(projectPath, name)
    try {
      const st = fs.statSync(p)
      if (st.isFile()) out.push({ name, path: p, mtimeMs: st.mtimeMs })
    } catch {
      /* not present */
    }
  }
  return out
}

function newestLog(projectPath: string, dirs: string[]): string | null {
  let best: { path: string; mtime: number } | null = null
  for (const d of dirs) {
    const dir = path.join(projectPath, d)
    let names: string[]
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.log'))
    } catch {
      continue
    }
    for (const n of names) {
      const full = path.join(dir, n)
      try {
        const m = fs.statSync(full).mtimeMs
        if (!best || m > best.mtime) best = { path: full, mtime: m }
      } catch {
        /* ignore */
      }
    }
  }
  return best?.path ?? null
}

function tail(file: string): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    let s = buf.toString('utf8')
    if (size > TAIL_BYTES) s = s.slice(s.indexOf('\n') + 1) // drop partial first line
    return s
  } catch {
    return ''
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

/** Watches a project's log dirs and pushes the tail of the newest *.log on change. */
export class LogWatcher {
  private watcher: FSWatcher | null = null
  private project: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  /** dirsFn() is read fresh so Settings changes to log folders take effect on re-watch. */
  constructor(
    private onUpdate: (s: LogState) => void,
    private dirsFn: () => string[]
  ) {}

  private currentDirs(): string[] {
    // per-project .orbit.json wins, then global Settings, then built-in defaults
    if (this.project) {
      const pc = readProjectConfig(this.project).logDirs
      if (pc && pc.length) return pc
    }
    const d = this.dirsFn()
    return d && d.length ? d : DEFAULT_LOG_DIRS
  }

  private emit(): void {
    if (!this.project) return
    const p = newestLog(this.project, this.currentDirs())
    this.onUpdate({ projectPath: this.project, path: p, content: p ? tail(p) : '' })
  }

  watch(projectPath: string): void {
    this.unwatch()
    this.project = projectPath
    const targets = this.currentDirs().map((d) => path.join(projectPath, d))
    this.watcher = chokidar.watch(targets, { ignoreInitial: true })
    const debounced = (): void => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.emit(), 200)
    }
    this.watcher.on('all', debounced)
    this.emit()
  }

  unwatch(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
    this.project = null
  }
}
