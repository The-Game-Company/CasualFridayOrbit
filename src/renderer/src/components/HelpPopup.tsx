import { useState, useRef } from 'react'
import logo from '../assets/orbit.png'

interface Props {
  title: string
  children: React.ReactNode
  /** a `.orbit.json` snippet shown in a code block */
  snippet: string
}

/** A tiny `?` trigger in a panel header that opens an anchored help popup explaining
 *  the project's `.orbit.json` configuration for that feature. */
export function HelpPopup({ title, children, snippet }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // anchor the popup under the trigger using its on-screen rect, same idea as context menus
  const r = open && btnRef.current ? btnRef.current.getBoundingClientRect() : null
  return (
    <>
      <button
        ref={btnRef}
        className="help-trigger"
        title="How to configure this"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        ?
      </button>
      {open && r && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div
            className="help-popup"
            style={{ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) }}
          >
            <div className="help-popup-head">
              <img className="help-popup-logo" src={logo} alt="" />
              <span className="help-popup-title">{title}</span>
            </div>
            <p className="help-popup-body">{children}</p>
            <pre className="help-popup-code">
              <code>{snippet}</code>
            </pre>
          </div>
        </>
      )}
    </>
  )
}
