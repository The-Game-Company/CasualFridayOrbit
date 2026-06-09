import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent
} from 'react'
import { Terminal as XTerm, type IMarker } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { THEMES } from '../themes'
import { isPathDrag, pathFromDrag } from './drag'
import type { ThemeName, TermKind, QuickPrompt } from '../../../shared/events'

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
  /** bracketed-paste text into the input box (never submits — same path as Ctrl+V) */
  paste: (text: string) => void
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
  /** project-declared quick prompts (.orbit.json `prompts`) — buttons on the focused pane */
  quickPrompts?: QuickPrompt[]
  /** the title claude sets on the terminal (OSC) — used to label the tab */
  onTitle?: (title: string) => void
}

export const Terminal = forwardRef<TermHandle, Props>(function Terminal(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)
  // one marker per prompt submitted this live session, oldest first; xterm keeps each `.line`
  // updated as the buffer scrolls, so we can tell which prompts are above the viewport.
  const promptsRef = useRef<{ marker: IMarker; text: string }[]>([])
  // the prompt currently shown pinned = the nearest one above the viewport top
  const pinnedEntryRef = useRef<{ marker: IMarker; text: string } | null>(null)
  const [pinnedText, setPinnedText] = useState<string | null>(null)
  // true while the viewport is scrolled up off the live bottom — shows the ↓ jump button
  const [scrolledUp, setScrolledUp] = useState(false)
  // latest onTitle, so the once-only create effect always calls the current callback
  const onTitleRef = useRef(props.onTitle)
  onTitleRef.current = props.onTitle
  // read inside the stable evalPin callback, so it always sees the current prompt text
  const lastPromptRef = useRef(props.lastPrompt)
  lastPromptRef.current = props.lastPrompt

  // Decide which prompt the pinned bar should show.
  //  • With markers (prompts submitted during this live session) we know each prompt's line, so
  //    pin the *nearest* prompt strictly above the viewport top — as the user scrolls up past a
  //    prompt, the bar switches to the one before it. A disposed marker (-1, scrollback trimmed
  //    it away) is definitely above view.
  //  • Otherwise (a resumed/refreshed conversation we never saw submitted) we only have the last
  //    prompt's text, not its line, so fall back to "is the user scrolled up off the live bottom".
  //    Guard viewportY > 0: clicking the bar with no marker goes to the top of the buffer, and
  //    without the guard the bar would immediately reappear and loop forever.
  const evalPin = useCallback((): void => {
    const term = termRef.current
    if (!term) {
      pinnedEntryRef.current = null
      setPinnedText(null)
      setScrolledUp(false)
      return
    }
    const buf = term.buffer.active
    const prompts = promptsRef.current
    let entry: { marker: IMarker; text: string } | null = null
    // scan newest → oldest for the first prompt above the viewport top
    for (let i = prompts.length - 1; i >= 0; i--) {
      const line = prompts[i].marker.line
      if (line === -1 || line < buf.viewportY) {
        entry = prompts[i]
        break
      }
    }
    pinnedEntryRef.current = entry
    if (entry) setPinnedText(entry.text)
    else if (!prompts.length && lastPromptRef.current && buf.viewportY > 0 && buf.viewportY < buf.baseY)
      setPinnedText(lastPromptRef.current)
    else setPinnedText(null)
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
    // the reset wipes the buffer, so the prompt markers now point at gone content — drop them and
    // unpin. A resumed/refreshed conversation gets fresh markers only from its next prompt (we
    // can't know where Claude re-renders old prompts in the replayed scrollback).
    for (const p of promptsRef.current) p.marker.dispose()
    promptsRef.current = []
    pinnedEntryRef.current = null
    setPinnedText(null)
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
    focus: () => termRef.current?.focus(),
    paste: (text: string) => termRef.current?.paste(text)
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
        // claude sessions get the huge-text fallback: past ~100KB the clipboard is saved to a
        // temp file and the path is typed in (like images) — megabytes through bracketed
        // paste wedge the CLI. Plain shells always get the real text.
        window.orbit.clipboardRead(props.kind === 'claude').then(({ text, imagePath, textPath }) => {
          const filePath = imagePath ?? textPath
          if (filePath) window.orbit.sessionInput(props.sessionId, ` ${filePath} `)
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
      for (const p of promptsRef.current) p.marker.dispose()
      promptsRef.current = []
      pinnedEntryRef.current = null
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
  // can track every prompt's position. The new prompt is at the bottom right now, so unpin.
  // When lastPromptTs resets to 0 (/clear or initial state), dispose stale markers and unpin.
  useEffect(() => {
    const term = termRef.current
    if (!term || props.kind !== 'claude') return
    if (!props.lastPromptTs) {
      for (const p of promptsRef.current) p.marker.dispose()
      promptsRef.current = []
      pinnedEntryRef.current = null
      setPinnedText(null)
      return
    }
    const marker = term.registerMarker(0)
    if (marker) promptsRef.current.push({ marker, text: props.lastPrompt ?? '' })
    // drop markers the scrollback already trimmed away, keeping only the most recent trimmed one
    // (it still marks "everything before here is above view"). Bounds the array on long sessions.
    const prompts = promptsRef.current
    let firstAlive = prompts.findIndex((p) => p.marker.line !== -1)
    if (firstAlive === -1) firstAlive = prompts.length
    if (firstAlive > 1) {
      for (const p of prompts.splice(0, firstAlive - 1)) p.marker.dispose()
    }
    pinnedEntryRef.current = null
    setPinnedText(null)
  }, [props.lastPromptTs, props.lastPrompt, props.kind])

  // Quick-prompt button clicked: type the prompt into claude's input box and submit it.
  // The text goes in as a bracketed paste (same path as Ctrl+V) so multi-line prompts don't
  // submit early; the Enter is sent separately after a beat — bundled with the paste, claude
  // would read the \r as a pasted newline instead of a submit.
  const sendQuickPrompt = (text: string): void => {
    const term = termRef.current
    if (!term) return
    term.paste(text)
    setTimeout(() => window.orbit.sessionInput(props.sessionId, '\r'), 150)
    term.focus()
  }

  // Paths dragged into the session get typed in, each wrapped in quotes so paths with spaces
  // survive. Two sources count: files/folders from the OS (Explorer/Finder, carrying `Files`)
  // and in-app drags of a file row / editor tab / image viewer (carrying our private path MIME).
  // Pane-rearrange drags carry neither, so they fall through to the grid's own drop handling.
  const [dropActive, setDropActive] = useState(false)
  const isFileDrag = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const isDroppable = (e: DragEvent): boolean => isFileDrag(e) || isPathDrag(e)
  const typePaths = (paths: string[]): void => {
    if (!paths.length) return
    const term = termRef.current
    if (!term) return
    // bracketed paste (same as Ctrl+V) so claude treats it as typed text, never a submit
    term.paste(paths.map((p) => `"${p}"`).join(' ') + ' ')
    term.focus()
  }
  const handleDrop = (e: DragEvent): void => {
    setDropActive(false)
    if (!isDroppable(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (isFileDrag(e)) {
      typePaths(Array.from(e.dataTransfer.files).map((f) => window.orbit.getPathForFile(f)).filter(Boolean))
    } else {
      const p = pathFromDrag(e)
      if (p) typePaths([p])
    }
  }

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
    <div
      className={dropActive ? 'terminal-host file-drop' : 'terminal-host'}
      onDragOver={(e) => {
        if (!isDroppable(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false)
      }}
      onDrop={handleDrop}
    >
      {pinnedText && (
        <button
          className="prompt-pin"
          title={pinnedText}
          onClick={() => {
            const term = termRef.current
            const m = pinnedEntryRef.current?.marker
            // jump to the pinned prompt; the bar then re-evaluates to the prompt above it, so
            // repeated clicks walk up prompt-by-prompt to the start of the chat. A trimmed
            // marker (or the resumed-session fallback) means everything is above — go to top.
            if (m && m.line >= 0) term?.scrollToLine(m.line)
            else term?.scrollToTop()
          }}
        >
          <span className="prompt-pin-icon">❯</span>
          <span className="prompt-pin-text">{pinnedText}</span>
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
      {props.kind === 'claude' && !!props.quickPrompts?.length && (
        // docked under claude's input box (always rendered, so the terminal never resizes on
        // focus changes); each bar sends to its own pane, dimmed while the pane isn't active
        <div className={props.active ? 'quick-prompts' : 'quick-prompts inactive'}>
          {props.quickPrompts.map((p, i) => (
            <button
              key={i}
              className="quick-prompt-btn"
              title={p.prompt}
              onClick={() => sendQuickPrompt(p.prompt)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
