import { useEffect, useRef, useState } from 'react'
import { startPathDrag } from './drag'
import type { FileNode, KeyDoc } from '../../../shared/events'
import { SEARCH_RESULT_CAP } from '../../../shared/limits'

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

/**
 * Render `text` with the letters that the active search caught wrapped in <mark>,
 * so the match is self-explanatory. In token mode each whitespace-separated term is
 * highlighted wherever it occurs; in regex mode the regex's matches are highlighted.
 */
function highlightName(text: string, terms: string[], re: RegExp | null): JSX.Element {
  const ranges: Array<[number, number]> = []
  if (re) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++ // zero-width match — step forward so we don't loop forever
        continue
      }
      ranges.push([m.index, m.index + m[0].length])
    }
  } else if (terms.length) {
    const lower = text.toLowerCase()
    for (const t of terms) {
      let from = 0
      let idx: number
      while ((idx = lower.indexOf(t, from)) !== -1) {
        ranges.push([idx, idx + t.length])
        from = idx + t.length
      }
    }
  }
  if (ranges.length === 0) return <>{text}</>

  // Merge overlapping/adjacent ranges so nested terms don't produce broken <mark>s.
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }

  const parts: JSX.Element[] = []
  let cursor = 0
  merged.forEach(([s, e], i) => {
    if (cursor < s) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>)
    parts.push(<mark key={`m${i}`} className="ft-match">{text.slice(s, e)}</mark>)
    cursor = e
  })
  if (cursor < text.length) parts.push(<span key="end">{text.slice(cursor)}</span>)
  return <>{parts}</>
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
  revealPath?: string | null
}

