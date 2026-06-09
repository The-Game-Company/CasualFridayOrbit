import { useEffect, useRef } from 'react'
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  Decoration,
  ViewPlugin,
  WidgetType,
  tooltips,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import type { FileViewerProps } from '../../file-types/types'
import { addToChatTooltip } from './add-to-chat'

// ─── Live-preview decorations ────────────────────────────────────────────────
// The document text is never mutated — every transformation here is a *display*
// decoration over the real markdown, so the buffer (and the saved file) stays
// byte-for-byte what the user typed. Markdown formatting is rendered inline and
// the markup tokens (#, **, `, >, etc.) are hidden on every line *except* the
// one(s) the selection currently touches, where they reappear so editing the
// raw syntax feels natural (Obsidian "Live Preview" style).

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '•'
    return s
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    return s
  }
}

const bulletWidget = new BulletWidget()
const hrWidget = new HrWidget()

const HEADING_RE = /^(?:ATX|Setext)Heading([1-6])$/

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const { state } = view
  const doc = state.doc

  // Lines the selection sits on — markers stay raw (visible & editable) there.
  // Only while focused: an unfocused editor reads as a clean formatted doc with
  // every marker hidden (the resting cursor line shouldn't leak "### "/"**").
  const activeLines = new Set<number>()
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      const from = doc.lineAt(r.from).number
      const to = doc.lineAt(r.to).number
      for (let n = from; n <= to; n++) activeLines.add(n)
    }
  }
  const lineActive = (pos: number): boolean => activeLines.has(doc.lineAt(pos).number)

  const hide = (from: number, to: number): void => {
    if (to > from) decos.push(Decoration.replace({}).range(from, to))
  }
  const mark = (cls: string, from: number, to: number): void => {
    if (to > from) decos.push(Decoration.mark({ class: cls }).range(from, to))
  }
  const lineClass = (cls: string, fromPos: number, toPos: number): void => {
    const first = doc.lineAt(fromPos).number
    const last = doc.lineAt(toPos).number
    for (let n = first; n <= last; n++) {
      decos.push(Decoration.line({ class: cls }).range(doc.line(n).from))
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const n = node.node

        // ── headings: size the line, hide the leading "### " ───────────────
        const h = HEADING_RE.exec(name)
        if (h) {
          lineClass(`cm-md-h${h[1]}`, node.from, node.from)
          return
        }
        if (name === 'HeaderMark') {
          if (!lineActive(node.from)) {
            let end = node.to
            if (doc.sliceString(end, end + 1) === ' ') end++ // swallow the space after #'s
            hide(node.from, end)
          }
          return
        }

        // ── inline emphasis / code / strike: style inner text, hide marks ──
        if (
          name === 'StrongEmphasis' ||
          name === 'Emphasis' ||
          name === 'Strikethrough' ||
          name === 'InlineCode'
        ) {
          const cls =
            name === 'StrongEmphasis'
              ? 'cm-md-strong'
              : name === 'Emphasis'
                ? 'cm-md-em'
                : name === 'Strikethrough'
                  ? 'cm-md-strike'
                  : 'cm-md-code'
          const f = n.firstChild
          const l = n.lastChild
          const innerFrom = f ? f.to : node.from
          const innerTo = l ? l.from : node.to
          mark(cls, innerFrom, innerTo)
          return
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (!lineActive(node.from)) hide(node.from, node.to)
          return
        }
        if (name === 'CodeMark') {
          // hide inline-code backticks; leave fenced-code ``` markers in place
          if (n.parent?.name === 'InlineCode' && !lineActive(node.from)) hide(node.from, node.to)
          return
        }

        // ── links / images: show the text, hide the brackets + URL ─────────
        if (name === 'Link' || name === 'Image') {
          const marks: { from: number; to: number }[] = []
          for (let c = n.firstChild; c; c = c.nextSibling) {
            if (c.name === 'LinkMark') marks.push({ from: c.from, to: c.to })
          }
          if (marks.length >= 2) {
            const textFrom = marks[0].to // just after the opening "[" (and "!" for images)
            const textTo = marks[1].from // the closing "]"
            mark('cm-md-link', textFrom, textTo)
            if (!lineActive(node.from)) {
              hide(node.from, textFrom) // "[" / "!["
              hide(textTo, node.to) // "](url)" or "][ref]"
            }
          }
          return
        }

        // ── blockquotes: left rule + hide the "> " markers ─────────────────
        if (name === 'Blockquote') {
          lineClass('cm-md-quote', node.from, node.to)
          return
        }
        if (name === 'QuoteMark') {
          if (!lineActive(node.from)) {
            let end = node.to
            if (doc.sliceString(end, end + 1) === ' ') end++
            hide(node.from, end)
          }
          return
        }

        // ── list bullets: render "-/*/+" as "•" (numbers kept as-is) ───────
        if (name === 'ListMark') {
          const ch = doc.sliceString(node.from, node.to)
          if (/^[-*+]$/.test(ch) && !lineActive(node.from)) {
            decos.push(Decoration.replace({ widget: bulletWidget }).range(node.from, node.to))
          }
          return
        }

        // ── fenced / indented code: subtle monospace block ─────────────────
        if (name === 'FencedCode' || name === 'CodeBlock') {
          lineClass('cm-md-codeblock', node.from, node.to)
          return
        }

        // ── horizontal rule: draw an actual line ───────────────────────────
        if (name === 'HorizontalRule') {
          if (!lineActive(node.from)) {
            decos.push(Decoration.replace({ widget: hrWidget }).range(node.from, node.to))
          }
          return false // nothing meaningful inside
        }
      },
    })
  }

  // sort=true — handlers emit decorations out of document order (line decos,
  // marks and replacements interleave), so let the RangeSet sort them.
  return Decoration.set(decos, true)
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate): void {
      // selection moves change which line shows raw markers; focus toggles the
      // whole reveal behavior — rebuild on all of these too.
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

const mdTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(15px * var(--preview-zoom, 1))',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    background: 'var(--bg)',
    color: 'var(--fg)',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.7' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 28px' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 28%, transparent) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 36%, transparent) !important',
  },
  '.cm-searchMatch': {
    background: 'color-mix(in srgb, var(--amber) 30%, transparent)',
    outline: '1px solid var(--amber)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'color-mix(in srgb, var(--amber) 60%, transparent)',
  },
  '.cm-panels': { background: 'var(--bg-2)', color: 'var(--fg)', borderTop: '1px solid var(--line)' },
  '.cm-panels input': {
    background: 'var(--bg-3)',
    border: '1px solid var(--line)',
    color: 'var(--fg)',
    borderRadius: '4px',
    padding: '2px 6px',
    outline: 'none',
    fontSize: '12px',
  },
  '.cm-panels button': {
    background: 'var(--bg-3)',
    border: '1px solid var(--line)',
    color: 'var(--fg-dim)',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    marginLeft: '4px',
    fontSize: '12px',
  },
  '.cm-panels button[name="close"]': { background: 'transparent', border: 'none' },

  // ── markdown formatting ──────────────────────────────────────────────────
  '.cm-md-h1': {
    fontSize: '1.7em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: 'var(--fg-strong)',
    borderBottom: '1px solid var(--line)',
    paddingBottom: '2px',
  },
  '.cm-md-h2': {
    fontSize: '1.4em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: 'var(--fg-strong)',
    borderBottom: '1px solid var(--line)',
    paddingBottom: '2px',
  },
  '.cm-md-h3': { fontSize: '1.2em', fontWeight: '700', color: 'var(--fg-strong)' },
  '.cm-md-h4': { fontSize: '1.05em', fontWeight: '700', color: 'var(--fg-strong)' },
  '.cm-md-h5': { fontSize: '1em', fontWeight: '700', color: 'var(--fg-strong)' },
  '.cm-md-h6': { fontSize: '0.95em', fontWeight: '700', color: 'var(--fg-dim)' },

  '.cm-md-strong': { fontWeight: '700', color: 'var(--fg-strong)' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', color: 'var(--fg-dim)' },
  '.cm-md-code': {
    fontFamily: "'Cascadia Code', Consolas, monospace",
    fontSize: '0.88em',
    background: 'var(--bg-3)',
    borderRadius: '4px',
    padding: '0.1em 0.35em',
  },
  '.cm-md-link': { color: 'var(--accent)', textDecoration: 'underline' },

  '.cm-md-quote': {
    marginLeft: '14px',
    paddingLeft: '14px !important',
    borderLeft: '3px solid var(--line)',
    color: 'var(--fg-dim)',
    fontStyle: 'italic',
  },
  '.cm-md-codeblock': {
    fontFamily: "'Cascadia Code', Consolas, monospace",
    fontSize: '0.88em',
    background: 'color-mix(in srgb, var(--bg-3) 60%, transparent)',
  },
  '.cm-md-bullet': { color: 'var(--accent)' },
  '.cm-md-hr': {
    display: 'inline-block',
    width: '100%',
    borderBottom: '1px solid var(--line)',
    verticalAlign: 'middle',
  },
})

