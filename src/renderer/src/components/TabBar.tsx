import { useState } from 'react'
import type { TermKind } from '../../../shared/events'
import type { SessionState } from '../session-model'
import { KIND_META } from '../kind-meta'
import { AgentBadge, StatusDot, UnseenDot } from './indicators'

interface Props {
  sessions: SessionState[]
  activeId: string | null
  /** sessions pinned into the project's split grid (marked with a 'split' class) */
  split: string[]
  startedIds: Set<string>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: (kind: TermKind) => void
  onContext: (id: string, x: number, y: number) => void
  canNew: boolean
}

export function TabBar({
  sessions,
  activeId,
  split,
  startedIds,
  onSelect,
  onClose,
  onNew,
  onContext,
  canNew
}: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)

  const pick = (kind: TermKind): void => {
    setMenuOpen(false)
    onNew(kind)
  }

  return (
    <div className="tabbar">
      {sessions.map((s) => {
        const paused = !startedIds.has(s.id)
        return (
        <div
          key={s.id}
          className={`tab ${s.id === activeId ? 'active' : ''} ${split.includes(s.id) ? 'split' : ''} ${paused ? 'paused' : ''}`}
          onClick={() => onSelect(s.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContext(s.id, e.clientX, e.clientY)
          }}
          title={
            paused
              ? `${s.title} — paused, click to resume`
              : split.includes(s.id)
                ? `${s.title} — pinned in split · right-click to remove`
                : `${s.title} — right-click to add to split`
          }
        >
          <span className="tab-kind">{paused ? '⏸' : KIND_META[s.kind].icon}</span>
          <StatusDot status={s.status} />
          <span className="tab-title">{s.title}</span>
          <AgentBadge n={s.agentsActive} />
          {s.unseen && s.id !== activeId && <UnseenDot />}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onClose(s.id)
            }}
            title="Close session"
          >
            ✕
          </button>
        </div>
        )
      })}

      {canNew && (
        <div className="tab-new-wrap">
          <button className="tab-new" onClick={() => setMenuOpen((o) => !o)} title="New terminal">
            ＋
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="dropdown">
                {(Object.keys(KIND_META) as TermKind[]).map((k) => (
                  <div key={k} className="dropdown-item" onClick={() => pick(k)}>
                    <span className="dropdown-icon">{KIND_META[k].icon}</span>
                    {KIND_META[k].label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {sessions.length === 0 && <span className="tab-hint">no sessions — pick a project on the left</span>}
    </div>
  )
}
