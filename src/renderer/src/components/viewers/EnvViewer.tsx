import { useMemo, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'

const SECRET_KEY_RE = /password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|connection[_-]?string|private[_-]?key|auth|bearer|credential/i

interface EnvLine {
  kind: 'comment' | 'blank' | 'pair' | 'invalid'
  raw: string
  key?: string
  value?: string
  sensitive?: boolean
}

function parseLine(raw: string): EnvLine {
  if (!raw.trim()) return { kind: 'blank', raw }
  if (raw.trimStart().startsWith('#')) return { kind: 'comment', raw }
  const eq = raw.indexOf('=')
  if (eq < 0) return { kind: 'invalid', raw }
  const key = raw.slice(0, eq).trim()
  const value = raw.slice(eq + 1)
  const sensitive = SECRET_KEY_RE.test(key)
  return { kind: 'pair', raw, key, value, sensitive }
}

export function EnvViewer({ buffer, mode, onBufferChange, onSave }: FileViewerProps): JSX.Element {
  const [revealed, setRevealed] = useState(false)

  const lines = useMemo(() => buffer.split('\n').map(parseLine), [buffer])
  const hasSensitive = lines.some((l) => l.sensitive)

  if (mode === 'edit') {
    return (
      <textarea
        className="viewer-raw-ta"
        value={buffer}
        onChange={(e) => onBufferChange(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave?.() }
        }}
      />
    )
  }

  return (
    <div className="viewer-env">
      {hasSensitive && !revealed && (
        <div className="env-secret-banner">
          🔒 Sensitive keys detected — values masked.
          <button onClick={() => setRevealed(true)}>Reveal</button>
        </div>
      )}
      <div className="env-body">
        {lines.map((l, i) => {
          if (l.kind === 'blank') return <div key={i} className="env-blank" />
          if (l.kind === 'comment') return <div key={i} className="env-comment">{l.raw}</div>
          if (l.kind === 'invalid') return <div key={i} className="env-invalid">{l.raw}</div>
          return (
            <div key={i} className="env-pair">
              <span className="env-key">{l.key}</span>
              <span className="env-eq">=</span>
              <span className={`env-val ${l.sensitive && !revealed ? 'env-masked' : ''}`}>
                {l.sensitive && !revealed ? '••••••••' : l.value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
