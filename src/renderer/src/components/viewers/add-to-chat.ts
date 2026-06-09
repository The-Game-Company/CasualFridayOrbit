import { showTooltip } from '@codemirror/view'
import type { Tooltip } from '@codemirror/view'
import { StateField } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import type { SelectionRef } from '../../file-types/types'

export type { SelectionRef }

function selectionRef(state: EditorState): SelectionRef | null {
  const sel = state.selection.main
  if (sel.empty) return null
  return {
    text: state.sliceDoc(sel.from, sel.to),
    startLine: state.doc.lineAt(sel.from).number,
    endLine: state.doc.lineAt(sel.to).number,
  }
}

function build(
  state: EditorState,
  getHandler: () => ((sel: SelectionRef) => void) | undefined
): readonly Tooltip[] {
  const sel = state.selection.main
  if (sel.empty || !getHandler()) return []
  return [
    {
      pos: sel.from,
      end: sel.to,
      above: true,
      strictSide: false,
      arrow: false,
      create: (view) => {
        const dom = document.createElement('div')
        dom.className = 'cm-add-to-chat'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'cm-add-to-chat-btn'
        btn.textContent = '＋ Add to chat'
        // mousedown inside the tooltip must not move the caret / clear the selection
        btn.addEventListener('mousedown', (e) => e.preventDefault())
        btn.addEventListener('click', () => {
          const handler = getHandler()
          const ref = selectionRef(view.state)
          if (handler && ref) handler(ref)
        })
        dom.appendChild(btn)
        return {
          dom,
          // Strip the tooltip wrapper's default panel chrome (the white box from
          // CodeMirror's base theme) — inline !important on the wrapper element(s),
          // which beats any stylesheet and doesn't depend on :has() support. rAF
          // retry covers the case where the wrapper is restyled just after mount.
          mount: () => {
            const strip = (): void => {
              let el: HTMLElement | null = dom.parentElement
              for (let i = 0; el && i < 5; i++, el = el.parentElement) {
                if (i > 0 && !/tooltip/.test(el.className)) continue
                el.style.setProperty('background', 'none', 'important')
                el.style.setProperty('background-color', 'transparent', 'important')
                el.style.setProperty('border', '0', 'important')
                el.style.setProperty('box-shadow', 'none', 'important')
                el.style.setProperty('padding', '0', 'important')
                el.style.setProperty('outline', 'none', 'important')
              }
            }
            strip()
            requestAnimationFrame(strip)
          },
        }
      },
    },
  ]
}

/**
 * CodeMirror extension: whenever there's a non-empty selection, float a small
 * "Add to chat" button just above it. Clicking calls `getHandler()` (read live,
 * so passing `() => ref.current` keeps it current across re-renders) with the
 * selection's raw text and 1-based line range. Emits nothing when the handler is
 * absent, so the button only appears where the feature is wired up.
 */
export function addToChatTooltip(
  getHandler: () => ((sel: SelectionRef) => void) | undefined
): Extension {
  return StateField.define<readonly Tooltip[]>({
    create: (state) => build(state, getHandler),
    update(tooltips, tr) {
      if (!tr.docChanged && !tr.selection) return tooltips
      return build(tr.state, getHandler)
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  })
}
