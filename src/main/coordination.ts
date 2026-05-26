import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { CoordState, Lease, WipEntry } from '../shared/events'
import {
  readProjectConfig,
  pickField,
  globMatch,
  PROJECT_CONFIG_FILE,
  type CoordAdapter
} from './project-config'

export function readLeases(projectPath: string, staleSec: number, a: CoordAdapter): Lease[] {
  const dir = path.join(projectPath, a.leaseDir)
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((n) => globMatch(a.leaseGlob, n))
  } catch {
    return []
  }
  const now = Date.now()
  const out: Lease[] = []
  for (const n of names) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      const acquired = pickField(o, a.leaseFields.acquired)
      const heartbeat = pickField(o, a.leaseFields.heartbeat, acquired)
      const hb = Date.parse(heartbeat)
      const ageSec = isNaN(hb) ? 0 : Math.max(0, Math.round((now - hb) / 1000))
      out.push({
        resource: pickField(o, a.leaseFields.resource, n),
        agent: pickField(o, a.leaseFields.agent, '?'),
        intent: pickField(o, a.leaseFields.intent),
        acquired,
        heartbeat,
        ageSec,
        expirySec: staleSec,
        stale: ageSec > staleSec
      })
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((x, y) => x.resource.localeCompare(y.resource))
}

/** Parse the `## <section>` block of the WIP file into entries. */
export function readWip(projectPath: string, a: CoordAdapter): WipEntry[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(projectPath, a.wipFile), 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n')
  const re = new RegExp('^##\\s+' + a.wipSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
  const start = lines.findIndex((l) => re.test(l))
  if (start < 0) return []
  const entries: WipEntry[] = []
  let cur: WipEntry | null = null
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^##\s+/.test(l)) break
    const head = l.match(/^###\s+(.+)/)
    if (head) {
      if (cur) entries.push(cur)
      const t = head[1]
      const dash = t.indexOf('—') >= 0 ? t.indexOf('—') : t.indexOf(' - ')
      cur = { agent: dash > 0 ? t.slice(0, dash).trim() : t.trim(), title: dash > 0 ? t.slice(dash + 1).trim() : '' }
      continue
    }
    if (!cur) continue
    const field = l.match(/^\s*-\s*\*\*(Started|Scope|Leases held|Status|Initiative)\*\*\s*:\s*(.*)$/i)
    if (field) {
      const key = field[1].toLowerCase()
      const val = field[2].trim()
      if (key === 'started') cur.started = val
      else if (key === 'scope') cur.scope = val
      else if (key === 'leases held') cur.leases = val
      else if (key === 'status') cur.status = val
      else if (key === 'initiative') cur.initiative = val
    }
  }
  if (cur) entries.push(cur)
  return entries
}

export function readTakeovers(projectPath: string, a: CoordAdapter, max = 12): string[] {
  if (!a.takeoversLog) return []
  try {
    const text = fs.readFileSync(path.join(projectPath, a.takeoversLog), 'utf8')
    return text.split('\n').filter((l) => l.trim()).slice(-max)
  } catch {
    return []
  }
}

export function readCoordination(projectPath: string, staleSec: number): CoordState {
  const a = readProjectConfig(projectPath).coordination
  return {
    projectPath,
    leases: readLeases(projectPath, staleSec, a),
    wip: readWip(projectPath, a),
    takeovers: readTakeovers(projectPath, a)
  }
}

/** Watches a project's coordination files (per its adapter) and pushes fresh snapshots. */
export class CoordinationWatcher {
  private watcher: FSWatcher | null = null
  private project: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private onUpdate: (c: CoordState) => void,
    private staleSec: () => number
  ) {}

  watch(projectPath: string): void {
    this.unwatch()
    this.project = projectPath
    const a = readProjectConfig(projectPath).coordination
    const targets = [
      path.join(projectPath, PROJECT_CONFIG_FILE),
      path.join(projectPath, a.leaseDir),
      path.join(projectPath, a.wipFile)
    ]
    this.watcher = chokidar.watch(targets, { ignoreInitial: true })
    const emit = (_evt?: string, changed?: string): void => {
      // if the adapter file itself changed, re-target the watcher
      if (changed && changed.endsWith(PROJECT_CONFIG_FILE)) {
        this.watch(projectPath)
        return
      }
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(
        () => this.project && this.onUpdate(readCoordination(this.project, this.staleSec())),
        150
      )
    }
    this.watcher.on('all', emit)
    this.onUpdate(readCoordination(projectPath, this.staleSec()))
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

/**
 * Does a lease resource cover an absolute file path? Understands the common
 * `doc:<rel>` (exact) and `code:<glob>` (with `*` / `**`) resource shapes; returns false
 * for resource shapes it doesn't recognize (so unknown leases simply don't mark files).
 */
export function leaseCoversPath(resource: string, absPath: string, projectPath: string): boolean {
  const m = resource.match(/^(doc|code):(.+)$/)
  if (!m) return false
  const rel = path.relative(projectPath, absPath).replace(/\\/g, '/')
  const pat = m[2].replace(/\\/g, '/')
  if (m[1] === 'doc') return rel === pat
  const re = new RegExp(
    '^' +
      pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/ /g, '.*') +
      '$'
  )
  return re.test(rel)
}
