import { useCallback, useMemo, useRef, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'
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
  const obj = root && typeof root === 'object' && !Array.isArray(root)
    ? { ...(root as Record<string, unknown>) }
    : {} as Record<string, unknown>
  obj[head] = setAtPath(obj[head], tail, value)
  return obj
}

function deleteAtPath(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return undefined
  const [head, ...tail] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...(root as unknown[])] : []
    if (tail.length === 0) { arr.splice(head, 1); return arr }
    arr[head] = deleteAtPath(arr[head], tail)
    return arr
  }
  const obj = { ...(root as Record<string, unknown>) }
  if (tail.length === 0) { delete obj[head]; return obj }
  obj[head] = deleteAtPath(obj[head], tail)
  return obj
}

// ─── inline value editor ──────────────────────────────────────────────────────

interface LeafProps {
  data: unknown
  path: JsonPath
  onEdit: (path: JsonPath, raw: string) => void
}

function JsonLeaf({ data, path, onEdit }: LeafProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (): void => {
    setRaw(data === null || data === undefined ? 'null' : JSON.stringify(data))
    setInvalid(false)
    setEditing(true)
  }

  const commit = (): void => {
    try {
      JSON.parse(raw)
      setInvalid(false)
      setEditing(false)
      onEdit(path, raw)
    } catch {
      setInvalid(true)
      inputRef.current?.focus()
    }
  }

  const cancel = (): void => { setEditing(false); setInvalid(false) }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`jt-input${invalid ? ' invalid' : ''}`}
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setInvalid(false) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') cancel()
        }}
        autoFocus
        title={invalid ? 'Not valid JSON — press Escape to cancel' : undefined}
      />
    )
  }

  if (data === null || data === undefined)
    return <span className="jt-null jt-editable" onClick={startEdit}>null</span>
  if (typeof data === 'boolean')
    return <span className="jt-bool jt-editable" onClick={startEdit}>{String(data)}</span>
  if (typeof data === 'number')
    return <span className="jt-num jt-editable" onClick={startEdit}>{data}</span>
  if (typeof data === 'string') {
    const quoted = JSON.stringify(data)
    const display = quoted.length > 120 ? quoted.slice(0, 120) + '…"' : quoted
    return (
      <span className="jt-str jt-editable" title={data.length > 120 ? data : undefined} onClick={startEdit}>
        {display}
      </span>
    )
  }
  return <span className="jt-str jt-editable" onClick={startEdit}>{JSON.stringify(data)}</span>
}

// ─── recursive node ───────────────────────────────────────────────────────────

interface NodeProps {
  data: unknown
  depth: number
  path: JsonPath
  onEdit: (path: JsonPath, raw: string) => void
  onDelete: (path: JsonPath) => void
}

