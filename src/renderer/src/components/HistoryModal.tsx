import type { HistoryEntry } from '../../../shared/events'

function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d ago`
  return new Date(ts).toLocaleDateString()
}

interface Props {
  projectName: string
  entries: HistoryEntry[]
  loading: boolean
  openIds: Set<string>
  onPick: (entry: HistoryEntry) => void
  onClose: () => void
}

export function HistoryModal({ projectName, entries, loading, openIds, onPick, onClose }: Props): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>History — {projectName}</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="history-list">
          {loading && <div className="history-empty">reading transcripts…</div>}
          {!loading && entries.length === 0 && <div className="history-empty">no past conversations here</div>}
          {!loading &&
            entries.map((e) => {
              const open = openIds.has(e.sessionId)
              return (
                <div key={e.sessionId} className="history-row" onClick={() => onPick(e)} title={e.sessionId}>
                  <span className="history-title">{e.title}</span>
                  <span className="history-meta">
                    {open && <span className="history-open">open</span>}
                    {relTime(e.updatedAt)}
                  </span>
                </div>
              )
            })}
        </div>
        <div className="history-foot">click a conversation to resume it in a new tab</div>
      </div>
    </div>
  )
}
