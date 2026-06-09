import { useMemo, useRef, useState } from 'react'
import type { FileViewerProps } from '../../file-types/types'
import { SelectionAddToChat } from './SelectionAddToChat'

function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const cells: string[] = []
    let inQuote = false
    let cur = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if (c === sep && !inQuote) {
        cells.push(cur.trim())
        cur = ''
      } else {
        cur += c
      }
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}

export function CsvViewer({ path, buffer, mode, onBufferChange, onSave, onAddSelectionToChat }: FileViewerProps): JSX.Element {
  const sep = path.endsWith('.tsv') ? '\t' : ','
  const ref = useRef<HTMLDivElement>(null)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const { headers, dataRows } = useMemo(() => {
    const rows = parseCsv(buffer, sep)
    if (rows.length === 0) return { headers: [], dataRows: [] }
    return { headers: rows[0], dataRows: rows.slice(1) }
  }, [buffer, sep])

  const sorted = useMemo(() => {
    if (sortCol === null) return dataRows
    return [...dataRows].sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      const num = (parseFloat(av) - parseFloat(bv))
      const cmp = !isNaN(num) ? num : av.localeCompare(bv)
      return sortAsc ? cmp : -cmp
    })
  }, [dataRows, sortCol, sortAsc])

  const toggleSort = (i: number): void => {
    if (sortCol === i) setSortAsc((a) => !a)
    else { setSortCol(i); setSortAsc(true) }
  }

  if (mode === 'raw' || mode === 'edit') {
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

  if (headers.length === 0) return <div className="viewer-empty">No data</div>

  return (
    <div className="viewer-csv" ref={ref}>
      <SelectionAddToChat containerRef={ref} onAdd={onAddSelectionToChat} />
      <div className="csv-meta">{dataRows.length} rows × {headers.length} columns</div>
      <div className="csv-scroll">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-rownum" />
              {headers.map((h, i) => (
                <th key={i} className={`csv-th ${sortCol === i ? 'sorted' : ''}`} onClick={() => toggleSort(i)}>
                  {h}
                  {sortCol === i && <span className="csv-sort-arrow">{sortAsc ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={ri} data-row={ri + 1}>
                <td className="csv-rownum">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci} className="csv-td" title={row[ci]}>{row[ci] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
