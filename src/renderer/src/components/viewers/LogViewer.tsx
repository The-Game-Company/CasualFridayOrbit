import { useMemo, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'none'

const LEVEL_RE = /\b(error|err|fatal|warn|warning|info|notice|debug|dbg|trace|verbose)\b/i
const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/
const STACK_RE = /^\s+at\s/

function detectLevel(line: string): LogLevel {
  const m = LEVEL_RE.exec(line)
  if (!m) return 'none'
  const w = m[1].toLowerCase()
  if (w === 'error' || w === 'err' || w === 'fatal') return 'error'
  if (w === 'warn' || w === 'warning') return 'warn'
  if (w === 'info' || w === 'notice') return 'info'
  if (w === 'debug' || w === 'dbg') return 'debug'
  if (w === 'trace' || w === 'verbose') return 'trace'
  return 'none'
}

const PAGE = 500

export function LogViewer({ buffer, mode }: FileViewerProps): JSX.Element {
  const [shown, setShown] = useState(PAGE)

  const lines = useMemo(() => buffer.split('\n'), [buffer])
  const visible = lines.slice(0, shown)

  if (mode === 'raw') return <pre className="viewer-raw">{buffer}</pre>

  return (
    <div className="viewer-log">
      {visible.map((line, i) => {
        const level = detectLevel(line)
        const isStack = STACK_RE.test(line)
        const hasTs = TS_RE.test(line)
        return (
          <div key={i} className={`log-line log-${level} ${isStack ? 'log-stack' : ''}`}>
            <span className="log-lnum">{i + 1}</span>
            <span className="log-text">
              {hasTs ? highlightTimestamps(line) : line}
            </span>
          </div>
        )
      })}
      {shown < lines.length && (
        <button className="jsonl-more" onClick={() => setShown((s) => s + PAGE)}>
          Show more ({lines.length - shown} remaining)
        </button>
      )}
    </div>
  )
}

function highlightTimestamps(line: string): JSX.Element {
  const parts = line.split(TS_RE)
  const matches = line.match(new RegExp(TS_RE.source, 'g')) ?? []
  const out: (string | JSX.Element)[] = []
  parts.forEach((part, i) => {
    out.push(part)
    if (matches[i]) out.push(<span key={i} className="log-ts">{matches[i]}</span>)
  })
  return <>{out}</>
}
