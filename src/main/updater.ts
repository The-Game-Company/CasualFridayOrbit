import { execFile, spawn } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import { resolveClaudePath } from './pty'
import { BUILT_AGAINST_CLAUDE_VERSION } from '../shared/built-against'
import type { UpdateProgress, UpdateResult, UpdateStatus } from '../shared/events'

const pExecFile = promisify(execFile)

const WINGET_ID = 'Anthropic.ClaudeCode'

/** Where Claude Code came from decides how we upgrade it. The WinGet shim lives under a
 *  WinGet\Packages path; anything else we treat as a self-updating native/npm install. */
function installMethod(): 'winget' | 'native' {
  return resolveClaudePath().toLowerCase().includes('winget') ? 'winget' : 'native'
}

const verOf = (s: string): string | null => s.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null

/** `a < b` by dotted numeric semver (missing parts treated as 0). */
function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

async function currentVersion(): Promise<string | null> {
  try {
    const { stdout } = await pExecFile(resolveClaudePath(), ['--version'], { timeout: 10_000 })
    return verOf(stdout)
  } catch {
    return null
  }
}

/** Newest version WinGet can install (read-only: `winget show` never modifies anything). */
async function wingetLatest(): Promise<string | null> {
  try {
    const { stdout } = await pExecFile(
      'winget',
      ['show', '--id', WINGET_ID, '--source', 'winget', '--accept-source-agreements'],
      { timeout: 30_000 }
    )
    return stdout.match(/Version:\s*([\d.]+)/)?.[1] ?? null
  } catch {
    return null
  }
}

/** Newest version published to npm (used for non-WinGet installs). */
function npmLatest(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://registry.npmjs.org/@anthropic-ai/claude-code/latest',
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).version ?? null)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(10_000, () => {
      req.destroy()
      resolve(null)
    })
  })
}

/** Number of claude.exe processes alive right now. At launch (before Orbit spawns any of its
 *  own) these are all external — terminals/other tools that would lock the binary on upgrade. */
async function externalClaudeCount(): Promise<number> {
  if (process.platform !== 'win32') return 0
  try {
    const { stdout } = await pExecFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq claude.exe', '/NH', '/FO', 'CSV'],
      { timeout: 10_000 }
    )
    return stdout.split(/\r?\n/).filter((l) => /claude\.exe/i.test(l)).length
  } catch {
    return 0
  }
}

export async function checkUpdate(): Promise<UpdateStatus> {
  const method = installMethod()
  const [current, latest, externalProcesses] = await Promise.all([
    currentVersion(),
    method === 'winget' ? wingetLatest() : npmLatest(),
    externalClaudeCount()
  ])
  const builtAgainst = BUILT_AGAINST_CLAUDE_VERSION
  return {
    installMethod: method,
    current,
    latest,
    updateAvailable: !!(current && latest && isOlder(current, latest)),
    externalProcesses,
    builtAgainst,
    // "untested" = the version we'd move to is newer than the one Orbit was built against
    latestUntested: !!(latest && builtAgainst && isOlder(builtAgainst, latest))
  }
}

/** Force-close every claude.exe (and its children) so the upgrade can replace the binary. */
export async function closeExternalClaude(): Promise<number> {
  if (process.platform !== 'win32') return 0
  try {
    await pExecFile('taskkill', ['/F', '/IM', 'claude.exe', '/T'], { timeout: 10_000 })
  } catch {
    /* none running, or some already gone — recount below tells the truth */
  }
  return externalClaudeCount()
}

/** Pull a 0–100 percentage out of a tool line, if one is present (winget shows these). */
function parsePct(line: string): number | null {
  const m = line.match(/(\d{1,3})\s*%/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 100 ? n : null
}

/**
 * Run the upgrade, streaming progress as it goes. We use `spawn` (not buffered execFile) so the
 * UI can show a live progress bar: each tick carries the latest meaningful line and a parsed
 * percentage when the tool reports one (otherwise the bar is shown as indeterminate).
 */
export function runUpdate(onProgress?: (p: UpdateProgress) => void): Promise<UpdateResult> {
  const method = installMethod()
  const cmd = method === 'winget' ? 'winget' : resolveClaudePath()
  const args: string[] =
    method === 'winget'
      ? [
          'upgrade',
          '--id',
          WINGET_ID,
          '--silent',
          '--accept-source-agreements',
          '--accept-package-agreements'
        ]
      : ['update']

  return new Promise((resolve) => {
    let buf = ''
    let lastPct: number | null = null
    const tail = (): string => buf.slice(-4000)

    const child = spawn(cmd, args, { windowsHide: true })
    const timer = setTimeout(() => child.kill(), 300_000)

    // winget redraws its progress line with \r; split on either so each redraw is its own "line"
    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString()
      buf += text
      for (const raw of text.split(/\r\n|\r|\n/)) {
        const line = raw.trim()
        if (!line) continue
        const pct = parsePct(line)
        if (pct != null) lastPct = pct
        onProgress?.({ line, pct: pct ?? lastPct })
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, output: tail() + '\n' + (err.message ?? String(err)) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) onProgress?.({ line: 'Upgrade complete.', pct: 100 })
      resolve({ ok: code === 0, output: tail() })
    })
  })
}
