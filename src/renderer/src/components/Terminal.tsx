import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal as XTerm, type IMarker } from '@xterm/xterm'
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
  /** relaunch resuming this exact claude conversation — a "refresh" (e.g. to repaint a theme) */
  refresh: () => void
  interrupt: () => void
  clear: () => void
  /** drop the scrollback only — the visible screen stays (used when claude is /clear-ed) */
  clearScrollback: () => void
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
  /** most recent user prompt — shown pinned at the top once it scrolls out of view */
  lastPrompt?: string
  /** bumps each time a new prompt is submitted; triggers a fresh scroll marker */
  lastPromptTs?: number
  /** the title claude sets on the terminal (OSC) — used to label the tab */
  onTitle?: (title: string) => void
}

export const Terminal = forwardRef<TermHandle, Props>(function Terminal(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  // marks the buffer line of the most recent prompt; xterm keeps its `.line` updated as the
  // buffer scrolls, so we can tell when the prompt has moved above the viewport.
  const markerRef = useRef<IMarker | null>(null)
  const [pinned, setPinned] = useState(false)
  // true while the viewport is scrolled up off the live bottom — shows the ↓ jump button
  const [scrolledUp, setScrolledUp] = useState(false)
  // latest onTitle, so the once-only create effect always calls the current callback
  const onTitleRef = useRef(props.onTitle)
  onTitleRef.current = props.onTitle
  // read inside the stable evalPin callback, so it always sees the current prompt text
  const lastPromptRef = useRef(props.lastPrompt)
  lastPromptRef.current = props.lastPrompt

  // Decide whether the last-prompt bar should be pinned.
  //  • If we have a marker (a prompt submitted during this live session) we know its exact line,
  //    so pin while that line is above the viewport top — covers both a long auto-scrolling
  //    response and the user manually scrolling up. A disposed marker (-1, scrollback trimmed it
  //    away) is definitely above view.
  //  • Otherwise (a resumed/refreshed conversation we never saw submitted) we only have the prompt
  //    text, not its line, so fall back to "is the user scrolled up off the live bottom".
  const evalPin = useCallback((): void => {
    const term = termRef.current
    if (!term) {
      setPinned(false)
      setScrolledUp(false)
      return
    }
    const buf = term.buffer.active
    const m = markerRef.current
    if (m) setPinned(m.line === -1 || m.line < buf.viewportY)
    else setPinned(!!lastPromptRef.current && buf.viewportY < buf.baseY)
    // "bottom" = following the live end of the buffer (latest output + input box visible)
    setScrolledUp(buf.viewportY < buf.baseY)
  }, [])

  // Re-measure and resize both xterm and the backing pty to the host's real bounds. Guarded
  // so a hidden/un-laid-out pane (0 size) or a bogus measurement (e.g. fit running before the
  // web font's metrics are ready, which yields a too-wide cell and a tiny column count) is
  // skipped rather than committed — a later pass (fonts-ready / resize / activation) fits once
  // the bounds are real. This is what stops the terminal getting stuck at a narrow width.
  const refit = useCallback((): void => {
    const term = termRef.current
    const fit = fitRef.current
    const host = hostRef.current
    if (!term || !fit || !host) return
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    try {
      const dims = fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      if (dims.cols < 2 || dims.rows < 2) return
      if (dims.cols !== term.cols || dims.rows !== term.rows) term.resize(dims.cols, dims.rows)
      window.orbit.sessionResize(props.sessionId, term.cols, term.rows)
      evalPin()
    } catch {
      /* ignore */
    }
  }, [props.sessionId, evalPin])

  // Spawn the backend process. `resumeId` is only used for the very first launch.
  const launch = (continueLast: boolean, resumeId?: string): void => {
    const term = termRef.current
    if (!termRef.current || !fitRef.current) return
    spawnedRef.current = true
    // Best-effort sizing for the spawn; refit() (fonts-ready / activation / resize) will send
    // a corrected size to the pty afterwards if the bounds weren't final yet.
    refit()
    term.reset()
    // the reset wipes the buffer, so any prompt marker now points at gone content — drop it and
    // unpin. A resumed/refreshed conversation gets a fresh marker only on its next prompt (we
    // can't know where Claude re-renders an old prompt in the replayed scrollback).
    markerRef.current?.dispose()
    markerRef.current = null
    setPinned(false)
    setScrolledUp(false)
    window.orbit.createSession({
      sessionId: props.sessionId,
      projectPath: props.projectPath,
      kind: props.kind,
      cols: term.cols,
      rows: term.rows,
      continueLast,
      resumeId,
      startupCommand: props.startupCommand,
      appearance: THEMES[props.theme].appearance
    })
    term.focus()
  }
  const start = (continueLast: boolean): void => launch(continueLast)

  useImperativeHandle(ref, () => ({
    restart: (continueLast: boolean) => start(continueLast),
    refresh: () => {
      // only claude sessions can be resumed; relaunching a shell would just wipe its state
      if (props.kind !== 'claude' || !spawnedRef.current) return
      launch(false, props.resumeId)
    },
    interrupt: () => window.orbit.sessionInput(props.sessionId, '\x1b'),
    clear: () => termRef.current?.clear(),
    // ED 3 (CSI 3 J) erases only the saved-lines buffer, so claude's freshly painted
    // post-/clear screen survives — just the old conversation above it goes away.
    clearScrollback: () => termRef.current?.write('\x1b[3J'),
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
      theme: THEMES[props.theme].terminal
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

    const inputSub = term.onData((d) => window.orbit.sessionInput(props.sessionId, d))
    const titleSub = term.onTitleChange((t) => onTitleRef.current?.(t))

    // Copy / paste are wired explicitly. With the WebGL renderer xterm draws to a canvas, so
    // there's no DOM selection for the OS to copy, and we deliberately keep the app menu from
    // grabbing Ctrl+C / Ctrl+V (those belong to the terminal). Conventions match Windows
    // Terminal:
    //   • Ctrl+C copies the selection if there is one, else passes through as interrupt (^C)
    //   • Ctrl+Shift+C always copies the selection
    //   • Ctrl+V / Ctrl+Shift+V / Shift+Insert paste — text via bracketed paste, and an image
    //     on the clipboard is saved to a file whose path is typed in (claude reads it)
    term.attachCustomKeyEventHandler((e): boolean => {
      if (e.type !== 'keydown') return true

      const isPaste =
        (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') || (e.shiftKey && e.key === 'Insert')
      if (isPaste) {
        e.preventDefault()
        window.orbit.clipboardRead().then(({ text, imagePath }) => {
          if (imagePath) window.orbit.sessionInput(props.sessionId, ` ${imagePath} `)
          else if (text) term.paste(text)
        })
        return false
      }

      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c' && (e.shiftKey || term.hasSelection())) {
        const sel = term.getSelection()
        if (sel) window.orbit.clipboardWriteText(sel)
        e.preventDefault()
        return false // copied — don't also send ^C
      }

      return true
    })

    // keep the pinned-prompt visibility in sync as the buffer scrolls (manual scroll) and as
    // streaming output pushes the marked line up (auto-scroll while following the bottom).
    const scrollSub = term.onScroll(() => evalPin())
    const writeSub = term.onWriteParsed(() => evalPin())

    const offData = window.orbit.onSessionData((sid, data) => {
      if (sid === props.sessionId) term.write(data)
    })
    const offExit = window.orbit.onSessionExit((sid, code) => {
      if (sid === props.sessionId) term.write(`\r\n\x1b[90m[claude exited with code ${code}]\x1b[0m\r\n`)
    })
    // Debounce resize bursts (drag, show/hide transitions) into one fit per frame.
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => refit())
    })
    observer.observe(hostRef.current)

    termRef.current = term
    fitRef.current = fit

    // Size now, and again once the custom font's real metrics have loaded — the WebGL
    // renderer derives the cell size from the font, so fitting before it's ready would lock
    // in a wrong column count.
    refit()
    document.fonts?.ready?.then(() => refit())

    // NOTE: we do NOT spawn here — see the `live`-gated effect below (lazy-resume).

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      inputSub.dispose()
      titleSub.dispose()
      scrollSub.dispose()
      writeSub.dispose()
      markerRef.current?.dispose()
      markerRef.current = null
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
    refit()
  }, [props.fontSize, refit])

  // theme
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = THEMES[props.theme].terminal
  }, [props.theme])

  // a new prompt was submitted: drop a marker at the cursor (≈ where the prompt rendered) so we
  // can track when it scrolls out of view. The prompt is at the bottom right now, so unpin.
  useEffect(() => {
    const term = termRef.current
    if (!term || props.kind !== 'claude' || !props.lastPromptTs) return
    markerRef.current?.dispose()
    markerRef.current = term.registerMarker(0) ?? null
    setPinned(false)
  }, [props.lastPromptTs, props.kind])

  // becoming active -> the pane was hidden (0-size) or just un-hidden; re-fit once layout
  // has actually settled (two frames, since display:none -> flex resolves over a frame) and
  // then focus. Without the second frame the first measurement can still be the stale width.
  useEffect(() => {
    if (!props.active) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        refit()
        termRef.current?.focus()
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [props.active, refit])

  return (
    <div className="terminal-host">
      {pinned && props.lastPrompt && (
        <button
          className="prompt-pin"
          title={props.lastPrompt}
          onClick={() => {
            const term = termRef.current
            const m = markerRef.current
            if (m && m.line >= 0) term?.scrollToLine(m.line)
            else term?.scrollToBottom()
          }}
        >
          <span className="prompt-pin-icon">❯</span>
          <span className="prompt-pin-text">{props.lastPrompt}</span>
        </button>
      )}
      {scrolledUp && (
        <button
          className="scroll-bottom"
          title="Jump to bottom"
          onClick={() => {
            termRef.current?.scrollToBottom()
            termRef.current?.focus()
          }}
        >
          ↓
        </button>
      )}
      <div ref={hostRef} className="terminal-xterm" />
    </div>
  )
})
