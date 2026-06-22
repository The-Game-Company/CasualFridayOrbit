import { useState } from 'react'
import type { TermKind } from '../../../shared/events'
import { tabWindows, type SessionState, type SessionStatus, type Tab } from '../session-model'
import { KIND_META, newTabKinds } from '../kind-meta'
import { AgentBadge, StatusDot, UnseenDot } from './indicators'

interface Props {
  /** tabs for the active project (each owns >=1 window) */
  tabs: Tab[]
  /** all sessions, so we can look up each tab's windows */
  sessions: SessionState[]
  activeTabId: string | null
  startedIds: Set<string>
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: (kind: TermKind) => void
  onContext: (tabId: string, x: number, y: number) => void
  canNew: boolean
  /** id of the window currently being dragged (if any) — tabs become drop targets */
  dragWin: string | null
  /** merge the dragged window into this tab */
  onDropWindow: (tabId: string) => void
}

/** Roll a tab's windows up into one status: busy beats waiting beats idle. */
function tabStatus(wins: SessionState[]): SessionStatus {
  if (wins.some((w) => w.status === 'busy')) return 'busy'
  if (wins.some((w) => w.status === 'waiting')) return 'waiting'
  return 'idle'
}

export function TabBar({
  tabs,
  sessions,
  activeTabId,
  startedIds,
  onSelect,
  onClose,
  onNew,
  onContext,
  canNew,
  dragWin,
  onDropWindow
}: Props): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropTab, setDropTab] = useState<string | null>(null)
  const byId = new Map(sessions.map((s) => [s.id, s]))

  const pick = (kind: TermKind): void => {
    setMenu(null)
    onNew(kind)
  }

  return (
    <div className="tabbar">
      {/* native menu bar is hidden — this pops the same File/View menu (shortcuts still work) */}
      <button
        className="tab-menu"
        title="Menu"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          window.orbit.popupAppMenu(r.left, r.bottom + 2)
        }}
      >
        ☰
      </button>
      {tabs.map((t) => {
        const ids = tabWindows(t)
        const wins = ids.map((id) => byId.get(id)).filter((s): s is SessionState => !!s)
        if (!wins.length) return null
        const head = byId.get(t.activeWindow) ?? wins[0]
        const status = tabStatus(wins)
        const agents = wins.reduce((n, w) => n + w.agentsActive, 0)
        const skill = wins.find((w) => w.activeSkill)?.activeSkill ?? null
        const unseen = wins.some((w) => w.unseen)
        const count = wins.length
        // a tab is "paused" (lazy-resume) until at least one of its windows has spawned
        const paused = !ids.some((id) => startedIds.has(id))
        // a dragged window can merge into any tab except the one it already lives in
        const canDrop = !!dragWin && !ids.includes(dragWin)
        return (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? 'active' : ''} ${count > 1 ? 'split' : ''} ${paused ? 'paused' : ''} ${skill ? 'skill' : ''} ${canDrop && dropTab === t.id ? 'drop-target' : ''}`}
            onClick={() => onSelect(t.id)}
            onDragOver={(e) => {
              if (!canDrop) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropTab((prev) => (prev === t.id ? prev : t.id))
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDropTab((prev) => (prev === t.id ? null : prev))
            }}
            onDrop={(e) => {
              if (!canDrop) return
              e.preventDefault()
              setDropTab(null)
              onDropWindow(t.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onContext(t.id, e.clientX, e.clientY)
            }}
            title={
              paused
                ? `${head.title} — paused, click to resume`
                : count > 1
                  ? `${head.title} — ${count} windows · right-click for options`
                  : `${head.title} — right-click for options`
            }
          >
            <span className="tab-kind">{paused ? '⏸' : KIND_META[head.kind].icon}</span>
            <StatusDot status={status} />
            <span className="tab-title">{head.title}</span>
            {head.branchedFrom && (
              <span className="tab-branch" title={`branched from: ${head.branchedFrom}`}>⎇</span>
            )}
            {skill && <span className="tab-skill" title={`running skill: ${skill}`}>✦</span>}
            {count > 1 && <span className="tab-count" title={`${count} windows`}>⊞{count}</span>}
            <AgentBadge n={agents} />
            {unseen && t.id !== activeTabId && <UnseenDot />}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
              title={count > 1 ? `Close tab (${count} windows)` : 'Close tab'}
            >
              ✕
            </button>
          </div>
        )
      })}

      {canNew && (
        <div className="tab-new-wrap">
          <button
            className="tab-new"
            onClick={(e) => {
              if (menu) return setMenu(null)
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom + 4 })
            }}
            title="New tab"
          >
            ＋
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(null)} />
              <div className="dropdown" style={{ position: 'fixed', top: menu.y, left: menu.x }}>
                {newTabKinds(window.orbit.platform).map((k) => (
                  <div key={k} className="dropdown-item" onClick={() => pick(k)}>
                    <span className="dropdown-icon">{KIND_META[k].icon}</span>
                    {KIND_META[k].label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {tabs.length === 0 && <span className="tab-hint">no sessions — pick a project on the left</span>}
    </div>
  )
}