export function MarkdownLiveEditor({
  path,
  buffer,
  onBufferChange,
  onSave,
  onAddSelectionToChat,
}: FileViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onBufferChangeRef = useRef(onBufferChange)
  onBufferChangeRef.current = onBufferChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onAddSelRef = useRef(onAddSelectionToChat)
  onAddSelRef.current = onAddSelectionToChat
  // Last value that crossed the editor↔parent boundary (either way) — lets us
  // tell our own debounced push echoing back from a genuine external change.
  const lastPushed = useRef(buffer)
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const flushPush = (): void => {
      if (pushTimer.current) {
        clearTimeout(pushTimer.current)
        pushTimer.current = null
      }
      const view = viewRef.current
      if (!view) return
      const val = view.state.doc.toString()
      if (val === lastPushed.current) return
      lastPushed.current = val
      onBufferChangeRef.current(val)
    }

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          flushPush() // the modal saves bufferRef — make sure it holds the latest doc
          onSaveRef.current?.()
          return true
        },
      },
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      if (pushTimer.current) clearTimeout(pushTimer.current)
      pushTimer.current = setTimeout(flushPush, 150)
    })

    // flush on blur so switching mode / clicking Save / closing sees the final text
    const blurFlush = EditorView.domEventHandlers({
      blur: () => {
        flushPush()
        return false
      },
    })

    const state = EditorState.create({
      doc: buffer,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        livePreview,
        tooltips({ position: 'fixed' }),
        addToChatTooltip(() => onAddSelRef.current),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...markdownKeymap]),
        saveKeymap,
        updateListener,
        blurFlush,
        mdTheme,
      ],
    })

    lastPushed.current = buffer
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      flushPush() // capture any sub-debounce edits before the instance goes away
      if (pushTimer.current) {
        clearTimeout(pushTimer.current)
        pushTimer.current = null
      }
      view.destroy()
      viewRef.current = null
    }
    // Recreate when the file changes (fresh doc + clean history)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Sync external buffer changes (disk refresh, reload, mode round-trip) in
  useEffect(() => {
    if (buffer === lastPushed.current) return // our own push echoing back
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    lastPushed.current = buffer
    if (current !== buffer) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: buffer } })
    }
  }, [buffer])

  return <div ref={containerRef} className="md-live-editor" />
}
