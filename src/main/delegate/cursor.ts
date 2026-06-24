import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { StreamArgs } from './providers'
import type { PortableContext } from './transcript-read'

/**
 * Cursor (Composer) client — driven through the `cursor-agent` CLI in headless mode, because
 * Cursor's Composer model has no public REST endpoint (it's locked to Cursor's backend). This is
 * the same "drive a coding-agent CLI" pattern Orbit already uses for `claude`.
 *
 *   cursor-agent -p --output-format stream-json --stream-partial-output --model <m> "<prompt>"
 *
 * Auth uses the user's existing `cursor-agent login` (credentials the CLI stores locally) — no API
 * key required, mirroring how Orbit drives the logged-in `claude`. A CURSOR_API_KEY is only set if
 * one was explicitly supplied (for CI-style setups). We never pass `--force`, so the agent only
 * *proposes* changes and never edits files — it just answers. Prior chat context is handed over via
 * a temp file (referenced in the prompt) so we never blow the Windows command-line length limit.
 */

function findOnPath(name: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    const full = path.join(d, name)
    try {
      if (fs.existsSync(full)) return full
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Resolve the cursor-agent binary. PATH first (covers a logged-in shell), then the known install
 * dirs — important because Orbit's process captured PATH at launch, so a freshly-installed CLI
 * won't be on our PATH until restart; probing the install dir lets a Settings "Re-check" find it.
 * On Windows the installer drops a `cursor-agent.cmd` shim in %LOCALAPPDATA%\cursor-agent.
 */
export function resolveCursorAgent(): string | null {
  const names =
    process.platform === 'win32'
      ? ['cursor-agent.cmd', 'cursor-agent.exe', 'cursor-agent', 'agent.cmd', 'agent.exe', 'agent']
      : ['cursor-agent', 'agent']
  for (const n of names) {
    const p = findOnPath(n)
    if (p) return p
  }
  const home = os.homedir()
  const dirs = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'cursor-agent'),
    path.join(home, 'AppData', 'Local', 'cursor-agent'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin')
  ].filter((d): d is string => !!d)
  for (const d of dirs) {
    for (const n of names) {
      const f = path.join(d, n)
      try {
        if (fs.existsSync(f)) return f
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export function cursorAgentAvailable(): boolean {
  return resolveCursorAgent() !== null
}

/** Render the portable context into a readable transcript a CLI agent can consume from a file. */
function contextToText(ctx: PortableContext): string {
  if (!ctx.messages.length) return ''
  const out: string[] = ['# Prior conversation (for context)\n']
  for (const m of ctx.messages) {
    const body = m.parts.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n')
    out.push(`## ${m.role}\n${body}\n`)
  }
  return out.join('\n')
}

/** Pull the text out of a cursor-agent assistant/result event's message.content. */
function textOf(ev: any): string {
  const c = ev?.message?.content
  if (Array.isArray(c)) {
    return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
  }
  return typeof c === 'string' ? c : ''
}

export async function streamCursor(args: StreamArgs): Promise<string> {
  const bin = resolveCursorAgent()
  if (!bin) throw new Error('Cursor CLI (cursor-agent) is not installed or not on PATH.')

  // Pass the (possibly multi-line) prompt + context through a temp FILE, never the command line:
  // cursor-agent reads file paths mentioned in the prompt, and this sidesteps Windows .cmd arg
  // quoting entirely — the only CLI arg is a fixed instruction plus a safe temp path.
  const taskFile = path.join(os.tmpdir(), `orbit-delegate-${randomUUID()}.md`)
  let wroteFile = false
  let promptArg = args.prompt
  try {
    const ctx = contextToText(args.context)
    const body = `# Task\n\n${args.prompt}\n${ctx ? `\n# Prior conversation (context)\n\n${ctx}\n` : ''}`
    fs.writeFileSync(taskFile, body, 'utf8')
    wroteFile = true
    promptArg =
      `Read the file "${taskFile}". It contains a "# Task" to complete` +
      (args.context.messages.length ? ' plus a "# Prior conversation (context)" section for background' : '') +
      '. Do the task and reply with your answer.'
  } catch {
    promptArg = args.prompt // best-effort fallback: inline prompt
  }

  const cliArgs = ['-p', '--output-format', 'stream-json', '--stream-partial-output']
  if (args.model) cliArgs.push('--model', args.model)
  cliArgs.push(promptArg)

  // ConPTY/CreateProcess can't exec a .cmd directly — route it through the interpreter.
  let file = bin
  let spawnArgs = cliArgs
  if (/\.(cmd|bat)$/i.test(bin)) {
    spawnArgs = ['/c', bin, ...cliArgs]
    file = process.env.ComSpec || 'cmd.exe'
  }

  // Rely on the stored `cursor-agent login` by default; only inject a key if one was provided.
  const env = { ...process.env }
  if (args.apiKey) env.CURSOR_API_KEY = args.apiKey

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(file, spawnArgs, {
      cwd: args.cwd,
      env,
      windowsHide: true
    })

    // Per-segment dedup: each assistant event carries the current segment's full text (growing
    // with --stream-partial-output). Emit only the new suffix; a non-prefix means a new segment.
    let currentSeg = ''
    let full = ''
    let resultText = ''
    let stderr = ''
    let buf = ''

    const onAbort = (): void => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
    if (args.signal.aborted) onAbort()
    args.signal.addEventListener('abort', onAbort)

    const cleanup = (): void => {
      args.signal.removeEventListener('abort', onAbort)
      if (wroteFile) {
        try {
          fs.unlinkSync(taskFile)
        } catch {
          /* ignore */
        }
      }
    }

    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        if (ev.type === 'assistant') {
          if (ev.model_call_id) continue // buffered duplicate flush before a tool call — skip
          const seg = textOf(ev)
          if (!seg) continue
          const newPart = seg.startsWith(currentSeg) ? seg.slice(currentSeg.length) : seg
          currentSeg = seg
          if (newPart) {
            full += newPart
            args.onToken(newPart)
          }
        } else if (ev.type === 'result') {
          if (typeof ev.result === 'string') resultText = ev.result
          if (ev.is_error && ev.result) stderr += String(ev.result)
        }
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (e) => {
      cleanup()
      reject(new Error(`cursor-agent failed to start: ${e.message}`))
    })
    child.on('close', (code) => {
      cleanup()
      if (args.signal.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      const finalText = resultText || full
      if (!finalText.trim() && code !== 0) {
        reject(new Error(stderr.trim().slice(0, 500) || `cursor-agent exited with code ${code}`))
        return
      }
      // If the result event held more than we streamed, flush the remainder.
      if (resultText && resultText.startsWith(full) && resultText.length > full.length) {
        args.onToken(resultText.slice(full.length))
      }
      resolve(finalText)
    })
  })
}
