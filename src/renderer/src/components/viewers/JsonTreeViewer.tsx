import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'
import { LEAN_EDIT_BYTES } from '../../../../shared/limits'
import { CodeEditor } from './CodeEditor'

// ─── path-based mutation helpers ─────────────────────────────────────────────

type JsonPath = (string | number)[]

function setAtPath(root: unknown, path: JsonPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...tail] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...(root as unknown[])] : []
    arr[head] = setAtPath(arr[head], tail, value)
    return arr
  }
  const obj =
    root && typeof root === 'object' && !Array.isArray(root)
      ? { ...(root as Record<string, unknown>) }
      : ({} as Record<string, unknown>)
  obj[head] = setAtPath(obj[head], tail, value)
  return obj
}

function deleteAtPath(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return undefined
  const [head, ...tail] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...(root as unknown[])] : []
    if (tail.length === 0) {
      arr.splice(head, 1)
      return arr
    }
    arr[head] = deleteAtPath(arr[head], tail)
    return arr
  }
  const obj = { ...(root as Record<string, unknown>) }
  if (tail.length === 0) {
    delete obj[head]
    return obj
  }
  obj[head] = deleteAtPath(obj[head], tail)
  return obj
}

// ─── flat-row model ────────────────────────────────────────────────────────

const ROW_H = 22 // px — must match .jt-vrow height in CSS
const OVERSCAN = 8

/** Stable string id for a node path. Root = ''. */
function pathKey(path: JsonPath): string {
  return path.join(' ')
}

/** How a row is labelled on the left: an object key, an array index, or nothing (root). */
type RowLabel = { kind: 'key'; text: string } | { kind: 'index'; text: string } | undefined

type Row =
  | { kind: 'array'; key: string; path: JsonPath; depth: number; label: RowLabel; open: boolean; count: number }
  | { kind: 'object'; key: string; path: JsonPath; depth: number; label: RowLabel; open: boolean; count: number }
  | { kind: 'leaf'; key: string; path: JsonPath; depth: number; label: RowLabel; value: unknown }
  | { kind: 'add-array'; key: string; path: JsonPath; depth: number; length: number }
  | { kind: 'add-object'; key: string; path: JsonPath; depth: number }

/**
 * Flatten the visible portion of the tree into a list of rows. Collapsed containers are NOT
 * descended into, so this is O(visible rows), not O(document). It is memoized on the parsed
 * value + expansion state, so scrolling never re-runs it.
 */
function buildRows(root: unknown, isOpen: (key: string, depth: number) => boolean): Row[] {
  const rows: Row[] = []

  function pushNode(value: unknown, path: JsonPath, depth: number, label: RowLabel): void {
    const key = pathKey(path)

    if (Array.isArray(value)) {
      const open = isOpen(key, depth)
      rows.push({ kind: 'array', key, path, depth, label, open, count: value.length })
      if (open) {
        for (let i = 0; i < value.length; i++) {
          pushNode(value[i], [...path, i], depth + 1, { kind: 'index', text: String(i) })
        }
        rows.push({ kind: 'add-array', key: key + ' +', path, depth: depth + 1, length: value.length })
      }
      return
    }

    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      const open = isOpen(key, depth)
      rows.push({ kind: 'object', key, path, depth, label, open, count: entries.length })
      if (open) {
        for (const [k, v] of entries) {
          pushNode(v, [...path, k], depth + 1, { kind: 'key', text: k })
        }
        rows.push({ kind: 'add-object', key: key + ' +', path, depth: depth + 1 })
      }
      return
    }

    rows.push({ kind: 'leaf', key, path, depth, label, value })
  }

  pushNode(root, [], 0, undefined)
  return rows
}

// ─── value rendering ─────────────────────────────────────────────────────────

/** Render a leaf value as a coloured, click-to-edit span. Mirrors the old JsonLeaf. */
function LeafValue({ value, onEdit }: { value: unknown; onEdit: () => void }): JSX.Element {
  if (value === null || value === undefined)
    return (
      <span className="jt-null jt-editable jt-val" onClick={onEdit}>
        null
      </span>
    )
  if (typeof value === 'boolean')
    return (
      <span className="jt-bool jt-editable jt-val" onClick={onEdit}>
        {String(value)}
      </span>
    )
  if (typeof value === 'number')
    return (
      <span className="jt-num jt-editable jt-val" onClick={onEdit}>
        {value}
      </span>
    )
  if (typeof value === 'string') {
    const quoted = JSON.stringify(value)
    const display = quoted.length > 120 ? quoted.slice(0, 120) + '…"' : quoted
    return (
      <span
        className="jt-str jt-editable jt-val"
        title={value.length > 120 ? value : undefined}
        onClick={onEdit}
      >
        {display}
      </span>
    )
  }
  return (
    <span className="jt-str jt-editable jt-val" onClick={onEdit}>
      {JSON.stringify(value)}
    </span>
  )
}

