import type { DragEvent } from 'react'

/**
 * In-app drag of a filesystem path — dragging a file row from the sidebar, an editor tab, or
 * the image viewer into a terminal types that path into the session. A private MIME type keeps
 * it distinct from OS file drops (which carry `Files`) and pane-rearrange drags (which carry
 * `text/plain` plus the in-app `dragWin` state), so no drop handler misreads one for another.
 */
export const ORBIT_PATH_MIME = 'application/x-orbit-path'

/** Mark `e` as an in-app path drag carrying `path`. Call from a drag source's onDragStart. */
export function startPathDrag(e: DragEvent, path: string): void {
  e.dataTransfer.setData(ORBIT_PATH_MIME, path)
  e.dataTransfer.effectAllowed = 'copy'
}

/** True while an in-app path drag is hovering (only `types` is readable during dragover). */
export function isPathDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(ORBIT_PATH_MIME)
}

/** The dragged path, read on drop (empty string when this isn't an in-app path drag). */
export function pathFromDrag(e: DragEvent): string {
  return e.dataTransfer.getData(ORBIT_PATH_MIME)
}
