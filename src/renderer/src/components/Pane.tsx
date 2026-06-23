import type { DragEvent, ReactNode } from 'react'
import type { SessionState } from '../session-model'
import { KIND_META } from '../kind-meta'
import { AgentBadge, StatusDot } from './indicators'
import { BranchIcon } from './icons'

interface Props {
  session: SessionState
  active: boolean
  /** false when this is the tab's only window (closing it would close the tab) */
  canRemove: boolean
  /** true for a claude chat with a transcript to fork (hides branch on shells / empty chats) */
  canBranch: boolean
  /** highlight: auto-focus just jumped here; clears once the user interacts */
  autoFocused: boolean
  /** the header is a drag handle for rearranging the window in the grid */
  draggable: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onFocus: () => void
  onSplit: () => void
  onBranch: () => void
  onRemove: () => void
  children: ReactNode
}

/** A single window in a tab: a header bar + the terminal underneath. */
export function Pane({ session, active, canRemove, canBranch, autoFocused, draggable, onDragStart, onDragEnd, onFocus, onSplit, onBranch, onRemove, children }: Props): JSX.Element {
  return (
    <div
      className={`pane ${active ? 'active' : ''} ${session.activeSkill ? 'skill' : ''} ${autoFocused ? 'auto-focused' : ''}`}
      onMouseDown={onFocus}
    >
      <div className="pane-body">{children}</div>
      <div
        className="pane-head"
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={draggable ? 'Drag to rearrange this window in the grid' : undefined}
      >
        <span className="pane-kind">{KIND_META[session.kind].icon}</span>
        <StatusDot status={session.status} />
        <span className="pane-title">{session.title}</span>
        {session.branchedFrom && (
          <span className="pane-branch-tag" title={`branched from: ${session.branchedFrom}`}>
            <BranchIcon size={11} /> branch
          </span>
        )}
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
        {canBranch && (
          <button
            className="pane-btn"
            title="Branch (Ctrl+Shift+D) — fork this chat into a split window that shares its history up to now"
            onClick={(e) => {
              e.stopPropagation()
              onBranch()
            }}
          >
            <BranchIcon />
          </button>
        )}
        <button
          className="pane-btn"
          title="Split (Ctrl+\) — new Claude window in this tab"
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
