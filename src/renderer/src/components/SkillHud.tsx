import { useEffect, useState } from 'react'
import type { SessionState } from '../session-model'

interface Props {
  session: SessionState | null
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The "you are here" heads-up for the focused session: a bold, skill-coloured card that makes
 * an active skill impossible to miss, shows how long it's been running, the trail of skills the
 * agent moved through, and the live plan (TodoWrite) as a road with the current step pulsing.
 * Renders nothing when there's neither an active skill nor a plan.
 */
export function SkillHud({ session }: Props): JSX.Element | null {
  const [, setTick] = useState(0)
  const startedAt = session?.skillStartedAt ?? null
  // tick once a second while a skill is running so the elapsed timer stays live
  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!session) return null
  const { activeSkill, skillRuns, todos } = session
  if (!activeSkill && todos.length === 0) return null

  const done = todos.filter((t) => t.status === 'completed').length
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0
  const trail = skillRuns.slice(-4)

  return (
    <div className={`skill-hud ${activeSkill ? 'live' : ''}`}>
      <div className="sh-head">
        <span className="sh-glyph">{activeSkill ? '✦' : '▣'}</span>
        <span className="sh-title">{activeSkill ?? 'Plan'}</span>
        {startedAt != null && <span className="sh-time">{fmtElapsed(Date.now() - startedAt)}</span>}
      </div>

      {trail.length > 1 && (
        <div className="sh-trail" title="skills this turn">
          {trail.map((r, i) => (
            <span key={r.key} className={`sh-crumb ${i === trail.length - 1 ? 'current' : ''}`}>
              {i > 0 && <span className="sh-arrow">›</span>}
              {r.name}
            </span>
          ))}
        </div>
      )}

      {todos.length > 0 && (
        <>
          <div className="sh-road">
            {todos.map((t, i) => (
              <div key={i} className={`sh-step ${t.status}`}>
                <span className="sh-step-dot">
                  {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'}
                </span>
                <span className="sh-step-text">
                  {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
                </span>
              </div>
            ))}
          </div>
          <div className="sh-progress" title={`${done}/${todos.length} done`}>
            <div className="sh-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  )
}
