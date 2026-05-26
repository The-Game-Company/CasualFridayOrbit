import type { ActivityItem } from '../session-model'

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false })
}

export function Activity({ items }: { items: ActivityItem[] }): JSX.Element {
  return (
    <div className="panel activity">
      <div className="panel-head">
        <span>ACTIVITY</span>
      </div>
      <div className="activity-list">
        {items.length === 0 && <div className="activity-empty">events appear as Claude works</div>}
        {items.map((it) => (
          <div key={it.id} className={`activity-row kind-${it.kind}`}>
            <span className="activity-time">{clock(it.ts)}</span>
            <span className="activity-icon">{it.icon}</span>
            <span className="activity-label">{it.label}</span>
            {it.detail && <span className="activity-detail">{it.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
