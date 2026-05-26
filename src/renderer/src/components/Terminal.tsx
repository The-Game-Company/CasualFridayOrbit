import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { THEMES } from '../themes'
import type { ThemeName, TermKind } from '../../../shared/events'

const FONT_FAMILY =
  "'Cascadia Code', 'CaskaydiaCove Nerd Font', 'Fira Code', Consolas, 'Courier New', monospace"

export interface TermHandle {
  /** (re)start the backend session; pass true to resume the most recent conversation */
  restart: (continueLast: boolean) => void
  interrupt: () => void
  clear: () => void
  focus: () => void
}

interface Props {
  sessionId: string
  projectPath: string
  kind: TermKind
  /** if set, the first launch resumes this past claude session id */
  resumeId?: string
  /** command typed once at spawn (command-bar sessions) */
  startupCommand?: string
  /** when true, the backend process is spawned (lazy-resume: stays unspawned until shown) */
  live: boolean
  active: boolean
  fontSize: number
  theme: ThemeName
}

export const Terminal = forwardRef<TermHandle, Props>(function Terminal(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)

  // Spawn the backend process. `resumeId` is only used for the very first launch.
  const launch = (continueLast: boolean, resumeId?: string): void => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    spawnedRef.current = true
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    term.reset()
    window.orbit.createSession({
      sessionId: props.sessionId,
      projectPath: props.projectPath,
      kind: props.kind,
      cols: term.cols,
      rows: term.rows,
      continueLast,
      resumeId,
      startupCommand: props.startupCommand
    })
    term.focus()
  }
  const start = (continueLast: boolean): void => launch(continueLast)

  useImperativeHandle(ref, () => ({
    restart: (continueLast: boolean) => start(continueLast),
    interrupt: () => window.orbit.sessionInput(props.sessionId, '\x1b'),
    clear: () => termRef.current?.clear(),
    focus: () => termRef.current?.focus()
  }))

  // Create the xterm + backend session once.
  useEffect(() => {
    if (!hostRef.current) return
    const term = new XTerm({
      fontFamily: FONT_FAMILY,
      fontSize: props.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: THEMES[props.theme]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(hostRef.current)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* canvas/dom fallback */
    }
    try {
      fit.fit()
    } catch {
      /* ignore */
    }

    const inputSub = term.onData((d) => window.orbit.sessionInput(props.sessionId, d))

    // Image paste: the terminal can't carry image bytes to the CLI. Persist a pasted
    // image to a file and type its path into claude (which reads image references by
    // path). Plain text falls through to xterm so its bracketed paste still works.
    const insertPath = (p: string | null): void => {
      // leading/trailing spaces keep the path off whatever was already typed
      if (p) window.orbit.sessionInput(props.sessionId, ` ${p} `)
    }
    const onPaste = (e: ClipboardEvent): void => {
      const cd = e.clipboardData
      if (!cd) return
      const text = cd.getData('text/plain')
      const imageItem = Array.from(cd.items).find((i) => i.type.startsWith('image/'))

      // Fast path: the image is exposed as a blob on the paste event.
      if (imageItem) {
        const file = imageItem.getAsFile()
        if (file) {
          e.preventDefault()
          e.stopPropagation()
          const ext = (imageItem.type.split('/')[1] || 'png').toLowerCase()
          file.arrayBuffer().then((buf) => window.orbit.saveClipboardImage(buf, ext).then(insertPath))
          return
        }
      }

      // No plain text => likely a raw bitmap (Windows screenshot) that the DOM paste
      // event doesn't surface. Have the main process read the OS clipboard directly.
      if (!text) {
        e.preventDefault()
        e.stopPropagation()
        window.orbit.saveClipboardImage().then(insertPath)
        return
      }

      // Plain text => let xterm handle it (preserves bracketed paste for claude).
    }
    term.textarea?.addEventListener('paste', onPaste, true)

    const offData = window.orbit.onSessionData((sid, data) => {
      if (sid === props.sessionId) term.write(data)
    })
    const offExit = window.orbit.onSessionExit((sid, code) => {
      if (sid === props.sessionId) term.write(`\r\n\x1b[90m[claude exited with code ${code}]\x1b[0m\r\n`)
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        window.orbit.sessionResize(props.sessionId, term.cols, term.rows)
      } catch {
        /* hidden tabs have 0 size; ignore */
      }
    })
    observer.observe(hostRef.current)

    termRef.current = term
    fitRef.current = fit

    // NOTE: we do NOT spawn here — see the `live`-gated effect below (lazy-resume).

    return () => {
      observer.disconnect()
      term.textarea?.removeEventListener('paste', onPaste, true)
      inputSub.dispose()
      offData()
      offExit()
      term.dispose()
      window.orbit.closeSession(props.sessionId)
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // lazy spawn: the first time this session becomes live (shown/focused), launch it,
  // resuming its past conversation if a resumeId was provided.
  useEffect(() => {
    if (!props.live || spawnedRef.current) return
    if (!termRef.current || !fitRef.current) return
    launch(false, props.resumeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.live])

  // font size
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = props.fontSize
    try {
      fitRef.current?.fit()
      window.orbit.sessionResize(props.sessionId, term.cols, term.rows)
    } catch {
      /* ignore */
    }
  }, [props.fontSize, props.sessionId])

  // theme
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = THEMES[props.theme]
  }, [props.theme])

  // becoming active -> re-fit (was hidden/0-size) + focus
  useEffect(() => {
    if (!props.active) return
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    requestAnimationFrame(() => {
      try {
        fit.fit()
        window.orbit.sessionResize(props.sessionId, term.cols, term.rows)
      } catch {
        /* ignore */
      }
      term.focus()
    })
  }, [props.active, props.sessionId])

  return <div ref={hostRef} className="terminal-host" />
})
