import { useEffect, useRef, useState } from 'react'
import type { FileNode } from '../../../shared/events'

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
function fileIcon(name: string): string {
  const e = ext(name)
  const n = name.toLowerCase()
  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'].includes(e)) return '🖼'
  // Markdown
  if (['md', 'mdx', 'markdown'].includes(e)) return '✎'
  // JSON / JSONL
  if (e === 'json' || e === 'jsonc') return '{}'
  if (e === 'jsonl' || e === 'ndjson') return '{…}'
  // CSV/TSV
  if (e === 'csv' || e === 'tsv') return '⊞'
  // Diff/patch
  if (e === 'diff' || e === 'patch') return '±'
  // Log files
  if (e === 'log') return '▤'
  // .env files
  if (n === '.env' || n.startsWith('.env.') || e === 'env') return '🔑'
  // Config formats
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(e)) return '⚙'
  // Shell scripts
  if (['sh', 'bash', 'zsh', 'fish', 'ps1'].includes(e)) return '$'
  // SQL
  if (e === 'sql') return '⊛'
  // Code files
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'rb', 'swift'].includes(e)) return '<>'
  // HTML/CSS
  if (['html', 'htm', 'css', 'scss', 'sass', 'less'].includes(e)) return '</>'
  // XML
  if (e === 'xml') return '<x>'
  return '·'
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
  // detect separator from root so we reconstruct full paths correctly on Windows
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

// ─── container ───────────────────────────────────────────────────────────────

interface Props {
  root: string | null
  busy: Set<string>
  recent: Set<string>
  gitChanged: Set<string>
  isLeased: (path: string) => boolean
  onOpenFile: (path: string) => void
}

export function FileTree({ root, busy, recent, gitChanged, isLeased, onOpenFile }: Props): JSX.Element {
  const [top, setTop] = useState<FileNode[] | null>(null)
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [results, setResults] = useState<FileNode[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [regexError, setRegexError] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchIdRef = useRef(0)

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
    // don't clear results here — keep showing previous results while worker runs
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

  return (
    <div className="file-tree-wrap">
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
  )
}
