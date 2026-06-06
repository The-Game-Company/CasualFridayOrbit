import { workerData, parentPort } from 'worker_threads'
import fs from 'node:fs'
import path from 'node:path'

const SEARCH_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.nuxt',
  '__pycache__', '.gradle', 'target', 'bin', 'obj', '.cache', '.turbo',
  'coverage', '.nyc_output', '.parcel-cache'
])

interface WorkerInput { root: string; query: string; isRegex: boolean }
interface FileNode { name: string; path: string; type: 'file' }

const { root, query, isRegex } = workerData as WorkerInput

async function walk(dir: string, test: (rel: string) => boolean, out: FileNode[]): Promise<void> {
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
  const subs: Promise<void>[] = []
  for (const e of entries) {
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
      const q = query.toLowerCase()
      test = (s) => s.toLowerCase().includes(q)
    }
  } catch {
    parentPort?.postMessage({ results: [] })
    return
  }
  const results: FileNode[] = []
  await walk(root, test, results)
  results.sort((a, b) => a.path.localeCompare(b.path))
  parentPort?.postMessage({ results })
}

run()
