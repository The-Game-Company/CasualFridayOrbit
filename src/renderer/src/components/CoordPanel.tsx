import type { CoordState } from '../../../shared/events'

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
}

export function CoordPanel({ coord }: { coord: CoordState | null }): JSX.Element {
  if (!coord) return <div className="ctx-empty">open a project</div>
  const { leases, wip, takeovers } = coord
  return (
    <div className="coord">
      <div className="coord-section">
        <div className="coord-h">LEASES ({leases.length})</div>
        {leases.length === 0 && <div className="coord-empty">no active leases</div>}
        {leases.map((l) => (
          <div key={l.resource} className={`coord-lease ${l.stale ? 'stale' : ''}`}>
            <span className="coord-res" title={l.resource}>
              {l.resource}
            </span>
            <span className="coord-agent" title={l.intent}>
              {l.agent}
            </span>
            <span className="coord-age" title={`expires after ${fmtAge(l.expirySec)}`}>
              {l.stale ? '⚠ stale ' : ''}
              {fmtAge(l.ageSec)}
            </span>
          </div>
        ))}
      </div>

      <div className="coord-section">
        <div className="coord-h">WIP — ACTIVE ({wip.length})</div>
        {wip.length === 0 && <div className="coord-empty">no agents registered</div>}
        {wip.map((w, i) => (
          <div key={i} className="coord-wip">
            <div className="coord-wip-head">
              <span className="coord-agent">{w.agent}</span>
              {w.initiative && <span className="coord-init">{w.initiative}</span>}
            </div>
            {w.title && <div className="coord-wip-title">{w.title}</div>}
            {w.status && <div className="coord-wip-status">{w.status}</div>}
            {w.scope && <div className="coord-wip-scope" title={w.scope}>{w.scope}</div>}
          </div>
        ))}
      </div>

      {takeovers.length > 0 && (
        <div className="coord-section">
          <div className="coord-h">RECENT TAKEOVERS</div>
          {takeovers.map((t, i) => (
            <div key={i} className="coord-takeover">
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
