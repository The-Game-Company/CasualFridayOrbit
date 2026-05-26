import type { SubAgent } from '../session-model'

export function SubAgents({ items }: { items: SubAgent[] }): JSX.Element | null {
  if (!items.length) return null
  const running = items.filter((s) => s.status === 'running').length
  return (
    <div className="subagents">
      <div className="panel-head">
        <span>AGENTS</span>
        <span className="panel-head-sub">{running > 0 ? `${running} running` : `${items.length}`}</span>
      </div>
      <div className="subagent-list">
        {items.map((s) => (
          <div key={s.key} className={`subagent ${s.status}`}>
            <span className="subagent-dot" />
            <span className="subagent-type">⬡ {s.type}</span>
            <span className="subagent-desc" title={s.description}>
              {s.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
