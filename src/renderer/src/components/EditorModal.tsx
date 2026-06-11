import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffView } from './DiffView'
import { MergeEditor } from './MergeEditor'
import { FindBar } from './FindBar'
import { CodeEditor } from './viewers/CodeEditor'
import { createGenericSearchController } from './search/genericSearch'
import { resolveFileType } from '../file-types/index'
import { MODE_LABELS } from '../file-types/registry'
import type { ViewMode, SelectionRef, SearchController, SearchOptions, SearchState } from '../file-types/types'
import { LEAN_EDIT_BYTES, MAX_EDIT_BYTES, formatBytes } from '../../../shared/limits'

/** A selection promoted to an agent reference: the file path plus the selection. */
export type ChatRef = SelectionRef & { path: string }

// ─── secret detection (shell-level banner only) ───────────────────────────────
const SECRET_RE =
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|connection[_-]?string|authorization|bearer\s|mongodb(\+srv)?:\/\/|redis:\/\/|postgres(ql)?:\/\/|mysql:\/\/|amqp:\/\/)/i
function hasSecrets(text: string): boolean {
  // Regex has no line anchors, so testing the whole string is equivalent to testing each line —
  // but without allocating a lines array (matters when the buffer is multi-MB) and it
  // short-circuits at the first match.
  return SECRET_RE.test(text)
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
  const [fileSize, setFileSize] = useState(0)
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

  // ── find / search ───────────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const [searchState, setSearchState] = useState<SearchState>({ total: 0, current: 0 })

  const rootRef = useRef<HTMLDivElement>(null)
  // Controller a viewer registers (e.g. CodeMirror). Wins over the generic DOM searcher.
  const viewerSearchRef = useRef<SearchController | null>(null)
  // Generic DOM/textarea searcher over the rendered editor body, created once.
  const genericRef = useRef<SearchController | null>(null)
  if (!genericRef.current) genericRef.current = createGenericSearchController(() => bodyRef.current)
  // A registered viewer controller wins; otherwise search the rendered DOM generically.
  const activeController = (): SearchController => viewerSearchRef.current ?? genericRef.current!

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

  // Big text files bypass the rich viewers (CSV table, markdown preview) and the whole-buffer
  // secret scan — those are O(n)/O(nodes) and will freeze the renderer. We hand the file
  // straight to CodeMirror, which is built for multi-MB documents. Viewers that scale on their
  // own (handlesLarge — e.g. the virtualized JSON tree) keep the full experience. See shared/limits.
  const lean = load === 'ok' && !binary && fileSize > LEAN_EDIT_BYTES && !entry.handlesLarge

  // ── mode management ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ViewMode>(() => entry.defaultMode?.(path) ?? entry.modes[0])
  useEffect(() => {
    setMode(entry.defaultMode?.(path) ?? entry.modes[0])
  }, [path])

  // ── find handlers ────────────────────────────────────────────────────────────
  const onNext = (): void => setSearchState(activeController().next())
  const onPrev = (): void => setSearchState(activeController().prev())
  const onToggle = (key: keyof SearchOptions): void => setOpts((o) => ({ ...o, [key]: !o[key] }))
  const closeFind = (): void => {
    setFindOpen(false)
    activeController().clear()
    setSearchState({ total: 0, current: 0 })
  }

  // Ctrl+F opens the find bar; F3 / Shift+F3 navigate; Escape closes. Capture-phase so we win
  // before CodeMirror or other handlers, and gated to the visible+focused editor instance
  // (multiple editors can be mounted, with inactive ones display:none → offsetParent null).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root || root.offsetParent === null || !root.contains(document.activeElement)) return

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        e.stopPropagation()
        if (findOpen) {
          // already open: just refocus + select the input (autoFocus only fires on mount)
          const input = root.querySelector<HTMLInputElement>('.find-input')
          input?.focus()
          input?.select()
        } else {
          setFindOpen(true)
        }
        return
      }
      if (!findOpen) return
      if (e.key === 'F3') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) onPrev()
        else onNext()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeFind()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen])

  // Re-run the active query whenever it, the options, or the underlying content/viewer change.
  // The buffer-driven re-run is debounced so typing in the editor doesn't thrash the search.
  useEffect(() => {
    if (!findOpen) return
    const t = setTimeout(() => {
      setSearchState(activeController().setQuery(query, opts))
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, opts, findOpen, mode, buffer, load, lean])

  // Closing or switching files clears highlights.
  useEffect(() => {
    return () => activeController().clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFileSize(0)
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
      setFileSize(r.size ?? 0)
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
    () => !lean && !isCodeFile && load === 'ok' && !binary && hasSecrets(buffer),
    [lean, isCodeFile, load, binary, buffer]
  )
  const redacted = secrets && !revealed
  const maskedView = useMemo(() => (redacted ? maskContent(buffer) : ''), [redacted, buffer])

  // ── render ─────────────────────────────────────────────────────────────────
  const showModes = !lean && entry.modes.length > 1
  const Viewer = entry.Viewer

  return (
    <div ref={rootRef} className="editor" style={{ '--preview-zoom': zoom } as React.CSSProperties}>
      {findOpen && (
        <FindBar
          query={query}
          opts={opts}
          state={searchState}
          onQueryChange={setQuery}
          onToggle={onToggle}
          onNext={onNext}
          onPrev={onPrev}
          onClose={closeFind}
        />
      )}
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
      {lean && (
        <div className="editor-banner warn">
          ⚡ Large file ({formatBytes(fileSize)}) — opened in a lean code editor. The tree/table/preview
          views and secret-masking are off so it stays responsive.
        </div>
      )}
      {externalDisk && !redacted && (
        <div className="editor-banner warn">
          ⚠ This file changed on disk while you were editing.
          {!lean && <button onClick={() => setDiffBase(externalDisk.content ?? '')}>View diff</button>}
          <button onClick={reloadFromDisk}>Reload (lose my changes)</button>
          <button onClick={() => setExternalDisk(null)}>Keep mine</button>
        </div>
      )}

      <div className="editor-body" ref={bodyRef}>
        {load === 'loading' && <div className="editor-msg">loading…</div>}
        {load === 'tooLarge' && (
          <div className="editor-msg">
            File is {formatBytes(fileSize)} — too large to edit (limit {formatBytes(MAX_EDIT_BYTES)}).
          </div>
        )}
        {load === 'missing' && <div className="editor-msg">File not found.</div>}
        {load === 'error' && <div className="editor-msg">Could not read this file.</div>}
        {load === 'binary' && !entry.handlesBinary && (
          <div className="editor-msg">Binary file — use a dedicated viewer to open this.</div>
        )}

        {redacted && <pre className="md-preview redacted-view">{maskedView}</pre>}

        {!redacted && !showMerge && lean && (
          <CodeEditor
            path={path}
            buffer={buffer}
            binary={binary}
            dirty={dirty}
            onBufferChange={setBuffer}
            mode="edit"
            onModeChange={() => {}}
            busy={busy}
            leasedBy={leasedBy}
            onSave={() => save(false)}
            onAddSelectionToChat={onAddToChat ? (sel) => onAddToChat({ path, ...sel }) : undefined}
            onRegisterSearch={(c) => {
              viewerSearchRef.current = c
            }}
          />
        )}

        {!redacted && !showMerge && !lean && (load === 'ok' || (load === 'binary' && entry.handlesBinary)) && (
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
            onRegisterSearch={(c) => {
              viewerSearchRef.current = c
            }}
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
              {!lean && <button onClick={() => { setConflict(false); setShowMerge(true) }}>Merge line by line</button>}
              {!lean && <button onClick={() => setDiffBase(conflictDisk)}>View diff</button>}
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
