import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import type { FileViewerProps } from '../../file-types/types'
import { CodeEditor } from './CodeEditor'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code>`
      } catch {}
    }
    return `<code>${md.utils.escapeHtml(str)}</code>`
  },
})

export function MarkdownViewer(props: FileViewerProps): JSX.Element {
  const { buffer, mode, onModeChange, onBufferChange, path, busy, leasedBy, dirty, binary, onSave } = props
  const previewRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => (mode === 'preview' ? md.render(buffer) : ''), [mode, buffer])

  // Prevent internal links from navigating away
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const handler = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest('a')) e.preventDefault()
    }
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [html])

  // Keyboard caret/word selection in a non-editable div: the browser only does this in
  // editable fields, so drive it manually with Selection.modify (works on read-only content).
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent): void => {
      const dir =
        e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right'
        : e.key === 'ArrowUp' ? 'backward' : e.key === 'ArrowDown' ? 'forward' : null
      if (!dir) return
      const sel = window.getSelection()
      if (!sel) return
      const alter = e.shiftKey ? 'extend' : 'move'
      // Ctrl+Shift+Arrow → by word/line; plain Arrow falls through to normal behavior
      const horizontal = dir === 'left' || dir === 'right'
      const granularity = e.ctrlKey ? (horizontal ? 'word' : 'line') : (horizontal ? 'character' : 'line')
      if (!e.ctrlKey && !e.shiftKey) return // let the browser handle bare arrows (scrolling)
      e.preventDefault()
      sel.modify(alter, dir, granularity)
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [html])

  if (mode === 'edit') {
    return (
      <CodeEditor
        path={path}
        buffer={buffer}
        binary={binary}
        dirty={dirty}
        onBufferChange={onBufferChange}
        mode={mode}
        onModeChange={onModeChange}
        busy={busy}
        leasedBy={leasedBy}
        onSave={onSave}
      />
    )
  }

  return (
    <div
      ref={previewRef}
      className="md-preview"
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
