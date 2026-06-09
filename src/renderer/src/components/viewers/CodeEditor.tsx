import { useEffect, useRef } from 'react'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  bracketMatching,
  indentUnit,
  StreamLanguage,
} from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap, linter } from '@codemirror/lint'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { go } from '@codemirror/legacy-modes/mode/go'
import { csharp } from '@codemirror/legacy-modes/mode/clike'
import type { FileViewerProps } from '../../file-types/types'

function ext(p: string): string {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i + 1).toLowerCase() : ''
}

function getLanguage(path: string): ReturnType<typeof javascript> | ReturnType<typeof json> | ReturnType<typeof css> | ReturnType<typeof html> | ReturnType<typeof python> | ReturnType<typeof rust> | ReturnType<typeof cpp> | ReturnType<typeof sql> | ReturnType<typeof xml> | ReturnType<typeof yaml> | ReturnType<typeof markdown> | ReturnType<typeof StreamLanguage.define> | [ReturnType<typeof json>, ReturnType<typeof linter>] | null {
  const e = ext(path)
  switch (e) {
    case 'ts': return javascript({ typescript: true })
    case 'tsx': return javascript({ typescript: true, jsx: true })
    case 'js': case 'mjs': case 'cjs': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'json': case 'jsonc': return [json(), linter(jsonParseLinter())] as unknown as ReturnType<typeof json>
    case 'css': case 'scss': case 'sass': case 'less': return css()
    case 'html': case 'htm': return html()
    case 'py': return python()
    case 'rs': return rust()
    case 'c': case 'cpp': case 'cc': case 'cxx': case 'h': case 'hpp': return cpp()
    case 'sql': return sql()
    case 'xml': case 'svg': return xml()
    case 'yaml': case 'yml': return yaml()
    case 'md': case 'mdx': case 'markdown': return markdown()
    case 'sh': case 'bash': case 'zsh': case 'fish': return StreamLanguage.define(shell)
    case 'go': return StreamLanguage.define(go)
    case 'cs': return StreamLanguage.define(csharp)
    default: return null
  }
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'calc(13px * var(--preview-zoom, 1))',
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    background: 'var(--bg)',
    color: 'var(--fg)',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': {
    background: 'var(--bg)',
    borderRight: '1px solid var(--line)',
    color: 'var(--fg-mute)',
    fontSize: 'calc(12px * var(--preview-zoom, 1))',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '2.5em' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { background: 'transparent', color: 'var(--fg)' },
  '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '&.cm-focused .cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 36%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-matchingBracket': { outline: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)' },
  '.cm-nonmatchingBracket': { outline: '1px solid var(--red)', color: 'var(--red)' },
  '.cm-searchMatch': { background: 'color-mix(in srgb, var(--amber) 30%, transparent)', outline: '1px solid var(--amber)' },
  '.cm-searchMatch.cm-searchMatch-selected': { background: 'color-mix(in srgb, var(--amber) 60%, transparent)' },
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
  '.cm-tooltip': { background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '4px' },
  '.cm-completionLabel': { color: 'var(--fg)' },
  '.cm-completionDetail': { color: 'var(--fg-mute)', fontStyle: 'italic' },
  '.cm-completionMatchedText': { color: 'var(--accent)', fontWeight: 'bold', textDecoration: 'none' },
  '.cm-lint-marker-error': { color: 'var(--red)' },
  '.cm-lint-marker-warning': { color: 'var(--amber)' },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px solid var(--red)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '2px solid var(--amber)' },
  '.cm-diagnosticText': { fontSize: '12px' },
  '.cm-diagnostic': { padding: '4px 8px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--red)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--amber)' },
})

export function CodeEditor({ path, buffer, onBufferChange, onSave }: FileViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onBufferChangeRef = useRef(onBufferChange)
  onBufferChangeRef.current = onBufferChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  // Track the last value that crossed the editor↔parent boundary (either direction) so we
  // can tell our own push echoing back as a prop from a genuine external change
  const lastPushed = useRef(buffer)
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const lang = getLanguage(path)
    const langExts = lang ? (Array.isArray(lang) ? lang : [lang]) : []

    // Push the document up to the modal at most a few times a second. doc.toString() is
    // O(doc) — running it (plus the modal's dirty compare) on every keystroke/undo froze
    // the app on multi-MB files; CodeMirror itself handles big docs fine.
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

    // flush on blur so clicking Save/Close/another tab always sees the final text
    const blurFlush = EditorView.domEventHandlers({
      blur: () => {
        flushPush()
        return false
      },
    })

    const state = EditorState.create({
      doc: buffer,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of('  '),
        syntaxHighlighting(classHighlighter),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        history(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        saveKeymap,
        ...langExts,
        updateListener,
        blurFlush,
        editorTheme,
      ],
    })

    lastPushed.current = buffer
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      if (pushTimer.current) {
        clearTimeout(pushTimer.current)
        pushTimer.current = null
      }
      view.destroy()
      viewRef.current = null
    }
    // Recreate the whole editor when path changes (language may differ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Sync external buffer changes (disk refresh, reload, etc.) into the editor
  useEffect(() => {
    // our own (debounced) push echoing back as a prop — same string instance, nothing to do
    if (buffer === lastPushed.current) return
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    lastPushed.current = buffer
    if (current !== buffer) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: buffer } })
    }
  }, [buffer])

  return <div ref={containerRef} className="code-editor-cm" />
}
