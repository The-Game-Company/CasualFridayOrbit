import fs from 'node:fs'
import path from 'node:path'

/** Project-config files whose change should refresh the project list. */
const isConfigFile = (name: string): boolean => name === '.orbit.json' || name.endsWith('.code-workspace')

/** Watches the project root + each immediate subdir for project-config changes, debounced. */
export class ProjectsWatcher {
  private watchers: fs.FSWatcher[] = []
  private timer: NodeJS.Timeout | null = null

  watch(root: string, onChange: () => void): void {
    this.dispose()
    // Re-arm after each refresh so newly created project dirs get their own watcher.
    const debounced = (): void => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.watch(root, onChange)
        onChange()
      }, 300)
    }

    // Root dir: any change catches new/removed top-level project dirs.
    this.arm(root, debounced)

    // Each immediate subdir: only fire on its own project-config files.
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      this.arm(path.join(root, e.name), debounced, (name) => isConfigFile(name))
    }
  }

  // fs.watch on Windows fires duplicate/null-name events; the debounce absorbs both.
  private arm(dir: string, debounced: () => void, accept?: (name: string) => boolean): void {
    try {
      const w = fs.watch(dir, (_event, filename) => {
        if (accept && (!filename || !accept(path.basename(filename.toString())))) return
        debounced()
      })
      w.on('error', () => {})
      this.watchers.push(w)
    } catch {
      /* unreadable dir — skip it */
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
    this.watchers = []
  }
}
