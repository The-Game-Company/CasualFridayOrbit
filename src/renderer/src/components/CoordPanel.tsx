import { useState, type ReactNode } from 'react'
import type { CoordState, Lease } from '../../../shared/events'

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
}

/** Strip the boilerplate `claude-YYYY-MM-DD-` prefix from agent names. */
function shortAgent(name: string): string {
  return name.replace(/^claude-\d{4}-\d{2}-\d{2}-/, '')
}

/** Deterministic per-agent hue so leases and WIP entries are visually linkable. */
function agentColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return `hsl(${((h % 360) + 360) % 360}, 55%, 60%)`
}

/** `a/b/c/d/File.ext` → `a/…/d/File.ext` (paths with ≤3 segments stay as-is). */
function collapsePath(p: string): string {
  const segs = p.split('/')
  if (segs.length <= 3) return p
  return `${segs[0]}/…/${segs[segs.length - 2]}/${segs[segs.length - 1]}`
}

/** Split a lease resource into a type chip and path, e.g. `code:a/b.cs` → ['code', 'a/b.cs']. */
function splitResource(resource: string): [string, string] {
  const i = resource.indexOf(':')
  return i > 0 ? [resource.slice(0, i), resource.slice(i + 1)] : [resource, '']
}

const SECTIONS_KEY = 'orbit.coordSections'

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}')
  } catch {
    return {}
  }
}

function CoordSection({
  id,
  title,
  count,
  sub,
  open,
  onToggle,
  children
}: {
  id: string
  title: string
  count: number
  sub: string
  open: boolean
  onToggle: (id: string) => void
  children: ReactNode
}): JSX.Element {
  return (
    <div className="coord-section">
      <div className="coord-h coord-h-toggle" onClick={() => onToggle(id)}>
        <span className="coord-caret">{open ? '▾' : '▸'}</span> {title} · {count}
      </div>
      {open && (
        <>
          <div className="coord-sub">{sub}</div>
          {children}
        </>
      )}
    </div>
  )
}

const MAX_LEASES_SHOWN = 4

function LeaseGroup({ agent, leases }: { agent: string; leases: Lease[] }): JSX.Element {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const stale = leases.some((l) => l.stale)
  const worstAge = Math.max(...leases.map((l) => l.ageSec))
  const intent = leases.find((l) => l.intent)?.intent
  const shown = showAll ? leases : leases.slice(0, MAX_LEASES_SHOWN)
  const togglePath = (res: string): void =>
    setExpandedPaths((cur) => {
      const next = new Set(cur)
      if (next.has(res)) next.delete(res)
      else next.add(res)
      return next
    })
  return (
    <div className={`coord-group ${stale ? 'stale' : ''}`}>
      <div className="coord-group-h" title={intent ? `${agent} — intent: ${intent}` : agent}>
        <span className="coord-dot" style={{ background: agentColor(agent) }} />
        <span className="coord-agent">{shortAgent(agent)}</span>
        <span
          className="coord-age"
          title={`last heartbeat ${fmtAge(worstAge)} ago · goes stale after ${fmtAge(leases[0].expirySec)} of silence`}
        >
          {stale ? '⚠ stale ' : ''}
          {fmtAge(worstAge)}
        </span>
      </div>
      {shown.map((l) => {
        const [type, p] = splitResource(l.resource)
        const expanded = expandedPaths.has(l.resource)
        return (
          <div key={l.resource} className="coord-lease-line">
            <span className="coord-chip">{type}</span>
            {p ? (
              <span
                className={`coord-path ${expanded ? 'expanded' : ''}`}
                title={l.resource}
                onClick={() => togglePath(l.resource)}
              >
                {expanded ? p : collapsePath(p)}
              </span>
            ) : (
              <span className="coord-path muted">(whole {type})</span>
            )}
          </div>
        )
      })}
      {leases.length > MAX_LEASES_SHOWN && (
        <button className="coord-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'show less' : `+${leases.length - MAX_LEASES_SHOWN} more`}
        </button>
      )}
    </div>
  )
}

