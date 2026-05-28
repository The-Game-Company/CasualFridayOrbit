import { execFileSync } from 'node:child_process'

/**
 * Make a Finder-launched app see the same PATH as the user's terminal.
 *
 * On macOS a GUI app started from Finder/Dock inherits only a minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`) — it never sources the login shell, so `claude`, `node`,
 * `git`, Homebrew, etc. installed under `/opt/homebrew/bin`, `/usr/local/bin`, or `~/.local/bin`
 * are invisible. We resolve the real PATH by asking the user's login shell once and merge any
 * missing entries into `process.env.PATH`, so every process Orbit spawns (claude included) can
 * find its tools regardless of how Orbit was launched.
 *
 * No-op on Windows (GUI apps already inherit the full PATH) and on Linux, so this can never
 * change behavior on the platforms Orbit already ships on.
 */
export function fixGuiPath(): void {
  if (process.platform !== 'darwin') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    // -i -l -c: interactive login shell so it sources the same profile a Terminal would.
    // Markers fence off the PATH so any banner printed by the user's rc files is ignored.
    const out = execFileSync(shell, ['-ilc', 'printf "__ORBIT_PATH__%s__END__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000
    })
    const resolved = out.match(/__ORBIT_PATH__(.*)__END__/s)?.[1]
    if (!resolved) return
    const have = new Set((process.env.PATH || '').split(':').filter(Boolean))
    const merged = [...have]
    for (const dir of resolved.split(':').filter(Boolean)) {
      if (!have.has(dir)) {
        have.add(dir)
        merged.push(dir)
      }
    }
    process.env.PATH = merged.join(':')
  } catch {
    /* couldn't reach the login shell — leave PATH as-is */
  }
}