function Node({ node, depth, busy, recent, gitChanged, isLeased, onOpenFile, revealPath }: NodeProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const pad = { paddingLeft: 8 + depth * 12 }
  const selfRef = useRef<HTMLDivElement>(null)

  const isAncestor = revealPath != null && revealPath !== node.path && (revealPath.startsWith(node.path + '/') || revealPath.startsWith(node.path + '\\'))
  const isTarget = revealPath === node.path

  useEffect(() => {
    if (isAncestor && !open) {
      setOpen(true)
      if (children === null) window.orbit.readDir(node.path).then(setChildren)
    }
  }, [isAncestor])

  useEffect(() => {
    if (isTarget && selfRef.current) {
      selfRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isTarget])

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && children === null) window.orbit.readDir(node.path).then(setChildren)
  }

  const contextMenu = menu && (
    <>
      <div className="context-menu-backdrop" onClick={() => setMenu(null)} />
      <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
        <div className="dropdown-item" onClick={() => { setMenu(null); void window.orbit.openInExplorer(node.path) }}>Open in Folder</div>
      </div>
    </>
  )

  if (node.type === 'dir') {
    return (
      <>
        <div
          ref={isTarget ? selfRef : undefined}
          className={`ctx-row dir${isTarget ? ' ft-reveal-target' : ''}`}
          style={pad}
          onClick={toggle}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        >
          <span className="ctx-caret">{open ? '▾' : '▸'}</span>
          {node.name}
        </div>
        {contextMenu}
        {open &&
          children?.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} gitChanged={gitChanged} isLeased={isLeased} onOpenFile={onOpenFile} revealPath={revealPath} />
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
    <>
      <div
        ref={isTarget ? selfRef : undefined}
        className={`ctx-row file ${isBusy ? 'busy' : ''} ${isRecent ? 'recent' : ''} ${isGitChanged ? 'git-changed' : ''}${isTarget ? ' ft-reveal-target' : ''}`}
        style={pad}
        draggable
        onDragStart={(e) => startPathDrag(e, node.path)}
        onClick={() => onOpenFile(node.path)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        title={leased ? `${node.path} — leased by another agent` : node.path}
      >
        <span className="ctx-icon">{isBusy ? '✱' : fileIcon(node.name)}</span>
        {node.name}
        {leased && <span className="ctx-lock" title="held by an agent lease">🔒</span>}
      </div>
      {contextMenu}
    </>
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
  onGoTo: (path: string) => void
  terms: string[]
  highlightRe: RegExp | null
  // Collapse state is owned by the FileTree container (not local useState) so it survives the
  // frequent re-renders driven by streaming agent activity (busy/recent/gitChanged churn).
  collapsed: Set<string>
  onToggle: (path: string) => void
}

function SearchNode({ node, depth, busy, recent, gitChanged, isLeased, onOpenFile, onGoTo, terms, highlightRe, collapsed, onToggle }: SearchNodeProps): JSX.Element {
  const pad = { paddingLeft: 8 + depth * 12 }
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  if (node.type === 'dir') {
    const open = !collapsed.has(node.path)
    return (
      <>
        <div className="ctx-row dir" style={pad} onClick={() => onToggle(node.path)}>
          <span className="ctx-caret">{open ? '▾' : '▸'}</span>
          {highlightName(node.name, terms, highlightRe)}
        </div>
        {open &&
          node.children.map((c) => (
            <SearchNode key={c.path} node={c} depth={depth + 1} busy={busy} recent={recent} gitChanged={gitChanged} isLeased={isLeased} onOpenFile={onOpenFile} onGoTo={onGoTo} terms={terms} highlightRe={highlightRe} collapsed={collapsed} onToggle={onToggle} />
          ))}
      </>
    )
  }

  const isBusy = busy.has(node.path)
  const isRecent = recent.has(node.path)
  const isGitChanged = gitChanged.has(node.path)
  const leased = isLeased(node.path)
  return (
    <>
      <div
        className={`ctx-row file ${isBusy ? 'busy' : ''} ${isRecent ? 'recent' : ''} ${isGitChanged ? 'git-changed' : ''}`}
        style={pad}
        draggable
        onDragStart={(e) => startPathDrag(e, node.path)}
        onClick={() => onOpenFile(node.path)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        title={leased ? `${node.path} — leased by another agent` : node.path}
      >
        <span className="ctx-icon">{isBusy ? '✱' : fileIcon(node.name)}</span>
        {highlightName(node.name, terms, highlightRe)}
        {leased && <span className="ctx-lock" title="held by an agent lease">🔒</span>}
      </div>
      {menu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setMenu(null)} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="dropdown-item" onClick={() => { setMenu(null); onGoTo(node.path) }}>Go To in Tree</div>
            <div className="dropdown-item" onClick={() => { setMenu(null); void window.orbit.openInExplorer(node.path) }}>Open in Folder</div>
          </div>
        </>
      )}
    </>
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
            draggable
            onDragStart={(e) => startPathDrag(e, path)}
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
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const [regexError, setRegexError] = useState(false)
  // Paths of directories the user has collapsed in the search-results tree. Owned here (not in
  // each SearchNode) so a collapse survives re-renders triggered by streaming agent activity.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchIdRef = useRef(0)

  const toggleCollapsed = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

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
    if (revealPath == null) return
    const t = setTimeout(() => setRevealPath(null), 2000)
    return () => clearTimeout(t)
  }, [revealPath])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (!trimmed || !root) {
      setResults(null)
      setSearching(false)
      setRegexError(false)
      setCollapsed(new Set()) // closing the search resets the collapsed-dir set
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

  // What to highlight in result names: each whitespace term (token mode) or the regex's
  // matches (regex mode). Mirrors the matching logic in search-worker.ts.
  const terms = !useRegex && trimmed ? trimmed.toLowerCase().split(/\s+/).filter(Boolean) : []
  let highlightRe: RegExp | null = null
  if (useRegex && trimmed && !regexError) {
    try {
      highlightRe = new RegExp(trimmed, 'gi')
    } catch {
      highlightRe = null
    }
  }

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
          placeholder={useRegex ? 'search files (regex)…' : 'search files — e.g. apple document'}
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
        {searching && <div className="file-search-progress"><div className="file-search-progress-bar" /></div>}
      </div>

      <div className="ft-tree-body">
        {trimmed ? (
          <div className={`tree-scroll${searching ? ' search-stale' : ''}`}>
            {regexError && <div className="ctx-empty">invalid regex</div>}
            {!regexError && !searching && results?.length === 0 && (
              <div className="ctx-empty">no matches</div>
            )}
            {!regexError && results && results.length >= SEARCH_RESULT_CAP && (
              <div className="ft-search-capped">
                showing first {SEARCH_RESULT_CAP} matches — refine your search
              </div>
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
                onGoTo={(path) => { setQuery(''); setRevealPath(path) }}
                terms={terms}
                highlightRe={highlightRe}
                collapsed={collapsed}
                onToggle={toggleCollapsed}
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
                    revealPath={revealPath}
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
