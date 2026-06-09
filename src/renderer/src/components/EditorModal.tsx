import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffView } from './DiffView'
import { MergeEditor } from './MergeEditor'
import { resolveFileType } from '../file-types/index'
import { MODE_LABELS } from '../file-types/registry'
import type { ViewMode, SelectionRef } from '../file-types/types'

/** A selection promoted to an agent reference: the file path plus the selection. */
export type ChatRef = SelectionRef & { path: string }

// ─── secret detection (shell-level banner only) ───────────────────────────────
const SECRET_RE =
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|connection[_-]?string|authorization|bearer\s|mongodb(\+srv)?:\/\/|redis:\/\/|postgres(ql)?:\/\/|mysql:\/\/|amqp:\/\/)/i
function hasSecrets(text: string): boolean {
  return text.split('\n').some((l) => SECRET_RE.test(l))
}
function maskLine(line: string): string {
  if (!SECRET_RE.test(line)) return line
  let l = line.replace(/(\/\/[^:/\s]+:)([^@\s]+)(@)/g, (_m, a, _b, c) => a + '••••••' + c)
  l = l.replace(/([:=]\s*"?)([^"\s,}{]{4,})("?)/, (_m, a, _v, c) => a + '••••••' + c)
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
  busy: boolean
  leasedBy: string | null
  autoSave: boolean
  autoSaveDelay: number
  shouldConfirmClose: boolean
  onConfirmCloseHandled: () => void
  onDirtyChange: (dirty: boolean) => void
  onClose: () => void
  /** Send a selection (file path + row range + raw text) to the agent's input. */
  onAddToChat?: (ref: ChatRef) => void
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export function EditorModal({
  path,
  busy,
  leasedBy,
  autoSave,
  autoSaveDelay,
  shouldConfirmClose,
  onConfirmCloseHandled,
  onDirtyChange,
  onClose,
  onAddToChat,
}: Props): JSX.Element {
  // ── file type resolution ───────────────────────────────────────────────────
  const earlyEntry = useMemo(() => resolveFileType(path, false), [path])
  const skipTextRead = earlyEntry.handlesBinary === true

  // ── loading state ──────────────────────────────────────────────────────────
  const [load, setLoad] = useState<LoadState>('loading')
  const [binary, setBinary] = useState(false)
  const [buffer, setBufferState] = useState('')
  const [baseline, setBaselineState] = useState<Baseline | null>(null)
  const [externalDisk, setExternalDisk] = useState<Disk | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [conflictDisk, setConflictDisk] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [diffBase, setDiffBase] = useState<string | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [showMerge, setShowMerge] = useState(false)

  // Ctrl + mouse-wheel magnifies the preview/editor text. The factor rides on a CSS var
  // (--preview-zoom) set on the editor root, so every viewer (markdown, code, etc.) scales
  // off it. Persisted globally so the chosen size sticks across files and sessions.
  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 4
  const [zoom, setZoom] = useState(() => {
    const v = Number(localStorage.getItem('orbit.previewZoom'))
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1
  })
  useEffect(() => {
    localStorage.setItem('orbit.previewZoom', String(zoom))
  }, [zoom])
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // Native listener (passive: false) — React's onWheel is passive and can't preventDefault,
    // which we need to stop the browser's own Ctrl+wheel page zoom.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => {
        const next = z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const bufferRef = useRef('')
  const baselineRef = useRef<Baseline | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // length check first — skips the O(n) string compare on most renders of big files
  const dirty =
    !!baseline && (buffer.length !== baseline.content.length || buffer !== baseline.content)

  // ── resolve final entry after we know binary state ─────────────────────────
  const entry = useMemo(() => resolveFileType(path, binary), [path, binary])

  // ── mode management ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ViewMode>(() => entry.defaultMode?.(path) ?? entry.modes[0])
  useEffect(() => {
    setMode(entry.defaultMode?.(path) ?? entry.modes[0])
  }, [path])

  // ── notify parent of dirty state ───────────────────────────────────────────
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty])

  // ── reset transient UI when file changes ───────────────────────────────────
  useEffect(() => {
    setCloseConfirm(false)
    setShowMerge(false)
  }, [path])

  // ── respond to parent-triggered close request (e.g. clicking × on tab) ────
  useEffect(() => {
    if (!shouldConfirmClose) return
    onConfirmCloseHandled()
    if (dirty) setCloseConfirm(true)
    else onClose()
  }, [shouldConfirmClose])

  // ── auto-save ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoSave || !dirty) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => save(false), autoSaveDelay)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [buffer, dirty, autoSave, autoSaveDelay])

  // ── load + watch file ──────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setLoad('loading')
    setBinary(false)
    setExternalDisk(null)
    setConflict(false)
    setDeleted(false)
    setRevealed(false)
    setDiffBase(null)
    setShowMerge(false)

    if (skipTextRead) {
      setBuffer('')
      setBaseline(null)
      setBinary(true)
      setLoad('ok')
      return
    }

    window.orbit.readTextFile(path).then((r) => {
      if (!alive) return
      if (r.ok) {
        setBuffer(r.content!)
        setBaseline({ content: r.content!, hash: r.hash!, mtimeMs: r.mtimeMs! })
        setLoad('ok')
        window.orbit.watchFile(path)
      } else {
        setBinary(r.binary ?? false)
        setLoad(r.binary ? 'binary' : r.tooLarge ? 'tooLarge' : r.missing ? 'missing' : 'error')
      }
    })
    return () => {
      alive = false
      window.orbit.unwatchFile(path)
    }
  }, [path, skipTextRead])

  // ── external disk changes ──────────────────────────────────────────────────
  useEffect(() => {
    return window.orbit.onFileExternalChange((c) => {
      if (c.path !== path) return
      if (c.deleted) { setDeleted(true); flash('file was deleted on disk'); return }
      // our own save echoing back through the watcher — the baseline already matches, so
      // skip the full-content state churn (and the spurious conflict race while typing)
      if (c.hash === baselineRef.current?.hash) return
      const isDirty = baselineRef.current ? bufferRef.current !== baselineRef.current.content : false
      if (!isDirty) {
        setBuffer(c.content!)
        setBaseline({ content: c.content!, hash: c.hash!, mtimeMs: c.mtimeMs! })
        flash('updated from disk')
      } else {
        setExternalDisk({ content: c.content!, hash: c.hash!, mtimeMs: c.mtimeMs! })
      }
    })
  }, [path])

  // ── save / reload ──────────────────────────────────────────────────────────
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
    if (dirty) { setCloseConfirm(true); return }
    onClose()
  }

  // ── secrets ────────────────────────────────────────────────────────────────
  const isCodeFile = entry.id === 'code' || entry.id === 'text'
  const secrets = useMemo(
    () => !isCodeFile && load === 'ok' && !binary && hasSecrets(buffer),
    [isCodeFile, load, binary, buffer]
  )
  const redacted = secrets && !revealed
  const maskedView = useMemo(() => (redacted ? maskContent(buffer) : ''), [redacted, buffer])

  // ── render ─────────────────────────────────────────────────────────────────
  const showModes = entry.modes.length > 1
  const Viewer = entry.Viewer

  return (
    <div className="editor" style={{ '--preview-zoom': zoom } as React.CSSProperties}>
      {(showModes && load === 'ok' && !redacted) || dirty ? (
        <div className="editor-toolbar">
          {showModes && load === 'ok' && !redacted && (
            <span className="seg seg-sm">
              {entry.modes.map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {entry.modeLabels?.[m] ?? MODE_LABELS[m]}
                </button>
              ))}
            </span>
          )}
          <span className="editor-toolbar-spacer" />
          {saving && <span className="editor-saving">saving…</span>}
          {dirty && !saving && (
            <button className="editor-discard-btn" onClick={reloadFromDisk} title="Discard changes, reload from disk">
              Discard
            </button>
          )}
        </div>
      ) : null}

      {closeConfirm && (
        <div className="editor-banner editor-close-confirm">
          <span className="dot-dirty">●</span>
          <span>Unsaved changes</span>
          <button onClick={async () => { await save(false); onClose() }}>Save &amp; Close</button>
          <button className="danger-sm" onClick={() => reloadFromDisk().then(() => onClose())}>Discard &amp; Close</button>
          <button onClick={() => setCloseConfirm(false)}>Keep editing</button>
        </div>
      )}
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

      <div className="editor-body" ref={bodyRef}>
        {load === 'loading' && <div className="editor-msg">loading…</div>}
        {load === 'tooLarge' && <div className="editor-msg">File is larger than 2&nbsp;MB — not editable here.</div>}
        {load === 'missing' && <div className="editor-msg">File not found.</div>}
        {load === 'error' && <div className="editor-msg">Could not read this file.</div>}
        {load === 'binary' && !entry.handlesBinary && (
          <div className="editor-msg">Binary file — use a dedicated viewer to open this.</div>
        )}

        {redacted && <pre className="md-preview redacted-view">{maskedView}</pre>}

        {!redacted && !showMerge && (load === 'ok' || (load === 'binary' && entry.handlesBinary)) && (
          <Viewer
            path={path}
            buffer={buffer}
            binary={binary}
            dirty={dirty}
            onBufferChange={setBuffer}
            mode={mode}
            onModeChange={setMode}
            busy={busy}
            leasedBy={leasedBy}
            onSave={() => save(false)}
            onAddSelectionToChat={onAddToChat ? (sel) => onAddToChat({ path, ...sel }) : undefined}
          />
        )}

        {showMerge && (
          <MergeEditor
            mine={buffer}
            theirs={conflictDisk}
            onApply={(merged) => { setBuffer(merged); setShowMerge(false); flash('merged — review and save') }}
            onCancel={() => { setShowMerge(false); setConflict(true) }}
          />
        )}
      </div>

      <div className="editor-status">
        <span>{entry.id}</span>
        <span className="editor-status-spacer" />
        {zoom !== 1 && (
          <button className="editor-zoom" title="Reset zoom (Ctrl+scroll to change)" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
        )}
        {notice && <span className="editor-notice">{notice}</span>}
        {load === 'ok' && !binary && <span className="editor-watching">● watching disk</span>}
      </div>

      {conflict && (
        <div className="conflict-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConflict(false)}>
          <div className="conflict">
            <div className="conflict-title">File changed on disk</div>
            <p>This file was saved externally while you had unsaved changes. How do you want to resolve it?</p>
            <div className="conflict-actions">
              <button onClick={() => { setConflict(false); setShowMerge(true) }}>Merge line by line</button>
              <button onClick={() => setDiffBase(conflictDisk)}>View diff</button>
              <button className="danger" onClick={() => save(true)}>Override with mine</button>
              <button onClick={() => { reloadFromDisk(); setConflict(false) }}>Discard mine, use disk</button>
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
}
