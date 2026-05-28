import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceState } from '../shared/events'

function workspacePath(): string {
  return path.join(app.getPath('userData'), 'workspace.json')
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

/** OS window geometry we restore on next launch so the app reopens where the user left it. */
export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export function loadWindowState(): WindowState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'))
    if (parsed && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed as WindowState
    }
    return null
  } catch {
    return null
  }
}

export function saveWindowState(state: WindowState): void {
  const target = windowStatePath()
  const tmp = target + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  } catch {
    /* best effort */
  }
}

export function loadWorkspace(): WorkspaceState | null {
  try {
    const raw = fs.readFileSync(workspacePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.sessions)) return parsed as WorkspaceState
    return null
  } catch {
    return null
  }
}

/**
 * Atomic-ish save: write to a temp file then rename, so a crash mid-write can't
 * corrupt the workspace file (the rename is atomic on the same volume).
 */
export function saveWorkspace(state: WorkspaceState): void {
  const target = workspacePath()
  const tmp = target + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  } catch {
    /* best effort */
  }
}
