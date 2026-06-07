import { useState } from 'react'
import type { ActivityItem, ActivityKind } from '../session-model'

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false })
}

type Mode = 'basic' | 'full'
const STORE_KEY = 'orbit.activityMode'

/** Basic mode keeps only the high-signal story of a turn: what you asked, what the agent is
 *  working on (skills + subagents), and which MCP servers it reached for — hiding the noisy
 *  per-tool chatter (Bash/Read/Edit/Grep, notifications) that Full mode still shows. */
const BASIC_KINDS = new Set<ActivityKind>(['prompt', 'skill', 'mcp', 'agent', 'stop'])

export function Activity({
  items,
  onCollapse
}: {
  items: ActivityItem[]
  onCollapse?: () => void
}): JSX.Element {
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(STORE_KEY) as Mode) || 'basic'
  )
  const choose = (m: Mode): void => {
    setMode(m)
    localStorage.setItem(STORE_KEY, m)
  }

  const shown = mode === 'full' ? items : items.filter((it) => BASIC_KINDS.has(it.kind))

  return (
    <div className="panel activity">
      <div className="panel-head">
        <span>ACTIVITY</span>
        <span className="seg seg-sm" title="Basic shows prompts, skills, MCP and agents; Full shows every event">
          <button className={mode === 'basic' ? 'on' : ''} onClick={() => choose('basic')}>
            Basic
          </button>
          <button className={mode === 'full' ? 'on' : ''} onClick={() => choose('full')}>
            Full
          </button>
        </span>
        {onCollapse && (
          <button className="act-collapse-btn" onClick={onCollapse} title="Collapse">
            ▾
          </button>
        )}
      </div>
      <div className="activity-list">
        {shown.length === 0 && (
          <div className="activity-empty">
            {mode === 'basic'
              ? 'prompts, skills and MCP activity appear here'
              : 'events appear as Claude works'}
          </div>
        )}
        {shown.map((it) => (
          <div key={it.id} className={`activity-row kind-${it.kind}`}>
            <span className="activity-time">{clock(it.ts)}</span>
            <span className="activity-icon">{it.icon}</span>
            <span className="activity-label">{it.label}</span>
            {it.detail && <span className="activity-detail">{it.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
