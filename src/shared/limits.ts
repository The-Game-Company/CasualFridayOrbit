// File-size limits for the editor, shared by main (gatekeeping the read) and renderer
// (choosing how to render). Single source of truth so the cap and the message agree.

/**
 * Hard ceiling for files Orbit will load into the editor. Above this we refuse the read
 * outright: even a virtualized editor holds the text in several copies (the modal's buffer
 * state + baseline, CodeMirror's own document, the last-pushed snapshot), so a file much
 * larger than this risks OOM-ing the renderer. Raise only if you accept that cost.
 */
export const MAX_EDIT_BYTES = 50 * 1024 * 1024 // 50 MB

/**
 * Above this size the editor opens the file in a lean CodeMirror surface only — no JSON
 * tree, CSV table, markdown preview, or whole-buffer secret scan. CodeMirror handles
 * multi-MB documents fine (its model is a rope + virtualized rendering); the React-tree /
 * table viewers and the O(n) per-keystroke secret split do not, which is what the old
 * 2 MB cap really protected against. Files below this keep every rich viewer.
 */
export const LEAN_EDIT_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Hard ceiling on file-search matches returned to the renderer. The results tree is rendered
 * fully expanded with no virtualization, so an unbounded broad query (e.g. a common token that
 * hits thousands of files) would freeze the renderer building and reconciling that many rows.
 * The worker stops walking once it has this many hits; the UI shows a "refine your search" note.
 */
export const SEARCH_RESULT_CAP = 1000

/** Format a byte count for user-facing messages (e.g. "12.4 MB", "873 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
