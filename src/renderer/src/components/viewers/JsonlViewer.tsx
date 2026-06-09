import { useMemo, useRef, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'
import { SelectionAddToChat } from './SelectionAddToChat'

// ─── single parsed line ───────────────────────────────────────────────────────

interface LineItemProps {
  index: number
  raw: string
}

function JsonlLineItem({ index, raw }: LineItemProps): JSX.Element {
  const [open, setOpen] = useState(false)

  const parsed = useMemo(() => {
    try {
      return { ok: true, data: JSON.parse(raw) as unknown }
    } catch {
      return { ok: false, data: null }
    }
  }, [raw])

  const isObject = parsed.ok && typeof parsed.data === 'object' && parsed.data !== null
  const preview = getPreview(parsed.data)

  return (
    <div data-row={index} className={`jsonl-item ${!parsed.ok ? 'jsonl-err' : ''}`}>
      <div className="jsonl-header" onClick={() => isObject && setOpen((o) => !o)}>
        <span className="jsonl-idx">{index}</span>
        {isObject && <span className="jsonl-caret">{open ? '▾' : '▸'}</span>}
        <span className="jsonl-preview">{preview}</span>
      </div>
      {open && isObject && (
        <div className="jsonl-body">
          <pre className="jsonl-json">{JSON.stringify(parsed.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function getPreview(data: unknown): string {
  if (data === null || data === undefined) return String(data)
  if (typeof data !== 'object') return String(data).slice(0, 120)
  if (Array.isArray(data)) return `[${data.length}]`
  const obj = data as Record<string, unknown>
  // Common JSONL patterns: show role+content (Claude transcripts), type, message, level
  if ('role' in obj && 'content' in obj) {
    const role = String(obj.role)
    const content = obj.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? extractText(content) : JSON.stringify(content)
    return `${role}: ${text.slice(0, 100)}`
  }
  if ('type' in obj) {
    const rest = Object.entries(obj).filter(([k]) => k !== 'type').slice(0, 2).map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 30)}`).join(' ')
    return `${obj.type}  ${rest}`
  }
  if ('level' in obj && 'message' in obj) return `[${obj.level}] ${String(obj.message).slice(0, 100)}`
  if ('message' in obj) return String(obj.message).slice(0, 120)
  // Generic: first 3 keys
  return Object.entries(obj).slice(0, 3).map(([k, v]) => `${k}: ${JSON.stringify(v)?.slice(0, 30)}`).join('  ')
}

function extractText(arr: unknown[]): string {
  for (const item of arr) {
    if (typeof item === 'object' && item !== null && 'text' in (item as Record<string, unknown>)) {
      return String((item as Record<string, unknown>).text)
    }
  }
  return JSON.stringify(arr).slice(0, 80)
}

// ─── viewer ───────────────────────────────────────────────────────────────────

const PAGE = 200

export function JsonlViewer({ buffer, mode, onAddSelectionToChat }: FileViewerProps): JSX.Element {
  const [shown, setShown] = useState(PAGE)
  const ref = useRef<HTMLDivElement>(null)

  const lines = useMemo(
    () => buffer.split('\n').filter((l) => l.trim()),
    [buffer]
  )

  if (mode === 'raw') {
    return <pre className="viewer-raw">{buffer}</pre>
  }

  return (
    <div className="viewer-jsonl" ref={ref}>
      <SelectionAddToChat containerRef={ref} onAdd={onAddSelectionToChat} />
      <div className="jsonl-meta">{lines.length} lines</div>
      {lines.slice(0, shown).map((line, i) => (
        <JsonlLineItem key={i} index={i} raw={line} />
      ))}
      {shown < lines.length && (
        <button className="jsonl-more" onClick={() => setShown((s) => s + PAGE)}>
          Show {Math.min(PAGE, lines.length - shown)} more ({lines.length - shown} remaining)
        </button>
      )}
    </div>
  )
}
