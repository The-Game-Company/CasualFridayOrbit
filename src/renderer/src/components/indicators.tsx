import type { SessionStatus } from '../session-model'

/** Small status dot: gray idle, pulsing accent busy, amber waiting. */
export function StatusDot({ status }: { status: SessionStatus }): JSX.Element {
  return <span className={`status-dot s-${status}`} title={status} />
}

/** "N agents working" badge; renders nothing when no agents are active. */
export function AgentBadge({ n }: { n: number }): JSX.Element | null {
  if (n <= 0) return null
  return (
    <span className="agent-badge" title={`${n} agent${n > 1 ? 's' : ''} working`}>
      ⬡ {n}
    </span>
  )
}

/** Amber dot meaning "finished / needs your attention" on an unfocused session. */
export function UnseenDot(): JSX.Element {
  return <span className="unseen-dot" title="finished — waiting for you" />
}
