import { useMemo, useState } from 'react'

type DiffHunk =
  | { kind: 'equal'; lines: string[] }
  | { kind: 'change'; mine: string[]; theirs: string[] }

function computeHunks(mine: string[], theirs: string[]): DiffHunk[] {
  const n = mine.length
  const m = theirs.length
  if (n + m > 8000) return [{ kind: 'change', mine, theirs }]

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = mine[i] === theirs[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  type Op = { op: 'eq' | 'del' | 'ins'; line: string }
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (mine[i] === theirs[j]) {
      ops.push({ op: 'eq', line: mine[i] }); i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'del', line: mine[i] }); i++
    } else {
      ops.push({ op: 'ins', line: theirs[j] }); j++
    }
  }
  while (i < n) ops.push({ op: 'del', line: mine[i++] })
  while (j < m) ops.push({ op: 'ins', line: theirs[j++] })

  const hunks: DiffHunk[] = []
  let eqBuf: string[] = []
  let delBuf: string[] = []
  let insBuf: string[] = []

  const flushChange = (): void => {
    if (delBuf.length || insBuf.length) {
      hunks.push({ kind: 'change', mine: delBuf, theirs: insBuf })
      delBuf = []; insBuf = []
    }
  }
  const flushEqual = (): void => {
    if (eqBuf.length) {
      hunks.push({ kind: 'equal', lines: eqBuf })
      eqBuf = []
    }
  }

  for (const op of ops) {
    if (op.op === 'eq') { flushChange(); eqBuf.push(op.line) }
    else { flushEqual(); if (op.op === 'del') delBuf.push(op.line); else insBuf.push(op.line) }
  }
  flushChange(); flushEqual()
  return hunks
}

interface Props {
  mine: string
  theirs: string
  onApply: (merged: string) => void
  onCancel: () => void
}

export function MergeEditor({ mine, theirs, onApply, onCancel }: Props): JSX.Element {
  const hunks = useMemo(() => computeHunks(mine.split('\n'), theirs.split('\n')), [mine, theirs])
  const changeHunks = hunks.filter((h): h is Extract<DiffHunk, { kind: 'change' }> => h.kind === 'change')

  // For each change hunk index, 'mine' or 'theirs' (default 'mine')
  const [choices, setChoices] = useState<Record<number, 'mine' | 'theirs'>>({})

  const getChoice = (idx: number): 'mine' | 'theirs' => choices[idx] ?? 'mine'
  const toggle = (idx: number, val: 'mine' | 'theirs'): void => setChoices((c) => ({ ...c, [idx]: val }))
  const acceptAll = (side: 'mine' | 'theirs'): void => {
    const next: Record<number, 'mine' | 'theirs'> = {}
    changeHunks.forEach((_, i) => { next[i] = side })
    setChoices(next)
  }

  const merged = useMemo(() => {
    let changeIdx = 0
    return hunks
      .flatMap((h) => {
        if (h.kind === 'equal') return h.lines
        const choice = getChoice(changeIdx++)
        return choice === 'mine' ? h.mine : h.theirs
      })
      .join('\n')
  }, [hunks, choices])

  let changeIdx = 0
  return (
    <div className="merge-editor">
      <div className="merge-head">
        <span className="merge-title">Merge conflict — choose which lines to keep</span>
        <div className="merge-global">
          <button onClick={() => acceptAll('mine')}>Accept all mine</button>
          <button onClick={() => acceptAll('theirs')}>Accept all theirs</button>
        </div>
        <button className="merge-cancel" onClick={onCancel}>✕ Cancel</button>
      </div>

      <div className="merge-cols-head">
        <div className="merge-col-label mine-label">Mine (unsaved)</div>
        <div className="merge-col-label theirs-label">Theirs (on disk)</div>
      </div>

      <div className="merge-body">
        {hunks.map((hunk, hi) => {
          if (hunk.kind === 'equal') {
            if (hunk.lines.length <= 3) {
              return (
                <div key={hi} className="merge-equal">
                  {hunk.lines.map((l, li) => (
                    <div key={li} className="merge-eq-line">{l || ' '}</div>
                  ))}
                </div>
              )
            }
            return (
              <div key={hi} className="merge-equal merge-equal-collapsed">
                <span className="merge-eq-count">··· {hunk.lines.length} unchanged lines</span>
              </div>
            )
          }

          const idx = changeIdx++
          const choice = getChoice(idx)
          return (
            <div key={hi} className={`merge-change${choice === 'mine' ? ' chosen-mine' : ' chosen-theirs'}`}>
              <div className="merge-change-row">
                <div className={`merge-side merge-mine${choice === 'mine' ? ' chosen' : ''}`}>
                  <button
                    className={`merge-accept-btn${choice === 'mine' ? ' active' : ''}`}
                    onClick={() => toggle(idx, 'mine')}
                  >← Mine</button>
                  <pre className="merge-lines">{hunk.mine.join('\n') || ' '}</pre>
                </div>
                <div className={`merge-side merge-theirs${choice === 'theirs' ? ' chosen' : ''}`}>
                  <button
                    className={`merge-accept-btn${choice === 'theirs' ? ' active' : ''}`}
                    onClick={() => toggle(idx, 'theirs')}
                  >Theirs →</button>
                  <pre className="merge-lines">{hunk.theirs.join('\n') || ' '}</pre>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="merge-footer">
        <span className="merge-summary">
          {changeHunks.length} conflict{changeHunks.length !== 1 ? 's' : ''}
          {' · '}
          {Object.values(choices).filter((v) => v === 'theirs').length} using theirs
          {', '}
          {changeHunks.length - Object.values(choices).filter((v) => v === 'theirs').length} using mine
        </span>
        <button className="merge-apply" onClick={() => onApply(merged)}>Apply merge</button>
      </div>
    </div>
  )
}
