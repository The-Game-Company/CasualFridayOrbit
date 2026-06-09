import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'
import chokidar, { type FSWatcher } from 'chokidar'
import type { ExternalChange, FileNode, ReadFileResult, SaveResult } from '../shared/events'

const IGNORE = new Set(['node_modules', '.git'])
const MAX_EDIT_BYTES = 2 * 1024 * 1024 // 2 MB editable cap

export function hashContent(s: string): string {
  return crypto.createHash('sha1').update(s, 'utf8').digest('hex')
}

/** Lazily list a directory's immediate children (dirs first, then files). */
export function readDir(dir: string): FileNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: e.isDirectory() ? ('dir' as const) : ('file' as const)
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/**
 * Offload the file-tree walk to a dedicated worker thread so the main-process
 * event loop stays free while searching large projects. One IPC round trip total.
 */
export function searchFiles(root: string, query: string, isRegex: boolean): Promise<FileNode[]> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'search-worker.js')
    const worker = new Worker(workerPath, { workerData: { root, query, isRegex } })
    worker.once('message', ({ results }: { results: FileNode[] }) => resolve(results))
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`search-worker exited with code ${code}`))
    })
  })
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** Read a text file for editing, flagging binary / too-large / missing cases. Async so a
 *  multi-MB read never stalls the main-process event loop (which also carries pty traffic). */
export async function readTextFile(file: string): Promise<ReadFileResult> {
  let stat: fs.Stats
  try {
    stat = await fsp.stat(file)
  } catch {
    return { ok: false, missing: true }
  }
  if (stat.size > MAX_EDIT_BYTES) return { ok: false, tooLarge: true, size: stat.size }
  let buf: Buffer
  try {
    buf = await fsp.readFile(file)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  if (looksBinary(buf)) return { ok: false, binary: true, size: stat.size }
  const content = buf.toString('utf8')
  return { ok: true, content, hash: hashContent(content), mtimeMs: stat.mtimeMs, size: stat.size }
}

/**
 * Save only if the on-disk version still matches the caller's baseline hash (no one else
 * changed it), unless `force` is set. Never holds a lock; this is the single write point.
 */
export async function saveTextFile(
  file: string,
  content: string,
  baselineHash: string,
  force: boolean
): Promise<SaveResult> {
  let currentHash: string | null = null
  try {
    currentHash = hashContent(await fsp.readFile(file, 'utf8'))
  } catch {
    currentHash = null // missing/unreadable
  }
  if (!force && currentHash !== baselineHash) return { ok: false, conflict: true }
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, content, 'utf8')
    const stat = await fsp.stat(file)
    return { ok: true, hash: hashContent(content), mtimeMs: stat.mtimeMs }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Watches the set of files currently open in the editor (one chokidar watcher per file) and
 * pushes a file's latest content whenever it changes on disk — regardless of who changed it
 * (agent or otherwise). Each open tab watches its own path independently, so a background tab
 * stays live just like the focused one.
 */
export class FileWatcher {
  private watchers = new Map<string, FSWatcher>()

  constructor(private onChange: (c: ExternalChange) => void) {}

  watch(file: string): void {
    if (this.watchers.has(file)) return // already watching this path
    const watcher = chokidar.watch(file, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120 }
    })
    this.watchers.set(file, watcher)
    const push = (): void => {
      if (!this.watchers.has(file)) return
      void readTextFile(file).then((r) => {
        if (!this.watchers.has(file)) return // unwatched while the read was in flight
        if (r.ok) this.onChange({ path: file, content: r.content, hash: r.hash, mtimeMs: r.mtimeMs })
      })
    }
    watcher.on('change', push)
    watcher.on('add', push)
    watcher.on('unlink', () => {
      if (this.watchers.has(file)) this.onChange({ path: file, deleted: true })
    })
  }

  unwatch(file: string): void {
    const watcher = this.watchers.get(file)
    if (watcher) {
      void watcher.close()
      this.watchers.delete(file)
    }
  }

  unwatchAll(): void {
    for (const watcher of this.watchers.values()) void watcher.close()
    this.watchers.clear()
  }
}
