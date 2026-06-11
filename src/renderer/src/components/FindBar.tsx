import type { SearchOptions, SearchState } from '../file-types/types'

interface FindBarProps {
  query: string
  opts: SearchOptions
  state: SearchState
  onQueryChange: (q: string) => void
  onToggle: (key: keyof SearchOptions) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * Presentational find-bar overlay — no search logic lives here. The shell owns the query,
 * options and search state; this just renders them and reports user intent through callbacks.
 */
export function FindBar({
  query,
  opts,
  state,
  onQueryChange,
  onToggle,
  onNext,
  onPrev,
  onClose,
}: FindBarProps): JSX.Element {
  const count = query ? (state.total ? `${state.current}/${state.total}` : 'No results') : ''

  // Toggle/nav buttons keep focus in the input — clicking them must not blur it.
  const keepFocus = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="find-bar">
      <input
        className={`find-input${state.invalid ? ' invalid' : ''}`}
        value={query}
        autoFocus
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="find-count">{count}</span>
      <button
        className={`find-toggle${opts.caseSensitive ? ' on' : ''}`}
        title="Match case"
        onMouseDown={keepFocus}
        onClick={() => onToggle('caseSensitive')}
      >
        Aa
      </button>
      <button
        className={`find-toggle${opts.wholeWord ? ' on' : ''}`}
        title="Whole word"
        onMouseDown={keepFocus}
        onClick={() => onToggle('wholeWord')}
      >
        W
      </button>
      <button
        className={`find-toggle${opts.regex ? ' on' : ''}`}
        title="Use regular expression"
        onMouseDown={keepFocus}
        onClick={() => onToggle('regex')}
      >
        .*
      </button>
      <button className="find-nav" title="Previous (Shift+Enter)" onMouseDown={keepFocus} onClick={onPrev}>
        ‹
      </button>
      <button className="find-nav" title="Next (Enter)" onMouseDown={keepFocus} onClick={onNext}>
        ›
      </button>
      <button className="find-close" title="Close (Escape)" onMouseDown={keepFocus} onClick={onClose}>
        ×
      </button>
    </div>
  )
}
