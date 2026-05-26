interface Op {
  type: 'eq' | 'add' | 'del'
  text: string
}

/** Minimal LCS line diff from `base` (disk) to `mine` (buffer). */
function diffLines(base: string[], mine: string[]): Op[] | null {
  const n = base.length
  const m = mine.length
  if (n + m > 8000) return null // too large to diff cheaply
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = base[i] === mine[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (base[i] === mine[j]) {
      out.push({ type: 'eq', text: base[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: base[i] })
      i++
    } else {
      out.push({ type: 'add', text: mine[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: base[i++] })
  while (j < m) out.push({ type: 'add', text: mine[j++] })
  return out
}

interface Props {
  base: string
  mine: string
  baseLabel?: string
  mineLabel?: string
  onClose: () => void
}

export function DiffView({ base, mine, baseLabel = 'on disk', mineLabel = 'mine', onClose }: Props): JSX.Element {
  const ops = diffLines(base.split('\n'), mine.split('\n'))
  return (
    <div className="conflict-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="diff">
        <div className="diff-head">
          <span>
            diff — <span className="diff-del-label">− {baseLabel}</span> /{' '}
            <span className="diff-add-label">+ {mineLabel}</span>
          </span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="diff-body">
          {ops === null && <div className="editor-msg">file too large to diff</div>}
          {ops?.map((op, i) => (
            <div key={i} className={`diff-line ${op.type}`}>
              <span className="diff-sign">{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}</span>
              {op.text || ' '}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
