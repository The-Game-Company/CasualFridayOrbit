import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Windows & Tabs',
    items: [
      [['Ctrl', 'T'], 'New tab in the active project'],
      [['Ctrl', '\\'], 'Split — new Claude window in the active tab'],
      [['Ctrl', 'W'], 'Close the active window (and its tab if it was the last window)'],
      [['Ctrl', 'Shift', 'W'], 'Reopen the last closed window where it was (undo-close)'],
      [['Ctrl', '1…9'], 'Jump to the Nth tab of the active project'],
      [['Alt', '←/→'], 'Move between split windows, then between tabs'],
      [['Alt', '↑/↓'], 'Move between stacked split windows'],
      [['Alt/Ctrl', 'Shift', '←/→'], 'Resize split — move the divider of the active window']
    ]
  },
  {
    title: 'Projects',
    items: [[['Ctrl', 'Shift', '↑/↓'], 'Move to the previous / next project']]
  },
  {
    title: 'App',
    items: [
      [['Ctrl', ','], 'Settings'],
      [['Ctrl', 'H'], 'History'],
      [['Ctrl', '/'], 'This shortcuts list']
    ]
  }
]

export function ShortcutsModal({ onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Keyboard Shortcuts</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body">
          {GROUPS.map((g) => (
            <div key={g.title} className="shortcuts-group">
              <div className="shortcuts-group-title">{g.title}</div>
              {g.items.map(([keys, desc]) => (
                <div key={desc} className="shortcut-row">
                  <span className="shortcut-keys">
                    {keys.map((k, i) => (
                      <span key={i}>
                        {i > 0 && <span className="shortcut-plus">+</span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </span>
                  <span className="shortcut-desc">{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
