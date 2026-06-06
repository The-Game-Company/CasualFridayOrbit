import { useEffect, useRef, useState } from 'react'
import type { FileNode, KeyDoc } from '../../../shared/events'

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
function fileIcon(name: string): string {
  const e = ext(name)
  const n = name.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'].includes(e)) return '🖼'
  if (['md', 'mdx', 'markdown'].includes(e)) return '✎'
  if (e === 'json' || e === 'jsonc') return '{}'
  if (e === 'jsonl' || e === 'ndjson') return '{…}'
  if (e === 'csv' || e === 'tsv') return '⊞'
  if (e === 'diff' || e === 'patch') return '±'
  if (e === 'log') return '▤'
  if (n === '.env' || n.startsWith('.env.') || e === 'env') return '🔑'
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(e)) return '⚙'
  if (['sh', 'bash', 'zsh', 'fish', 'ps1'].includes(e)) return '$'
  if (e === 'sql') return '⊛'
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'rb', 'swift'].includes(e)) return '<>'
  if (['html', 'htm', 'css', 'scss', 'sass', 'less'].includes(e)) return '</>'
  if (e === 'xml') return '<x>'
  return '·'
}

function shortAgent(name: string): string {
  return name.replace(/^claude-\d{4}-\d{2}-\d{2}-/, '')
}

// ─── normal (lazy) tree ──────────────────────────────────────────────────────

interface NodeProps {
  node: FileNode
  depth: number
  busy: Set<string>
  recent: Set<string>
  gitChanged: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

function Node({ node, depth, busy, recent, gitChanged, isLeased, onOpenFile }: NodeProps): JSX.Element {
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
            <Node key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} gitChanged={gitChanged} isLeased={isLeased} onOpenFile={onOpenFile} />
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
  const isGitChanged = gitChanged.has(node.path)
  const leased = isLeased(node.path)
  return (
    <div
      className={`ctx-row file ${isBusy ? 'busy' : ''} ${isRecent ? 'recent' : ''} ${isGitChanged ? 'git-changed' : ''}`}
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

// ─── search results tree (always-expanded pruned tree) ───────────────────────

interface VNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children: VNode[]
}

function buildSearchTree(files: FileNode[], root: string): VNode[] {
  const sep = root.includes('\\') ? '\\' : '/'
  const dirMap = new Map<string, VNode>()
  const roots: VNode[] = []

  for (const file of files) {
    const rel = file.path.slice(root.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
    const parts = rel.split('/')
    let parentChildren = roots
    let currentPath = root

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath + sep + parts[i]
      let dir = dirMap.get(currentPath)
      if (!dir) {
        dir = { name: parts[i], path: currentPath, type: 'dir', children: [] }
        dirMap.set(currentPath, dir)
        parentChildren.push(dir)
      }
      parentChildren = dir.children
    }

    parentChildren.push({ name: parts[parts.length - 1], path: file.path, type: 'file', children: [] })
  }

  return roots
}

interface SearchNodeProps {
  node: VNode
  depth: number
  busy: Set<string>
  recent: Set<string>
  gitChanged: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

function SearchNode({ node, depth, busy, recent, gitChanged, isLeased, onOpenFile }: SearchNodeProps): JSX.Element {
  const pad = { paddingLeft: 8 + depth * 12 }

  if (node.type === 'dir') {
    return (
      <>
        <div className="ctx-row dir" style={pad}>
          <span className="ctx-caret">▾</span>
          {node.name}
        </div>
        {node.children.map((c) => (
          <SearchNode key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} gitChanged={gitChanged} isLeased={isLeased} onOpenFile={onOpenFile} />
        ))}
      </>
    )
  }

