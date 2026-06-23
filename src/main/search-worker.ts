import { workerData, parentPort } from 'worker_threads'
import fs from 'node:fs'
import path from 'node:path'

// Keep this worker fully self-contained (it is spawned by file path and runs from inside the
// packaged asar). Mirror of SEARCH_RESULT_CAP in ../shared/limits.ts — keep the two in sync.
const SEARCH_RESULT_CAP = 1000

const SEARCH_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.nuxt',
  '__pycache__', '.gradle', 'target', 'bin', 'obj', '.cache', '.turbo',
  'coverage', '.nyc_output', '.parcel-cache'
])

interface WorkerInput { root: string; query: string; isRegex: boolean }
interface FileNode { name: string; path: string; type: 'file' }

const { root, query, isRegex } = workerData as WorkerInput

async function walk(dir: string, test: (rel: string) => boolean, out: FileNode[]): Promise<void> {
  if (out.length >= SEARCH_RESULT_CAP) return // bounded: stop once we have enough matches
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
  const subs: Promise<void>[] = []
  for (const e of entries) {
    if (out.length >= SEARCH_RESULT_CAP) break
    if (SEARCH_IGNORE.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      subs.push(walk(full, test, out))
    } else {
      const rel = full.slice(root.length + 1).replace(/\\/g, '/')
      if (test(rel)) out.push({ name: e.name, path: full, type: 'file' })
    }
  }
  await Promise.all(subs)
}

async function run(): Promise<void> {
  let test: (s: string) => boolean
  try {
    if (isRegex) {
      const re = new RegExp(query, 'i')
      test = (s) => re.test(s)
    } else {
      // Token search: split the query on whitespace and require every term to
      // appear (case-insensitive, any order) somewhere in the relative path.
      // So "apple document" matches "apple_document.ts", "document-A Apple.md", etc.
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      test = (s) => {
        const lower = s.toLowerCase()
        return terms.every((t) => lower.includes(t))
      }
    }
  } catch {
    parentPort?.postMessage({ results: [] })
    return
  }
  const results: FileNode[] = []
  await walk(root, test, results)
  results.sort((a, b) => a.path.localeCompare(b.path))
  // Concurrent walks can overshoot the cap slightly; trim to the bound before sending.
  parentPort?.postMessage({ results: results.slice(0, SEARCH_RESULT_CAP) })
}

run()
