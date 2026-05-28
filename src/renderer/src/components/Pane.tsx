import type { ReactNode } from 'react'
import type { SessionState } from '../session-model'
import { KIND_META } from '../kind-meta'
import { AgentBadge, StatusDot } from './indicators'

interface Props {
  session: SessionState
  active: boolean
  /** false when this is the tab's only window (closing it would close the tab) */
  canRemove: boolean
  /** highlight: auto-focus just jumped here; clears once the user interacts */
  autoFocused: boolean
  onFocus: () => void
  onSplit: () => void
  onRemove: () => void
  children: ReactNode
}

/** A single window in a tab: a header bar + the terminal underneath. */
export function Pane({ session, active, canRemove, autoFocused, onFocus, onSplit, onRemove, children }: Props): JSX.Element {
  return (
    <div
      className={`pane ${active ? 'active' : ''} ${session.activeSkill ? 'skill' : ''} ${autoFocused ? 'auto-focused' : ''}`}
      onMouseDown={onFocus}
    >
      <div className="pane-body">{children}</div>
      <div className="pane-head">
        <span className="pane-kind">{KIND_META[session.kind].icon}</span>
        <StatusDot status={session.status} />
        <span className="pane-title">{session.title}</span>
        {session.kind === 'claude' && (
          <span
            className={`pane-effort effort-${(session.effort ?? 'unknown').toLowerCase()}`}
            title={session.effort ? `reasoning effort: ${session.effort}` : 'reasoning effort unknown'}
          >
            {session.effort ?? '— effort'}
          </span>
        )}
        {autoFocused && (
          <span className="pane-autofocus" title="auto-focus jumped here — it's waiting for you">
            ⤷ auto-focused
          </span>
        )}
        {session.activeSkill && (
          <span className="pane-skill" title={`running skill: ${session.activeSkill}`}>✦ {session.activeSkill}</span>
        )}
        <AgentBadge n={session.agentsActive} />
        <span className="pane-spacer" />
        <button
          className="pane-btn"
          title="Split — new Claude window in this tab"
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
            title="Close this window"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
