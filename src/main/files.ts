import fs from 'node:fs'
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

/** Read a text file for editing, flagging binary / too-large / missing cases. */
export function readTextFile(file: string): ReadFileResult {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return { ok: false, missing: true }
  }
  if (stat.size > MAX_EDIT_BYTES) return { ok: false, tooLarge: true, size: stat.size }
  let buf: Buffer
  try {
    buf = fs.readFileSync(file)
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
export function saveTextFile(file: string, content: string, baselineHash: string, force: boolean): SaveResult {
  let currentHash: string | null = null
  try {
    currentHash = hashContent(fs.readFileSync(file, 'utf8'))
  } catch {
    currentHash = null // missing/unreadable
  }
  if (!force && currentHash !== baselineHash) return { ok: false, conflict: true }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content, 'utf8')
    const stat = fs.statSync(file)
    return { ok: true, hash: hashContent(content), mtimeMs: stat.mtimeMs }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Watches exactly one file at a time (the one open in the editor) and pushes its latest
 * content whenever it changes on disk — regardless of who changed it (agent or otherwise).
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null
  private target: string | null = null

  constructor(private onChange: (c: ExternalChange) => void) {}

  watch(file: string): void {
    this.unwatch()
    this.target = file
    this.watcher = chokidar.watch(file, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120 } })
    const push = (): void => {
      if (this.target !== file) return
      const r = readTextFile(file)
      if (r.ok) this.onChange({ path: file, content: r.content, hash: r.hash, mtimeMs: r.mtimeMs })
    }
    this.watcher.on('change', push)
    this.watcher.on('add', push)
    this.watcher.on('unlink', () => {
      if (this.target === file) this.onChange({ path: file, deleted: true })
    })
  }

  unwatch(): void {
    this.target = null
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }
}
