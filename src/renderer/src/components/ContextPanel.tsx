import { useState } from 'react'
import type { ContextNode } from '../../../shared/events'

function iconFor(node: ContextNode): string {
  if (node.type === 'dir') return '▸'
  if (node.name.endsWith('.md')) return '✎'
  if (node.name.endsWith('.json')) return '{}'
  return '·'
}

interface NodeProps {
  node: ContextNode
  depth: number
  busy: Set<string>
  recent: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

function Node({ node, depth, busy, recent, isLeased, onOpenFile }: NodeProps): JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: 8 + depth * 12 }
  if (node.type === 'dir') {
    return (
      <>
        <div className="ctx-row dir" style={pad} onClick={() => setOpen((o) => !o)}>
          <span className="ctx-caret">{open ? '▾' : '▸'}</span>
          {node.name}
        </div>
        {open &&
          node.children?.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} isLeased={isLeased} onOpenFile={onOpenFile} />
          ))}
      </>
    )
  }
  const isBusy = busy.has(node.path)
  const isRecent = recent.has(node.path)
  const leased = isLeased(node.path)
  return (
    <div
      className={`ctx-row file ${isBusy ? 'busy' : ''} ${isRecent ? 'recent' : ''}`}
      style={pad}
      onClick={() => onOpenFile(node.path)}
      title={leased ? `${node.path} — leased by another agent` : node.path}
    >
      <span className="ctx-icon">{isBusy ? '✱' : iconFor(node)}</span>
      {node.name}
      {leased && <span className="ctx-lock" title="held by an agent lease">🔒</span>}
    </div>
  )
}

interface Props {
  tree: ContextNode[]
  busy: Set<string>
  recent: Set<string>
  active: boolean
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

export function ContextPanel({ tree, busy, recent, active, isLeased, onOpenFile }: Props): JSX.Element {
  if (!active) return <div className="ctx-empty">open a project</div>
  if (tree.length === 0) return <div className="ctx-empty">no CLAUDE.md / .claude here</div>
  return (
    <div className="tree-scroll">
      {tree.map((n) => (
        <Node key={n.path} node={n} depth={0} busy={busy} recent={recent} isLeased={isLeased} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}
