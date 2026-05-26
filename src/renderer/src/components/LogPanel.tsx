import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogState } from '../../../shared/events'

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export function LogPanel({ log }: { log: LogState | null }): JSX.Element {
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(true)
  const bodyRef = useRef<HTMLPreElement>(null)

  const lines = useMemo(() => {
    const all = log?.content ? log.content.split('\n') : []
    if (!filter.trim()) return all
    const f = filter.toLowerCase()
    return all.filter((l) => l.toLowerCase().includes(f))
  }, [log?.content, filter])

  useEffect(() => {
    if (follow && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, follow])

  if (!log) return <div className="ctx-empty">open a project</div>
  return (
    <div className="logpanel">
      <div className="log-bar">
        <input
          className="log-filter"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="log-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          follow
        </label>
      </div>
      <div className="log-file" title={log.path ?? ''}>
        {log.path ? baseName(log.path) : 'no .log found (PlayLogs / logs / Logs)'}
      </div>
      <pre className="log-body" ref={bodyRef}>
        {lines.join('\n')}
      </pre>
    </div>
  )
}
