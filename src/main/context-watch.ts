import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { ContextNode } from '../shared/events'

// Top-level files/dirs that count as "context" for a project.
const TOP_LEVEL = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.mcp.json']
const IGNORE = /(^|[\\/])(node_modules|\.git|out|dist)([\\/]|$)/
const MAX_DEPTH = 6

function buildNode(p: string, depth: number): ContextNode | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(p)
  } catch {
    return null
  }
  const name = path.basename(p)
  if (stat.isDirectory()) {
    const node: ContextNode = { name, path: p, type: 'dir', children: [] }
    if (depth >= MAX_DEPTH) return node
    let entries: string[] = []
    try {
      entries = fs.readdirSync(p)
    } catch {
      return node
    }
    node.children = entries
      .map((e) => path.join(p, e))
      .filter((cp) => !IGNORE.test(cp))
      .map((cp) => buildNode(cp, depth + 1))
      .filter((n): n is ContextNode => n !== null)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return node
  }
  return { name, path: p, type: 'file' }
}

/** Scan a project for its context files and return them as a tree. */
export function scanContext(project: string): ContextNode[] {
  return TOP_LEVEL.map((t) => path.join(project, t))
    .filter((p) => fs.existsSync(p))
    .map((p) => buildNode(p, 0))
    .filter((n): n is ContextNode => n !== null)
}

/** Read a context file's contents (capped) for the preview pane. */
export function readContextFile(p: string): string {
  try {
    const stat = fs.statSync(p)
    if (stat.size > 512 * 1024) {
      return fs.readFileSync(p, 'utf8').slice(0, 512 * 1024) + '\n\n… (truncated)'
    }
    return fs.readFileSync(p, 'utf8')
  } catch (e) {
    return `(could not read file: ${(e as Error).message})`
  }
}

export class ContextWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  watch(project: string, onTree: (tree: ContextNode[]) => void): void {
    this.dispose()
    const targets = TOP_LEVEL.map((t) => path.join(project, t))
    const emit = (): void => onTree(scanContext(project))

    this.watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      ignored: (p: string) => IGNORE.test(p),
      depth: MAX_DEPTH
    })
    const debounced = (): void => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(emit, 150)
    }
    this.watcher.on('all', debounced)

    // initial snapshot
    emit()
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }
}
