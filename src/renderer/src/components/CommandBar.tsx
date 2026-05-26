import type { OrbitCommand } from '../../../shared/events'

interface Props {
  commands: OrbitCommand[]
  onRun: (cmd: OrbitCommand) => void
}

/** Project-declared quick commands (from .orbit.json). Renders nothing if none. */
export function CommandBar({ commands, onRun }: Props): JSX.Element | null {
  if (!commands.length) return null
  return (
    <div className="command-bar">
      <span className="command-bar-label">RUN</span>
      {commands.map((c, i) => (
        <button key={i} className="command-btn" onClick={() => onRun(c)} title={c.run}>
          {c.label}
        </button>
      ))}
    </div>
  )
}
