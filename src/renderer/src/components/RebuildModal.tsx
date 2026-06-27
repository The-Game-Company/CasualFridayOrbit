import { useEffect, useRef, useState } from 'react'
import type { RebuildProgress } from '../../../shared/events'

interface Props {
  progress: RebuildProgress
  onDismiss: () => void
}

export function RebuildModal({ progress, onDismiss }: Props): JSX.Element {
  const [displayPct, setDisplayPct] = useState(Math.max(progress.pct, 0))
  const lastRealPct = useRef(Math.max(progress.pct, 0))
  const failed = progress.pct === -1

  useEffect(() => {
    if (progress.pct > 0 && progress.pct > lastRealPct.current) {
      lastRealPct.current = progress.pct
      setDisplayPct(progress.pct)
    }
  }, [progress.pct])

  // Creep slowly forward between known milestones so the bar feels alive
  useEffect(() => {
    if (failed) return
    const t = setInterval(() => {
      setDisplayPct((prev) => {
        const cap = Math.min(lastRealPct.current + 8, 92)
        return prev >= cap ? prev : Math.min(prev + 0.3, cap)
      })
    }, 500)
    return () => clearInterval(t)
  }, [failed])

  return (
    <div className="rebuild-overlay">
      <div className="rebuild-card">
        <div className="rebuild-title">{failed ? 'Rebuild failed' : 'Rebuilding Orbit…'}</div>
        {!failed && (
          <>
            <div className="rebuild-progress">
              <div className="rebuild-progress-bar" style={{ width: `${displayPct}%` }} />
            </div>
            <div className="rebuild-progress-info">
              <span className="rebuild-progress-pct">{Math.round(displayPct)}%</span>
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
