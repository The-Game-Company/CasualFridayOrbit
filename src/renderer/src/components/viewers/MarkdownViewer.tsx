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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