function JsonNode({ data, depth, path, onEdit, onDelete }: NodeProps): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const [addingKey, setAddingKey] = useState(false)
  const [newKey, setNewKey] = useState('')
  const newKeyRef = useRef<HTMLInputElement>(null)

  const commitAddKey = (): void => {
    const k = newKey.trim()
    if (k) onEdit([...path, k], 'null')
    setAddingKey(false)
    setNewKey('')
  }

  if (Array.isArray(data)) {
    if (data.length === 0 && !open) return <span className="jt-punct">[]</span>
    return (
      <span className="jt-block">
        <button className="jt-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'}</button>
        {open ? (
          <ol className="jt-arr">
            {data.map((v, i) => (
              <li key={i} className="jt-row">
                <span className="jt-idx">{i}</span>
                <JsonNode data={v} depth={depth + 1} path={[...path, i]} onEdit={onEdit} onDelete={onDelete} />
                <button className="jt-del" onClick={() => onDelete([...path, i])} title="Remove item">×</button>
              </li>
            ))}
            <li className="jt-row jt-add-row">
              <button className="jt-add-btn" onClick={() => onEdit([...path, data.length], 'null')} title="Append item">
                + item
              </button>
            </li>
          </ol>
        ) : (
          <span className="jt-summary">[{data.length}]</span>
        )}
      </span>
    )
  }

  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    return (
      <span className="jt-block">
        <button className="jt-toggle" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'}</button>
        {open ? (
          <ul className="jt-obj">
            {entries.map(([k, v]) => (
              <li key={k} className="jt-row">
                <span className="jt-key">{JSON.stringify(k)}</span>
                <span className="jt-colon">:</span>
                <JsonNode data={v} depth={depth + 1} path={[...path, k]} onEdit={onEdit} onDelete={onDelete} />
                <button className="jt-del" onClick={() => onDelete([...path, k])} title="Remove key">×</button>
              </li>
            ))}
            <li className="jt-row jt-add-row">
              {addingKey ? (
                <input
                  ref={newKeyRef}
                  className="jt-input jt-key-input"
                  value={newKey}
                  placeholder="key name"
                  onChange={(e) => setNewKey(e.target.value)}
                  onBlur={commitAddKey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitAddKey() }
                    if (e.key === 'Escape') { setAddingKey(false); setNewKey('') }
                  }}
                  autoFocus
                />
              ) : (
                <button className="jt-add-btn" onClick={() => setAddingKey(true)}>+ key</button>
              )}
            </li>
          </ul>
        ) : (
          <span className="jt-summary">{'{'}{entries.length}{' key'}{entries.length !== 1 ? 's' : ''}{'}'}</span>
        )}
      </span>
    )
  }

  return <JsonLeaf data={data} path={path} onEdit={onEdit} />
}

// ─── viewer ───────────────────────────────────────────────────────────────────

export function JsonTreeViewer(props: FileViewerProps): JSX.Element {
  const { buffer, mode, onModeChange, onBufferChange, path, busy, leasedBy, dirty, binary, onSave } = props

  const [parsed, parseError] = useMemo<[unknown, string | null]>(() => {
    if (!buffer.trim()) return [null, 'empty file']
    try { return [JSON.parse(buffer), null] }
    catch (e) { return [null, (e as Error).message] }
  }, [buffer])

  const handleEdit = useCallback((editPath: JsonPath, rawValue: string) => {
    try {
      const newValue = JSON.parse(rawValue)
      const updated = setAtPath(parsed, editPath, newValue)
      onBufferChange(JSON.stringify(updated, null, 2))
    } catch { /* invalid — ignore */ }
  }, [parsed, onBufferChange])

  const handleDelete = useCallback((deletePath: JsonPath) => {
    const updated = deleteAtPath(parsed, deletePath)
    onBufferChange(JSON.stringify(updated, null, 2))
  }, [parsed, onBufferChange])

  if (mode === 'edit') {
    return (
      <CodeEditor
        path={path} buffer={buffer} binary={binary} dirty={dirty}
        onBufferChange={onBufferChange} mode={mode} onModeChange={onModeChange}
        busy={busy} leasedBy={leasedBy} onSave={onSave}
      />
    )
  }

  if (mode === 'raw') {
    return (
      <textarea
        className="editor-ta"
        value={buffer}
        onChange={(e) => onBufferChange(e.target.value)}
        spellCheck={false}
      />
    )
  }

  // tree mode
  return (
    <div className="viewer-json">
      {parseError ? (
        <>
          <div className="jt-parse-error">
            Parse error: {parseError}
            <button className="jt-parse-switch" onClick={() => onModeChange('edit')}>Switch to code editor</button>
          </div>
          <textarea
            className="editor-ta"
            value={buffer}
            onChange={(e) => onBufferChange(e.target.value)}
            spellCheck={false}
          />
        </>
      ) : (
        <div className="jt-root">
          <JsonNode data={parsed} depth={0} path={[]} onEdit={handleEdit} onDelete={handleDelete} />
        </div>
      )}
    </div>
  )
}
