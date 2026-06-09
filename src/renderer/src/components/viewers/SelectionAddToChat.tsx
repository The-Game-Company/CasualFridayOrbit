import { useEffect, useRef, useState } from 'react'
import type { SelectionRef } from '../../file-types/types'

interface Props {
  /** the viewer's scroll container — selections outside it are ignored */
  containerRef: React.RefObject<HTMLElement | null>
  /** undefined = feature off (no button rendered) */
  onAdd?: (sel: SelectionRef) => void
}

/** Walk up from a selection endpoint to the nearest element carrying `data-row`. */
function rowOf(node: Node | null): number | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (el) {
    const r = el.getAttribute('data-row')
    if (r != null) return Number(r)
    el = el.parentElement
  }
  return null
}

/**
 * "Add to chat" for the plain-DOM (non-CodeMirror) viewers. Watches the native
 * text selection inside `containerRef`; on a non-empty selection it floats the
 * button near it and, on click, reports the raw text plus the 1-based row range
 * read from the `data-row` attributes the viewer stamps on its line elements.
 */
export function SelectionAddToChat({ containerRef, onAdd }: Props): JSX.Element | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const selRef = useRef<SelectionRef | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !onAdd) return
    const update = (): void => {
      const sel = window.getSelection()
      const text = sel?.toString() ?? ''
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !text.trim()) {
        setPos(null)
        selRef.current = null
        return
      }
      const range = sel.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) {
        setPos(null)
        selRef.current = null
        return
      }
      const a = rowOf(sel.anchorNode)
      const b = rowOf(sel.focusNode)
      const start = a ?? b ?? 0
      const end = b ?? a ?? 0
      selRef.current = { text, startLine: Math.min(start, end), endLine: Math.max(start, end) }
      const rect = range.getBoundingClientRect()
      setPos({ x: rect.left, y: rect.top })
    }
    const onMouseUp = (): void => {
      setTimeout(update, 0)
    }
    const onScroll = (): void => setPos(null)
    document.addEventListener('mouseup', onMouseUp)
    container.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('scroll', onScroll, true)
    }
  }, [containerRef, onAdd])

  if (!pos || !onAdd) return null
  return (
    <div className="dom-add-to-chat" style={{ position: 'fixed', left: pos.x, top: pos.y - 34, zIndex: 50 }}>
      <button
        type="button"
        className="cm-add-to-chat-btn"
        onMouseDown={(e) => e.preventDefault()} // keep the selection alive through the click
        onClick={() => {
          const s = selRef.current
          if (s && onAdd) onAdd(s)
          window.getSelection()?.removeAllRanges() // clear so the button doesn't immediately re-pop
          setPos(null)
        }}
      >
        ＋ Add to chat
      </button>
    </div>
  )
}