/** `<iso> TAKEOVER by=<agent> stale_from=<agent> …` → readable parts, or null. */
function parseTakeover(line: string): { ageSec: number; by: string; from?: string } | null {
  const m = line.match(/^(\S+)\s+TAKEOVER\s+by=(\S+)(?:\s+stale_from=(\S+))?/)
  if (!m) return null
  const ts = Date.parse(m[1])
  if (isNaN(ts)) return null
  return { ageSec: Math.max(0, Math.round((Date.now() - ts) / 1000)), by: m[2], from: m[3] }
}

function Takeovers({ takeovers }: { takeovers: string[] }): JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const newest = [...takeovers].reverse()
  const shown = showAll ? newest : newest.slice(0, 3)
  return (
    <>
      {shown.map((t, i) => {
        const p = parseTakeover(t)
        if (!p)
          return (
            <div key={i} className="coord-takeover" title={t}>
              {t}
            </div>
          )
        return (
          <div key={i} className="coord-takeover parsed" title={t}>
            <span className="coord-takeover-time">{fmtAge(p.ageSec)} ago</span>
            <span className="coord-agent">{shortAgent(p.by)}</span>
            {p.from && (
              <>
                <span className="coord-takeover-arrow">⇐</span>
                <span className="coord-agent">{shortAgent(p.from)}</span>
              </>
            )}
          </div>
        )
      })}
      {newest.length > 3 && (
        <button className="coord-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'show less' : `show all (${newest.length})`}
        </button>
      )}
    </>
  )
}

export function CoordPanel({ coord }: { coord: CoordState | null }): JSX.Element {
  const [sections, setSections] = useState<Record<string, boolean>>(readSections)
  const [openWip, setOpenWip] = useState<number | null>(null)
  if (!coord) return <div className="ctx-empty">open a project</div>
  const { leases, wip, takeovers } = coord

  const isOpen = (id: string): boolean => sections[id] !== false
  const toggle = (id: string): void =>
    setSections((cur) => {
      const next = { ...cur, [id]: !isOpen(id) }
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next))
      return next
    })

  const groups = new Map<string, Lease[]>()
  for (const l of leases) {
    const g = groups.get(l.agent)
    if (g) g.push(l)
    else groups.set(l.agent, [l])
  }

  return (
    <div className="coord">
      <CoordSection
        id="leases"
        title="FILE LOCKS (LEASES)"
        count={leases.length}
        sub="areas an agent claimed so others don't collide"
        open={isOpen('leases')}
        onToggle={toggle}
      >
        {leases.length === 0 && <div className="coord-empty">no active leases</div>}
        {[...groups.entries()].map(([agent, ls]) => (
          <LeaseGroup key={agent} agent={agent} leases={ls} />
        ))}
      </CoordSection>

      <CoordSection
        id="wip"
        title="ACTIVE WORK (WIP)"
        count={wip.length}
        sub="what each agent is currently working on"
        open={isOpen('wip')}
        onToggle={toggle}
      >
        {wip.length === 0 && <div className="coord-empty">no agents registered</div>}
        {wip.map((w, i) => (
          <div
            key={i}
            className={`coord-wip ${openWip === i ? 'expanded' : ''}`}
            onClick={() => setOpenWip((cur) => (cur === i ? null : i))}
          >
            <div className="coord-wip-head">
              <span className="coord-agent" title={w.agent}>
                <span className="coord-dot" style={{ background: agentColor(w.agent) }} />
                {shortAgent(w.agent)}
              </span>
              {w.initiative && <span className="coord-init">{w.initiative}</span>}
            </div>
            {w.title && <div className="coord-wip-title">{w.title}</div>}
            {w.status && <div className="coord-wip-status coord-clamp">{w.status}</div>}
            {w.scope && (
              <div className="coord-wip-scope coord-clamp" title={w.scope}>
                {w.scope}
              </div>
            )}
          </div>
        ))}
      </CoordSection>

      {takeovers.length > 0 && (
        <CoordSection
          id="takeovers"
          title="RECENT TAKEOVERS"
          count={takeovers.length}
          sub="when an agent reclaimed a lease from another"
          open={isOpen('takeovers')}
          onToggle={toggle}
        >
          <Takeovers takeovers={takeovers} />
        </CoordSection>
      )}
    </div>
  )
}
