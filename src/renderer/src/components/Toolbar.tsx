import type { SessionState } from '../session-model'

interface Props {
  session: SessionState | null
  onRestart: () => void
  onContinue: () => void
  onInterrupt: () => void
  onClear: () => void
  onSplit: () => void
  onHistory: () => void
  canHistory: boolean
  fontSize: number
  onFont: (delta: number) => void
  onSettings: () => void
}

function statusText(s: SessionState | null): string {
  if (!s) return ''
  if (s.exited) return 'exited'
  if (s.status === 'busy') {
    const bits: string[] = ['working']
    if (s.agentsActive > 0) bits.push(`${s.agentsActive} agent${s.agentsActive > 1 ? 's' : ''}`)
    if (s.activeSkill) bits.push(`skill: ${s.activeSkill}`)
    return bits.join(' · ')
  }
  if (s.status === 'waiting') return 'waiting for you'
  return 'idle'
}

export function Toolbar({
  session,
  onRestart,
  onContinue,
  onInterrupt,
  onClear,
  onSplit,
  onHistory,
  canHistory,
  fontSize,
  onFont,
  onSettings
}: Props): JSX.Element {
  const disabled = !session
  return (
    <div className="toolbar">
      <span className={`toolbar-status status-${session?.status ?? 'idle'}`}>{statusText(session)}</span>
      <div className="toolbar-actions">
        <button disabled={disabled} onClick={onInterrupt} title="Interrupt (Esc)">
          ⛔ stop
        </button>
        <button disabled={disabled} onClick={onRestart} title="Restart session">
          ↻ restart
        </button>
        <button disabled={disabled} onClick={onContinue} title="Resume most recent conversation (--continue)">
          ⏩ continue
        </button>
        <button disabled={disabled} onClick={onClear} title="Clear the terminal view">
          ⌫ clear
        </button>
        <span className="toolbar-sep" />
        <button disabled={disabled} onClick={onSplit} title="Split: new Claude session beside this one (Ctrl+\)">
          ⊞ split
        </button>
        <button disabled={!canHistory} onClick={onHistory} title="Past conversations in this project">
          ⟲ history
        </button>
        <span className="toolbar-sep" />
        <button onClick={() => onFont(-1)} title="Smaller font">
          A−
        </button>
        <span className="font-size">{fontSize}</span>
        <button onClick={() => onFont(1)} title="Larger font">
          A+
        </button>
        <span className="toolbar-sep" />
        <button onClick={onSettings} title="Settings">
          ⚙
        </button>
      </div>
    </div>
  )
}
