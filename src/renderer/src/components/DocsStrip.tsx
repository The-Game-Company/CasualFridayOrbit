import type { KeyDoc } from '../../../shared/events'

function rel(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** Quick-nav for a project's always-on docs; click opens them in the editor. */
export function DocsStrip({ docs, onOpen }: { docs: KeyDoc[]; onOpen: (path: string) => void }): JSX.Element | null {
  if (!docs.length) return null
  return (
    <div className="docs-strip">
      {docs.map((d) => (
        <button key={d.path} className="doc-chip" onClick={() => onOpen(d.path)} title={`${d.path} · ${rel(d.mtimeMs)} ago`}>
          {d.name.replace(/\.md$/, '')}
          <span className="doc-age">{rel(d.mtimeMs)}</span>
        </button>
      ))}
    </div>
  )
}