  const isBusy = busy.has(node.path)
  const isRecent = recent.has(node.path)
  const isGitChanged = gitChanged.has(node.path)
  const leased = isLeased(node.path)
  return (
    <div
      className={`ctx-row file ${isBusy ? 'busy' : ''} ${isRecent ? 'recent' : ''} ${isGitChanged ? 'git-changed' : ''}`}
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

// ─── recents panel ───────────────────────────────────────────────────────────

const CONTEXT_NAMES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json'])
const COORD_NAMES = new Set(['WIP.md', 'STATUS.md', 'INITIATIVES.md', 'ASSISTANT_RULES.md'])

function docTag(name: string): 'ctx' | 'coord' | 'doc' {
  if (CONTEXT_NAMES.has(name)) return 'ctx'
  if (COORD_NAMES.has(name)) return 'coord'
  return 'doc'
}

const RECENTS_HEIGHT_KEY = 'orbit.recentsHeight'
const RECENTS_OPEN_KEY = 'orbit.recentsOpen'
const RECENTS_PIN_KEY = 'orbit.recentsPin'
const DEFAULT_RECENTS_HEIGHT = 220
const MIN_TREE_HEIGHT = 80
const MIN_RECENTS_HEIGHT = 56

function fileParts(path: string, root: string | null): { name: string; dir: string } {
  const norm = path.replace(/\\/g, '/')
  const name = norm.split('/').pop() ?? path
  const normRoot = root ? root.replace(/\\/g, '/') : ''
  const rel = normRoot && norm.startsWith(normRoot) ? norm.slice(normRoot.length).replace(/^\//, '') : norm
  const parts = rel.split('/')
  const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
  return { name, dir }
}

interface RecentsPanelProps {
  items: string[]
  root: string | null
  busy: Set<string>
  isLeased: (path: string) => boolean
  getBusyAgent: (path: string) => string | null
  getLeasedBy: (path: string) => string | null
  onOpenFile: (path: string) => void
  pinnedTags: Map<string, 'ctx' | 'coord' | 'doc'>
}

function RecentsPanel({ items, root, busy, isLeased, getBusyAgent, getLeasedBy, onOpenFile, pinnedTags }: RecentsPanelProps): JSX.Element {
  if (items.length === 0) {
    return <div className="ctx-empty">no recent files yet</div>
  }
  return (
    <>
      {items.map((path) => {
        const { name, dir } = fileParts(path, root)
        const isBusy = busy.has(path)
        const leased = isLeased(path)
        const agentFromBusy = isBusy ? getBusyAgent(path) : null
        const agentFromLease = leased ? getLeasedBy(path) : null
        const rawAgent = agentFromBusy ?? agentFromLease
        const agentName = rawAgent ? shortAgent(rawAgent) : null
        const inProgress = isBusy || leased
        return (
          <div
            key={path}
            className={`ft-recent-item${inProgress ? ' in-progress' : ''}`}
            onClick={() => onOpenFile(path)}
            title={path}
          >
            <span className={`ft-recent-icon${isBusy ? ' busy' : ''}`}>
              {isBusy ? '✱' : fileIcon(name)}
            </span>
            <div className="ft-recent-info">
              <div className="ft-recent-row1">
                <span className="ft-recent-name">{name}</span>
                {pinnedTags.has(path) && (
                  <span className={`ft-recent-tag ft-recent-tag-${pinnedTags.get(path)}`}>
                    {pinnedTags.get(path)}
                  </span>
                )}
                {leased && !isBusy && <span className="ft-recent-lock" title="held by an agent lease">🔒</span>}
              </div>
              {dir && <div className="ft-recent-dir">{dir}</div>}
              {agentName && <div className="ft-recent-agent">{agentName}</div>}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ─── container ───────────────────────────────────────────────────────────────

interface Props {
  root: string | null
  busy: Set<string>
  recent: Set<string>
  recentOrdered: string[]
  gitChanged: Set<string>
  isLeased: (path: string) => boolean
  getLeasedBy: (path: string) => string | null
  getBusyAgent: (path: string) => string | null
  onOpenFile: (path: string) => void
  keyDocs?: KeyDoc[]
}

export function FileTree({ root, busy, recent, recentOrdered, gitChanged, isLeased, getLeasedBy, getBusyAgent, onOpenFile, keyDocs }: Props): JSX.Element {
  const [top, setTop] = useState<FileNode[] | null>(null)
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [results, setResults] = useState<FileNode[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [regexError, setRegexError] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchIdRef = useRef(0)

  const [pinContext, setPinContext] = useState<boolean>(() => {
    return localStorage.getItem(RECENTS_PIN_KEY) === 'true'
  })

  const [recentsHeight, setRecentsHeight] = useState<number>(() => {
    const v = localStorage.getItem(RECENTS_HEIGHT_KEY)
    return v ? Math.max(MIN_RECENTS_HEIGHT, parseInt(v, 10)) : DEFAULT_RECENTS_HEIGHT
  })
  const [recentsOpen, setRecentsOpen] = useState<boolean>(() => {
    return localStorage.getItem(RECENTS_OPEN_KEY) !== 'false'
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    setTop(null)
    setResults(null)
    setQuery('')
    if (root) window.orbit.readDir(root).then(setTop)
  }, [root])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (!trimmed || !root) {
      setResults(null)
      setSearching(false)
      setRegexError(false)
      return
    }
    if (useRegex) {
      try { new RegExp(trimmed) } catch {
        setRegexError(true)
        setSearching(false)
        return
      }
    }
    setRegexError(false)
    setSearching(true)
    const id = ++searchIdRef.current
    debounceRef.current = setTimeout(() => {
      window.orbit.searchFiles(root, trimmed, useRegex).then((files) => {
        if (searchIdRef.current !== id) return
        setResults(files)
        setSearching(false)
      })
    }, 150)
  }, [query, useRegex, root])

  const trimmed = query.trim()
  const searchTree = trimmed && results && root ? buildSearchTree(results, root) : null

  // files to show in recents: currently busy (not yet in recent) + recently completed
  const recentItems = [
    ...Array.from(busy).filter((p) => !recentOrdered.includes(p)),
    ...recentOrdered
  ]

  // pinned context/coord files from keyDocs, prepended (no duplicates)
  const pinnedTags = new Map<string, 'ctx' | 'coord' | 'doc'>()
  if (pinContext && keyDocs) {
    for (const doc of keyDocs) pinnedTags.set(doc.path, docTag(doc.name))
  }
  const pinnedOnly = pinContext && keyDocs
    ? keyDocs.map((d) => d.path).filter((p) => !recentItems.includes(p))
    : []
  const panelItems = [...pinnedOnly, ...recentItems]

  const activeCount = panelItems.filter((p) => busy.has(p) || isLeased(p)).length

  function onDividerMouseDown(e: React.MouseEvent): void {
    e.preventDefault()
    if (!recentsOpen) {
      setRecentsOpen(true)
      localStorage.setItem(RECENTS_OPEN_KEY, 'true')
      return
    }
    dragRef.current = { startY: e.clientY, startH: recentsHeight }
    const onMove = (ev: MouseEvent): void => {
      if (!dragRef.current || !wrapRef.current) return
      const wrapH = wrapRef.current.getBoundingClientRect().height
      const delta = dragRef.current.startY - ev.clientY
      const maxH = wrapH - MIN_TREE_HEIGHT - 30
      const newH = Math.min(maxH, Math.max(MIN_RECENTS_HEIGHT, dragRef.current.startH + delta))
      setRecentsHeight(newH)
      localStorage.setItem(RECENTS_HEIGHT_KEY, String(Math.round(newH)))
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function toggleRecents(): void {
    const next = !recentsOpen
    setRecentsOpen(next)
    localStorage.setItem(RECENTS_OPEN_KEY, String(next))
  }

  return (
    <div className="file-tree-wrap" ref={wrapRef}>
      <div className="file-search-bar">
        <input
          className={`file-search-input${regexError ? ' error' : ''}`}
          placeholder="search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {searching && <span className="file-search-spinner" />}
        <button
          className={`file-search-regex${useRegex ? ' on' : ''}`}
          onClick={() => setUseRegex((v) => !v)}
          title="Toggle regex"
        >
          .*
        </button>
      </div>

      <div className="ft-tree-body">
        {trimmed ? (
          <div className={`tree-scroll${searching ? ' search-stale' : ''}`}>
            {regexError && <div className="ctx-empty">invalid regex</div>}
            {!regexError && !searching && results?.length === 0 && (
              <div className="ctx-empty">no matches</div>
            )}
            {searchTree?.map((n) => (
              <SearchNode
                key={n.path}
                node={n}
                depth={0}
                busy={busy}
                recent={recent}
                gitChanged={gitChanged}
                isLeased={isLeased}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : (
          <>
            {!root && <div className="ctx-empty">open a project</div>}
            {root && top === null && <div className="ctx-empty">reading files…</div>}
            {top && (
              <div className="tree-scroll">
                {top.map((n) => (
                  <Node
                    key={n.path}
                    node={n}
                    depth={0}
                    busy={busy}
                    recent={recent}
                    gitChanged={gitChanged}
                    isLeased={isLeased}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="ft-divider" onMouseDown={onDividerMouseDown} title="Drag to resize recents" />

      <div className="ft-recents-section">
        <div className="ft-recents-head" onClick={toggleRecents}>
          <span className="ft-recents-caret">{recentsOpen ? '▾' : '▸'}</span>
          <span className="ft-recents-label">RECENTS</span>
          {keyDocs && keyDocs.length > 0 && (
            <label
              className={`ft-pin-toggle${pinContext ? ' on' : ''}`}
              title="Pin context & coordination files (CLAUDE.md, WIP.md, …)"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={pinContext}
                onChange={(e) => {
                  const v = e.target.checked
                  setPinContext(v)
                  localStorage.setItem(RECENTS_PIN_KEY, String(v))
                }}
              />
              ctx files
            </label>
          )}
          {activeCount > 0 && (
            <span className="ft-recents-badge">{activeCount} active</span>
          )}
        </div>
        {recentsOpen && (
          <div className="ft-recents-body" style={{ height: recentsHeight }}>
            <RecentsPanel
              items={panelItems}
              root={root}
              busy={busy}
              isLeased={isLeased}
              getBusyAgent={getBusyAgent}
              getLeasedBy={getLeasedBy}
              onOpenFile={onOpenFile}
              pinnedTags={pinnedTags}
            />
          </div>
        )}
      </div>
    </div>
  )
}
