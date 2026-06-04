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

/** Transient per-row restart feedback shown beneath a server. */
interface Feedback {
  text: string
  err: boolean
}

/** A compact, space-frugal MCP browser that sits beside the skills list. Each row carries a
 *  status dot (live / enabled / disabled); clicking a row expands its details and offers to
 *  open the backing config file; right-clicking offers to restart a stdio server's process. */
export function McpPanel({ servers, activeMcp, onOpenFile }: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null)
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const live = new Set(activeMcp)

  const menuServer = menu ? servers.find((s) => s.name === menu.name) : null

  /** Kill the server's OS process(es) so claude respawns it, then surface the outcome inline. */
  async function restart(server: McpServer): Promise<void> {
    setMenu(null)
    const r = await window.orbit.restartMcp(server)
    const text = !r.ok
      ? r.error ?? 'restart failed'
      : r.killed > 0
        ? `restarted (${r.killed} killed)`
        : 'no running process found'
    setFeedback((f) => ({ ...f, [server.name]: { text, err: !r.ok } }))
    setTimeout(() => {
      setFeedback((f) => {
        const { [server.name]: _, ...rest } = f
        return rest
      })
    }, 5000)
  }

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
          const fb = feedback[m.name]
          return (
            <div key={m.name + m.scope} className={`mcp-item ${expanded ? 'expanded' : ''}`}>
              <div
                className={`mcp-row state-${state}`}
                onClick={() => setOpen(expanded ? null : m.name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ name: m.name, x: e.clientX, y: e.clientY })
                }}
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
              {fb && <div className={`mcp-feedback ${fb.err ? 'err' : ''}`}>{fb.text}</div>}
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

      {menu && menuServer && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            {menuServer.transport === 'stdio' ? (
              <div className="dropdown-item" onClick={() => restart(menuServer)}>
                ↻ Restart server
              </div>
            ) : (
              <div
                className="dropdown-item disabled"
                title="remote servers can't be restarted locally"
              >
                ↻ Restart server
              </div>
            )}
            <div
              className="dropdown-item"
              onClick={() => {
                onOpenFile(menuServer.configPath)
                setMenu(null)
              }}
            >
              Edit config
            </div>
          </div>
        </>
      )}
    </div>
  )
}
