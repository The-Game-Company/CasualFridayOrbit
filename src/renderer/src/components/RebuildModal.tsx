import type { RebuildProgress } from '../../../shared/events'

interface Props {
  progress: RebuildProgress
  onDismiss: () => void
}

export function RebuildModal({ progress, onDismiss }: Props): JSX.Element {
  const failed = progress.pct === -1
  const pct = failed ? 0 : progress.pct

  return (
    <div className="rebuild-overlay">
      <div className="rebuild-card">
        <div className="rebuild-title">{failed ? 'Rebuild failed' : 'Rebuilding Orbit…'}</div>
        {!failed && (
          <>
            <div className="rebuild-progress">
              <div className="rebuild-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="rebuild-progress-info">
              <span className="rebuild-progress-pct">{Math.round(pct)}%</span>
              <span className="rebuild-progress-text">{progress.line}</span>
            </div>
          </>
        )}
        {failed && (
          <>
            <pre className="rebuild-error-output">{progress.errorOutput || 'Build exited with an error.'}</pre>
            <div className="rebuild-actions">
              <button onClick={onDismiss}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
