import type { SearchController, SearchOptions, SearchState } from '../../file-types/types'

const MAX_MATCHES = 5000
const HL_ALL = 'orbit-find'
const HL_ACTIVE = 'orbit-find-active'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the search RegExp from query + options. Returns null when the pattern can't compile. */
function buildRegExp(query: string, opts: SearchOptions): RegExp | null {
  let pattern = opts.regex ? query : escapeRegExp(query)
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`
  const flags = 'g' + (opts.caseSensitive ? '' : 'i')
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

const EMPTY: SearchState = { total: 0, current: 0 }

/**
 * A SearchController that operates over whatever the shell's editor body currently renders,
 * for viewers that don't register their own controller. Two modes:
 *  - if the container holds a <textarea>, search its value and drive selection (csv/env edit).
 *  - otherwise highlight rendered text nodes via the CSS Custom Highlight API (DOM viewers).
 */
export function createGenericSearchController(getContainer: () => HTMLElement | null): SearchController {
  // textarea mode state
  let ta: HTMLTextAreaElement | null = null
  let taRanges: { start: number; end: number }[] = []
  // DOM highlight mode state
  let domRanges: Range[] = []
  let active = -1

  const clearHighlights = (): void => {
    CSS.highlights.delete(HL_ALL)
    CSS.highlights.delete(HL_ACTIVE)
  }

  const clear = (): void => {
    clearHighlights()
    ta = null
    taRanges = []
    domRanges = []
    active = -1
  }

  // ── textarea mode ──────────────────────────────────────────────────────────
  const applyTextarea = (textarea: HTMLTextAreaElement, re: RegExp): SearchState => {
    ta = textarea
    domRanges = []
    clearHighlights()
    const value = textarea.value
    taRanges = []
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(value)) !== null) {
      taRanges.push({ start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) re.lastIndex++ // guard against zero-width loops
      if (taRanges.length >= MAX_MATCHES) break
    }
    if (taRanges.length === 0) {
      active = -1
      return EMPTY
    }
    active = 0
    selectTextarea()
    return { total: taRanges.length, current: 1 }
  }

  const selectTextarea = (): void => {
    if (!ta || active < 0 || active >= taRanges.length) return
    const r = taRanges[active]
    ta.focus()
    ta.setSelectionRange(r.start, r.end)
  }

  // ── DOM highlight mode ───────────────────────────────────────────────────────
  const applyDom = (container: HTMLElement, re: RegExp): SearchState => {
    ta = null
    taRanges = []
    domRanges = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent) return NodeFilter.FILTER_REJECT
        const tag = node.parentElement?.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let node: Node | null
    outer: while ((node = walker.nextNode())) {
      const text = node.textContent!
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const r = document.createRange()
        r.setStart(node, m.index)
        r.setEnd(node, m.index + m[0].length)
        domRanges.push(r)
        if (m[0].length === 0) re.lastIndex++ // guard against zero-width loops
        if (domRanges.length >= MAX_MATCHES) break outer
      }
    }
    if (domRanges.length === 0) {
      clearHighlights()
      active = -1
      return EMPTY
    }
    active = 0
    paintDom()
    scrollActiveIntoView()
    return { total: domRanges.length, current: 1 }
  }

  const paintDom = (): void => {
    // Highlight + Range exist in Chromium (Electron 42 = Chromium 134).
    CSS.highlights.set(HL_ALL, new Highlight(...domRanges))
    if (active >= 0 && active < domRanges.length) {
      CSS.highlights.set(HL_ACTIVE, new Highlight(domRanges[active]))
    } else {
      CSS.highlights.delete(HL_ACTIVE)
    }
  }

  const scrollActiveIntoView = (): void => {
    if (active < 0 || active >= domRanges.length) return
    domRanges[active].startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }

  // ── shared ─────────────────────────────────────────────────────────────────
  const total = (): number => (ta ? taRanges.length : domRanges.length)

  const stateOf = (): SearchState => {
    const t = total()
    return { total: t, current: t ? active + 1 : 0 }
  }

  const move = (dir: 1 | -1): SearchState => {
    const t = total()
    if (t === 0) return EMPTY
    active = (active + dir + t) % t
    if (ta) selectTextarea()
    else {
      paintDom()
      scrollActiveIntoView()
    }
    return stateOf()
  }

  return {
    setQuery(query: string, opts: SearchOptions): SearchState {
      const container = getContainer()
      if (!container || !query) {
        clear()
        return EMPTY
      }
      const re = buildRegExp(query, opts)
      if (!re) {
        clear()
        return { total: 0, current: 0, invalid: true }
      }
      const textarea = container.querySelector('textarea')
      if (textarea) return applyTextarea(textarea, re)
      return applyDom(container, re)
    },
    next: () => move(1),
    prev: () => move(-1),
    clear,
  }
}
