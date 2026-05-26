import { useEffect, useState } from 'react'
import type { FileNode } from '../../../shared/events'

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
function fileIcon(name: string): string {
  const e = ext(name)
  if (e === 'md' || e === 'markdown') return '✎'
  if (e === 'json') return '{}'
  if (['ts', 'tsx', 'js', 'jsx', 'cs', 'py', 'go', 'rs', 'c', 'cpp', 'h'].includes(e)) return '<>'
  return '·'
}

interface NodeProps {
  node: FileNode
  depth: number
  busy: Set<string>
  recent: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

function Node({ node, depth, busy, recent, isLeased, onOpenFile }: NodeProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)
  const pad = { paddingLeft: 8 + depth * 12 }

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && children === null) window.orbit.readDir(node.path).then(setChildren)
  }

  if (node.type === 'dir') {
    return (
      <>
        <div className="ctx-row dir" style={pad} onClick={toggle}>
          <span className="ctx-caret">{open ? '▾' : '▸'}</span>
          {node.name}
        </div>
        {open &&
          children?.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} isLeased={isLeased} onOpenFile={onOpenFile} />
          ))}
        {open && children?.length === 0 && (
          <div className="ctx-row muted" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
            empty
          </div>
        )}
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
      <span className="ctx-icon">{isBusy ? '✱' : fileIcon(node.name)}</span>
      {node.name}
      {leased && <span className="ctx-lock" title="held by an agent lease">🔒</span>}
    </div>
  )
}

interface Props {
  root: string | null
  busy: Set<string>
  recent: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

export function FileTree({ root, busy, recent, isLeased, onOpenFile }: Props): JSX.Element {
  const [top, setTop] = useState<FileNode[] | null>(null)

  useEffect(() => {
    setTop(null)
    if (root) window.orbit.readDir(root).then(setTop)
  }, [root])

  if (!root) return <div className="ctx-empty">open a project</div>
  if (top === null) return <div className="ctx-empty">reading files…</div>
  return (
    <div className="tree-scroll">
      {top.map((n) => (
        <Node key={n.path} node={n} depth={0} busy={busy} recent={recent} isLeased={isLeased} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}
