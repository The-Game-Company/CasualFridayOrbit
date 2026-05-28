import { useState } from 'react'
import type { McpServer } from '../../../shared/events'

interface Props {
  servers: McpServer[]
  /** server names whose tools the focused session is using this turn (live "in-use" highlight) */
  activeMcp: string[]
  /** open a config file (the .mcp.json / ~/.claude.json that defines a server) in the editor */
  onOpenFile: (path: string) => void
}

const SCOPE_LABEL: Record<McpServer['scope'], string> = {
  project: 'proj',
  local: 'local',
  user: 'user'
}

/** A compact, space-frugal MCP browser that sits beside the skills list. Each row carries a
 *  status dot (live / enabled / disabled); clicking a row expands its details and offers to
 *  open the backing config file for editing. */
export function McpPanel({ servers, activeMcp, onOpenFile }: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const live = new Set(activeMcp)

  return (
    <div className="panel mcp-panel">
      <div className="panel-head">
        <span>MCP</span>
        <span className="panel-head-sub">{servers.length}</span>
      </div>
      <div className="mcp-list">
        {servers.length === 0 && <div className="skills-empty">no MCP servers configured</div>}
        {servers.map((m) => {
          const isLive = live.has(m.name)
          const state = isLive ? 'live' : m.enabled ? 'on' : 'off'
          const expanded = open === m.name
          const endpoint = m.transport === 'stdio' ? m.command ?? '' : m.url ?? ''
          return (
            <div key={m.name + m.scope} className={`mcp-item ${expanded ? 'expanded' : ''}`}>
              <div
                className={`mcp-row state-${state}`}
                onClick={() => setOpen(expanded ? null : m.name)}
                title={
                  isLive
                    ? `${m.name} — in use now`
                    : m.enabled
                      ? `${m.name} — enabled (${m.transport})`
                      : `${m.name} — disabled`
                }
              >
                <span className={`mcp-dot ${state}`} />
                <span className="mcp-name">{m.name}</span>
                <span className={`mcp-scope scope-${m.scope}`}>{SCOPE_LABEL[m.scope]}</span>
              </div>
              {expanded && (
                <div className="mcp-detail">
                  <div className="mcp-meta">
                    <span className="mcp-tag">{m.transport}</span>
                    <span className={`mcp-tag ${m.enabled ? 'ok' : 'muted'}`}>
                      {isLive ? 'in use' : m.enabled ? 'enabled' : 'disabled'}
                    </span>
                    <span className="mcp-tag muted">{SCOPE_LABEL[m.scope]}</span>
                  </div>
                  {endpoint && (
                    <div className="mcp-line">
                      <span className="mcp-key">{m.transport === 'stdio' ? 'cmd' : 'url'}</span>
                      <code>
                        {endpoint}
                        {m.transport === 'stdio' && m.args?.length ? ' ' + m.args.join(' ') : ''}
                      </code>
                    </div>
                  )}
                  {m.envKeys && m.envKeys.length > 0 && (
                    <div className="mcp-line">
                      <span className="mcp-key">env</span>
                      <code>{m.envKeys.join(', ')}</code>
                    </div>
                  )}
                  <div className="mcp-line">
                    <span className="mcp-key">file</span>
                    <code title={m.configPath}>{m.configPath.split(/[\\/]/).pop()}</code>
                  </div>
                  <button className="mcp-edit" onClick={() => onOpenFile(m.configPath)}>
                    Edit config
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