/** The label segment of a row: array index or object key + colon. */
function RowLabelSpan({ label }: { label: RowLabel }): JSX.Element | null {
  if (!label) return null
  if (label.kind === 'index') return <span className="jt-idx">{label.text}</span>
  return (
    <>
      <span className="jt-key">{JSON.stringify(label.text)}</span>
      <span className="jt-colon">:</span>
    </>
  )
}

// ─── viewer ────────────────────────────────────────────────────────────────

export function JsonTreeViewer(props: FileViewerProps): JSX.Element {
  const { buffer, mode, onBufferChange, path } = props

  // Only the tree view consumes the parsed object; the edit mode hands the raw string to
  // CodeMirror. Parsing there would re-walk the whole document on every keystroke for nothing.
  const [parsed, parseError] = useMemo<[unknown, string | null]>(() => {
    if (mode !== 'tree') return [null, null]
    if (!buffer.trim()) return [null, 'empty file']
    try {
      return [JSON.parse(buffer), null]
    } catch (e) {
      return [null, (e as Error).message]
    }
  }, [buffer, mode])

  // ── expansion state ──────────────────────────────────────────────────────
  // Big files only auto-open the root so the visible-row list stays bounded; small files
  // auto-expand the top two levels like the old viewer did.
  const autoDepth = buffer.length <= LEAN_EDIT_BYTES ? 2 : 1
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map())

  // Switching to a different file: forget per-node open/closed state, any open inline edit,
  // and the scroll position (otherwise a deep scroll from a large file leaves a smaller file's
  // tree scrolled past its content). setScrollTop/scrollRef/setEditKey/setAddKey are declared
  // below — referenced here from the effect closure, which only runs after render.
  useEffect(() => {
    setOverrides(new Map())
    setEditKey(null)
    setAddKey(null)
    setScrollTop(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [path])

  const isOpen = useCallback(
    (key: string, depth: number): boolean => (overrides.has(key) ? overrides.get(key)! : depth < autoDepth),
    [overrides, autoDepth]
  )

  const toggle = useCallback(
    (key: string, depth: number): void => {
      setOverrides((prev) => {
        const next = new Map(prev)
        const cur = next.has(key) ? next.get(key)! : depth < autoDepth
        next.set(key, !cur)
        return next
      })
    },
    [autoDepth]
  )

  // Flatten only the visible (expanded) part of the tree. Re-runs on expand/collapse/edit,
  // never on scroll.
  const rows = useMemo(() => {
    if (parsed === null && parseError) return []
    return buildRows(parsed, isOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, overrides, autoDepth])

  // ── editing state (lifted so it survives the windowed slice re-rendering) ──
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editRaw, setEditRaw] = useState('')
  const [editInvalid, setEditInvalid] = useState(false)
  // object key-add: the container key whose adder is open + the key-name being typed
  const [addKey, setAddKey] = useState<string | null>(null)
  const [addRaw, setAddRaw] = useState('')

  const editInputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback((key: string, value: unknown): void => {
    setEditKey(key)
    setEditRaw(value === null || value === undefined ? 'null' : JSON.stringify(value))
    setEditInvalid(false)
  }, [])

  const cancelEdit = useCallback((): void => {
    setEditKey(null)
    setEditInvalid(false)
  }, [])

  const commitEdit = useCallback(
    (editPath: JsonPath): void => {
      let parsedValue: unknown
      try {
        parsedValue = JSON.parse(editRaw)
      } catch {
        setEditInvalid(true)
        editInputRef.current?.focus()
        return
      }
      const updated = setAtPath(parsed, editPath, parsedValue)
      setEditKey(null)
      setEditInvalid(false)
      onBufferChange(JSON.stringify(updated, null, 2))
    },
    [editRaw, parsed, onBufferChange]
  )

  const handleDelete = useCallback(
    (deletePath: JsonPath): void => {
      const updated = deleteAtPath(parsed, deletePath)
      onBufferChange(JSON.stringify(updated, null, 2))
    },
    [parsed, onBufferChange]
  )

  const appendItem = useCallback(
    (arrayPath: JsonPath, length: number): void => {
      const updated = setAtPath(parsed, [...arrayPath, length], null)
      onBufferChange(JSON.stringify(updated, null, 2))
    },
    [parsed, onBufferChange]
  )

  const commitAddKey = useCallback(
    (objectPath: JsonPath): void => {
      const k = addRaw.trim()
      if (k) {
        const updated = setAtPath(parsed, [...objectPath, k], null)
        onBufferChange(JSON.stringify(updated, null, 2))
      }
      setAddKey(null)
      setAddRaw('')
    },
    [addRaw, parsed, onBufferChange]
  )

  // ── windowing ──────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewportH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const count = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2
  const last = Math.min(rows.length, first + count)
  const visible = rows.slice(first, last)

  // ── edit mode → CodeMirror, unchanged ──────────────────────────────────────
  if (mode === 'edit') {
    return <CodeEditor {...props} />
  }

  // ── parse error (incl. empty file) → small error line + CodeMirror to fix it ─
  if (parseError) {
    return (
      <div className="viewer-json">
        <div className="jt-parse-error">Parse error: {parseError}</div>
        <CodeEditor {...props} />
      </div>
    )
  }

  // ── tree mode: virtualized flat list ────────────────────────────────────────
  return (
    <div
      className="jt-scroll"
      ref={scrollRef}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div className="jt-spacer" style={{ height: rows.length * ROW_H }}>
        {visible.map((row, i) => {
          const idx = first + i
          const style: React.CSSProperties = {
            top: idx * ROW_H,
            paddingLeft: 8 + row.depth * 16,
          }

          if (row.kind === 'add-array') {
            return (
              <div className="jt-vrow" key={row.key} style={style}>
                <button
                  className="jt-add-btn"
                  onClick={() => appendItem(row.path, row.length)}
                  title="Append item"
                >
                  + item
                </button>
              </div>
            )
          }

          if (row.kind === 'add-object') {
            const adding = addKey === row.key
            return (
              <div className="jt-vrow" key={row.key} style={style}>
                {adding ? (
                  <input
                    className="jt-input jt-key-input"
                    value={addRaw}
                    placeholder="key name"
                    autoFocus
                    onChange={(e) => setAddRaw(e.target.value)}
                    onBlur={() => commitAddKey(row.path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitAddKey(row.path)
                      }
                      if (e.key === 'Escape') {
                        setAddKey(null)
                        setAddRaw('')
                      }
                    }}
                  />
                ) : (
                  <button
                    className="jt-add-btn"
                    onClick={() => {
                      setAddKey(row.key)
                      setAddRaw('')
                    }}
                  >
                    + key
                  </button>
                )}
              </div>
            )
          }

          if (row.kind === 'array' || row.kind === 'object') {
            const summary =
              row.kind === 'array'
                ? row.open
                  ? ''
                  : `[${row.count}]`
                : row.open
                  ? ''
                  : `{${row.count} key${row.count !== 1 ? 's' : ''}}`
            return (
              <div className="jt-vrow" key={row.key} style={style}>
                <button className="jt-toggle" onClick={() => toggle(row.key, row.depth)}>
                  {row.open ? '▾' : '▸'}
                </button>
                <RowLabelSpan label={row.label} />
                {row.open ? null : (
                  <span className="jt-summary" onClick={() => toggle(row.key, row.depth)}>
                    {summary}
                  </span>
                )}
                <button className="jt-del" onClick={() => handleDelete(row.path)} title="Remove">
                  ×
                </button>
              </div>
            )
          }

          // leaf
          const editing = editKey === row.key
          return (
            <div className="jt-vrow" key={row.key} style={style}>
              <RowLabelSpan label={row.label} />
              {editing ? (
                <input
                  ref={editInputRef}
                  className={`jt-input${editInvalid ? ' invalid' : ''}`}
                  value={editRaw}
                  autoFocus
                  onChange={(e) => {
                    setEditRaw(e.target.value)
                    setEditInvalid(false)
                  }}
                  onBlur={() => commitEdit(row.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitEdit(row.path)
                    }
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  title={editInvalid ? 'Not valid JSON — press Escape to cancel' : undefined}
                />
              ) : (
                <LeafValue value={row.value} onEdit={() => startEdit(row.key, row.value)} />
              )}
              <button className="jt-del" onClick={() => handleDelete(row.path)} title="Remove">
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
