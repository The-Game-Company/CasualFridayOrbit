import type { ReactNode } from 'react'
import type { SessionState } from '../session-model'
import { KIND_META } from '../kind-meta'
import { AgentBadge, StatusDot } from './indicators'

interface Props {
  session: SessionState
  active: boolean
  canRemove: boolean
  onFocus: () => void
  onSplit: () => void
  onRemove: () => void
  children: ReactNode
}

/** A single cell in the split grid: a header bar + the terminal underneath. */
export function Pane({ session, active, canRemove, onFocus, onSplit, onRemove, children }: Props): JSX.Element {
  return (
    <div className={`pane ${active ? 'active' : ''}`} onMouseDown={onFocus}>
      <div className="pane-head">
        <span className="pane-kind">{KIND_META[session.kind].icon}</span>
        <StatusDot status={session.status} />
        <span className="pane-title">{session.title}</span>
        <AgentBadge n={session.agentsActive} />
        <span className="pane-spacer" />
        <button
          className="pane-btn"
          title="Split (new Claude session)"
          onClick={(e) => {
            e.stopPropagation()
            onSplit()
          }}
        >
          ⊞
        </button>
        {canRemove && (
          <button
            className="pane-btn"
            title="Remove from split"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="pane-body">{children}</div>
    </div>
  )
}
