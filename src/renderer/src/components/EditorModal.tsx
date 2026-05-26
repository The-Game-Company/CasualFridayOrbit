import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { DiffView } from './DiffView'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

// --- secret redaction ------------------------------------------------------
const SECRET_RE =
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|connection[_-]?string|authorization|bearer\s|mongodb(\+srv)?:\/\/|redis:\/\/|postgres(ql)?:\/\/|mysql:\/\/|amqp:\/\/|sntry|xox[baprs]-)/i
function hasSecrets(text: string): boolean {
  return text.split('\n').some((l) => SECRET_RE.test(l))
}
function maskLine(line: string): string {
  if (!SECRET_RE.test(line)) return line
  let l = line.replace(/(\/\/[^:/\s]+:)([^@\s]+)(@)/g, (_m, a, _b, c) => a + '••••••' + c) // url creds
  l = l.replace(/([:=]\s*"?)([^"\s,}{]{4,})("?)/, (_m, a, _v, c) => a + '••••••' + c) // key:value / key=value
  return l
}
function maskContent(text: string): string {
  return text.split('\n').map(maskLine).join('\n')
}

interface Baseline {
  content: string
  hash: string
  mtimeMs: number
}
interface Disk {
  content: string
  hash: string
  mtimeMs: number
}

type LoadState = 'loading' | 'ok' | 'binary' | 'tooLarge' | 'missing' | 'error'

interface Props {
  path: string
  /** true if an agent is currently writing this file (from reactive busyFiles) */
  busy: boolean
  /** agent id holding a lease covering this file, if any */
  leasedBy: string | null
  /** when true, render as a docked side-pane (no overlay) */
  docked: boolean
  onToggleDock: () => void
  onClose: () => void
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}
const isMd = (p: string): boolean => /\.(md|markdown|mdx)$/i.test(p)

export function EditorModal({ path, busy, leasedBy, docked, onToggleDock, onClose }: Props): JSX.Element {
  const [load, setLoad] = useState<LoadState>('loading')
  const [buffer, setBufferState] = useState('')
  const [baseline, setBaselineState] = useState<Baseline | null>(null)
  const [externalDisk, setExternalDisk] = useState<Disk | null>(null)
  const [mode, setMode] = useState<'preview' | 'edit'>(isMd(path) ? 'preview' : 'edit')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [conflictDisk, setConflictDisk] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [revealed, setRevealed] = useState(false)
  const [diffBase, setDiffBase] = useState<string | null>(null)

  const bufferRef = useRef('')
  const baselineRef = useRef<Baseline | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setBuffer = (v: string): void => {
    bufferRef.current = v
    setBufferState(v)
  }
  const setBaseline = (b: Baseline | null): void => {
    baselineRef.current = b
    setBaselineState(b)
  }
  const flash = (msg: string): void => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 2500)
  }

  const dirty = !!baseline && buffer !== baseline.content

  // load + watch the file
  useEffect(() => {
    let alive = true
    setLoad('loading')
    setExternalDisk(null)
    setConflict(false)
    setDeleted(false)
    setRevealed(false)
    setDiffBase(null)
    window.orbit.readTextFile(path).then((r) => {
      if (!alive) return
      if (r.ok) {
        setBuffer(r.content!)
        setBaseline({ content: r.content!, hash: r.hash!, mtimeMs: r.mtimeMs! })
        setLoad('ok')
        setMode(isMd(path) ? 'preview' : 'edit')
        window.orbit.watchFile(path)
      } else {
        setLoad(r.binary ? 'binary' : r.tooLarge ? 'tooLarge' : r.missing ? 'missing' : 'error')
      }
    })
    return () => {
      alive = false
      window.orbit.unwatchFile()
    }
  }, [path])

  // react to external (on-disk) changes
  useEffect(() => {
    return window.orbit.onFileExternalChange((c) => {
      if (c.path !== path) return
      if (c.deleted) {
        setDeleted(true)
        flash('file was deleted on disk')
        return
      }
      const isDirty = baselineRef.current ? bufferRef.current !== baselineRef.current.content : false
      if (!isDirty) {
        // clean buffer -> live refresh to the latest version + re-baseline
        setBuffer(c.content!)
        setBaseline({ content: c.content!, hash: c.hash!, mtimeMs: c.mtimeMs! })
        flash('updated from disk')
      } else {
        // dirty -> don't clobber; surface the change for the user to resolve
        setExternalDisk({ content: c.content!, hash: c.hash!, mtimeMs: c.mtimeMs! })
      }
    })
  }, [path])

  const save = async (force: boolean): Promise<void> => {
    if (!baselineRef.current) return
    setSaving(true)
    const r = await window.orbit.saveTextFile(path, bufferRef.current, baselineRef.current.hash, force)
    setSaving(false)
    if (r.ok) {
      setBaseline({ content: bufferRef.current, hash: r.hash!, mtimeMs: r.mtimeMs! })
      setExternalDisk(null)
      setConflict(false)
      setDeleted(false)
      flash('saved')
    } else if (r.conflict) {
      const disk = await window.orbit.readTextFile(path)
      setConflictDisk(disk.ok ? disk.content! : '')
      setConflict(true)
    } else {
      flash('save failed: ' + (r.error ?? 'unknown'))
    }
  }

  const reloadFromDisk = async (): Promise<void> => {
    const r = await window.orbit.readTextFile(path)
    if (r.ok) {
      setBuffer(r.content!)
      setBaseline({ content: r.content!, hash: r.hash!, mtimeMs: r.mtimeMs! })
      setExternalDisk(null)
      setConflict(false)
      setDeleted(false)
      flash('reloaded')
    }
  }

  const requestClose = (): void => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save(false)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = buffer.slice(0, start) + '  ' + buffer.slice(end)
      setBuffer(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  const onCursor = (): void => {
    const el = taRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = el.value.slice(0, pos)
    setCursor({ line: before.split('\n').length, col: pos - before.lastIndexOf('\n') })
  }

  const secrets = useMemo(() => hasSecrets(buffer), [buffer])
  const redacted = load === 'ok' && secrets && !revealed
  const maskedView = useMemo(() => (redacted ? maskContent(buffer) : ''), [redacted, buffer])
  const html = useMemo(
    () => (isMd(path) && mode === 'preview' && !redacted ? md.render(buffer) : ''),
    [path, mode, buffer, redacted]
  )
  const lineCount = useMemo(() => buffer.split('\n').length, [buffer])

  const shell = (
      <div className={`editor ${docked ? 'docked' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <span className="editor-path" title={path}>
            {dirty && <span className="dot-dirty">●</span>}
            {baseName(path)}
            {load === 'ok' && <span className="editor-dir">{path}</span>}
          </span>
          <span className="editor-actions">
            {isMd(path) && load === 'ok' && (
              <span className="seg">
                <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
                  Preview
                </button>
                <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
                  Edit
                </button>
              </span>
            )}
            <button disabled={!dirty || saving} onClick={() => save(false)} title="Save (Ctrl+S)">
              {saving ? 'saving…' : 'Save'}
            </button>
            <button disabled={!dirty} onClick={reloadFromDisk} title="Discard changes, reload from disk">
              Discard
            </button>
            <button onClick={onToggleDock} title={docked ? 'Pop out to overlay' : 'Dock beside terminals'}>
              {docked ? '⤢' : '⤡'}
            </button>
            <button onClick={requestClose}>Close</button>
          </span>
        </div>

        {redacted && (
          <div className="editor-banner warn">
            🔒 This file contains secrets — values are hidden.
            <button onClick={() => setRevealed(true)}>Reveal &amp; edit</button>
          </div>
        )}
        {busy && load === 'ok' && (
          <div className="editor-banner warn">⚠ An agent is writing this file right now — saving may conflict.</div>
        )}
        {leasedBy && !busy && load === 'ok' && (
          <div className="editor-banner warn">🔒 This file is covered by a lease held by <b>{leasedBy}</b> — coordinate before saving.</div>
        )}
        {deleted && <div className="editor-banner danger">⚠ This file was deleted on disk. Saving will recreate it.</div>}
        {externalDisk && !redacted && (
          <div className="editor-banner warn">
            ⚠ This file changed on disk while you were editing.
            <button onClick={() => setDiffBase(externalDisk.content ?? '')}>View diff</button>
            <button onClick={reloadFromDisk}>Reload (lose my changes)</button>
            <button onClick={() => setExternalDisk(null)}>Keep mine</button>
          </div>
        )}

        <div className="editor-body">
          {load === 'loading' && <div className="editor-msg">loading…</div>}
          {load === 'binary' && <div className="editor-msg">Binary file — can’t edit here.</div>}
          {load === 'tooLarge' && <div className="editor-msg">File is larger than 2&nbsp;MB — not editable here.</div>}
          {load === 'missing' && <div className="editor-msg">File not found.</div>}
          {load === 'error' && <div className="editor-msg">Could not read this file.</div>}

          {redacted && <pre className="md-preview redacted-view">{maskedView}</pre>}

          {!redacted && load === 'ok' && mode === 'preview' && isMd(path) && (
            <div
              className="md-preview"
              // links in rendered markdown must not navigate the app window away
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a')) e.preventDefault()
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {!redacted && load === 'ok' && !(mode === 'preview' && isMd(path)) && (
            <div className="editor-edit">
              <div className="editor-gutter" ref={gutterRef}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={taRef}
                className="editor-ta"
                value={buffer}
                spellCheck={false}
                wrap="off"
                onChange={(e) => {
                  setBuffer(e.target.value)
                  onCursor()
                }}
                onKeyDown={onKeyDown}
                onKeyUp={onCursor}
                onClick={onCursor}
                onScroll={(e) => {
                  if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
                }}
              />
            </div>
          )}
        </div>

        <div className="editor-status">
          <span>{dirty ? 'modified' : 'saved'}</span>
          {load === 'ok' && mode !== 'preview' && (
            <span>
              Ln {cursor.line}, Col {cursor.col}
            </span>
          )}
          <span className="editor-status-spacer" />
          {notice && <span className="editor-notice">{notice}</span>}
          {load === 'ok' && <span className="editor-watching">● watching disk</span>}
        </div>

        {conflict && (
          <div className="conflict-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConflict(false)}>
            <div className="conflict">
              <div className="conflict-title">File changed on disk</div>
              <p>
                Someone (an agent or the project) changed this file since you opened it. How do you want to
                resolve it?
              </p>
              <div className="conflict-actions">
                <button onClick={() => setDiffBase(conflictDisk)}>View diff</button>
                <button className="danger" onClick={() => save(true)}>
                  Overwrite with my version
                </button>
                <button onClick={reloadFromDisk}>Reload latest (lose mine)</button>
                <button onClick={() => setConflict(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {diffBase !== null && (
          <DiffView base={diffBase} mine={buffer} onClose={() => setDiffBase(null)} />
        )}
      </div>
  )

  return docked ? (
    shell
  ) : (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      {shell}
    </div>
  )
}
