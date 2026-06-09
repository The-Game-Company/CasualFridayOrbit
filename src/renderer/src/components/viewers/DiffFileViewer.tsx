import { useRef } from 'react'
import type { FileViewerProps } from '../../file-types/types'
import { SelectionAddToChat } from './SelectionAddToChat'

type LineKind = 'add' | 'del' | 'header' | 'hunk' | 'ctx'

interface DiffLine {
  kind: LineKind
  text: string
}

function classify(line: string): LineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

export function DiffFileViewer({ buffer, mode, onAddSelectionToChat }: FileViewerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  if (mode === 'raw') return <pre className="viewer-raw">{buffer}</pre>

  const lines: DiffLine[] = buffer.split('\n').map((text) => ({ kind: classify(text), text }))

  return (
    <div className="viewer-diff-file" ref={ref}>
      <SelectionAddToChat containerRef={ref} onAdd={onAddSelectionToChat} />
      {lines.map((l, i) => (
        <div key={i} data-row={i + 1} className={`diff-fl diff-fl-${l.kind}`}>
          <span className="diff-fl-gutter">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
          <span className="diff-fl-text">{l.text.slice(l.kind === 'add' || l.kind === 'del' ? 1 : 0)}</span>
        </div>
      ))}
    </div>
  )
}
