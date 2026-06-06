import type { FileTypeEntry, ViewMode } from './types'

const entries: FileTypeEntry[] = []

/** Register a file-type handler. Call this once per handler at module load time. */
export function registerFileType(entry: FileTypeEntry): void {
  entries.push(entry)
}

/**
 * Find the best-matching handler for the given (path, binary) pair.
 * Falls back to the last registered entry (should be the plain-text fallback).
 */
export function resolveFileType(path: string, binary: boolean): FileTypeEntry {
  let best: FileTypeEntry | null = null
  let bestScore = 0
  for (const e of entries) {
    const s = e.score(path, binary)
    if (s > bestScore) {
      best = e
      bestScore = s
    }
  }
  return best ?? entries[entries.length - 1]
}

/** Human-readable labels for each ViewMode. */
export const MODE_LABELS: Record<ViewMode, string> = {
  edit: 'Code',
  preview: 'Preview',
  table: 'Table',
  tree: 'Tree',
  raw: 'Raw',
}
