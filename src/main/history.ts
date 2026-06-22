import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HistoryEntry } from '../shared/events'

/**
 * Claude stores per-project transcripts at
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * where the cwd is encoded by replacing every non-alphanumeric char with '-'
 * (so ':' '\' '/' AND spaces, dots, underscores all collapse to '-'). The old
 * narrower `[:\\/]` regex left spaces intact, so any project path with a space
 * (e.g. "Casual Friday") pointed at a directory that doesn't exist — breaking
 * History and branch/duplicate (Ctrl+Shift+D) for that project.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function projectTranscriptDir(cwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd))
}

/** Read up to `maxBytes` from the head of a file (cheap; avoids reading huge transcripts). */
function readHead(file: string, maxBytes = 65536): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, maxBytes)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    return buf.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

function rawText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const block = content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    return block ? block.text : ''
  }
  return ''
}

/** Best-effort human title for a transcript: a summary line, else the first real user prompt. */
function titleFromHead(head: string): string {
  const lines = head.split('\n')
  if (lines.length > 1) lines.pop() // drop trailing partial line
  let firstUser = ''
  for (const ln of lines) {
    const s = ln.trim()
    if (!s) continue
    let o: any
    try {
      o = JSON.parse(s)
    } catch {
      continue
    }
    if (o.type === 'summary' && typeof o.summary === 'string' && o.summary.trim()) {
      return o.summary.trim().slice(0, 100)
    }
    if (!firstUser && o.type === 'user' && !o.isMeta) {
      const t = rawText(o.message?.content)
      const clean = t.replace(/\s+/g, ' ').trim()
      // skip command-caveat / slash-command / tag-wrapped messages
      if (clean && !clean.startsWith('<')) firstUser = clean.slice(0, 100)
    }
  }
  return firstUser
}

/** List past claude conversations for a project, most recent first. */
export function listHistory(cwd: string, limit = 50): HistoryEntry[] {
  const dir = projectTranscriptDir(cwd)
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
  } catch {
    return []
  }
  const entries: HistoryEntry[] = []
  for (const name of names) {
    const full = path.join(dir, name)
    let updatedAt = 0
    try {
      updatedAt = fs.statSync(full).mtimeMs
    } catch {
      continue
    }
    const sessionId = name.replace(/\.jsonl$/, '')
    const title = titleFromHead(readHead(full)) || `session ${sessionId.slice(0, 8)}`
    entries.push({ sessionId, title, updatedAt })
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  return entries.slice(0, limit)
}

/**
 * Fork ("branch") a claude conversation: copy its transcript to a brand-new session id so the
 * two diverge independently from the same shared history. A chat's whole context IS this `.jsonl`
 * file, so a copy under a new id, resumed in its own process, is a genuine second conversation —
 * resumable from History, never fighting the original over one file.
 *
 * Every line's `sessionId` is rewritten to the new id so the fork is byte-for-byte indistinguishable
 * from a natively-created transcript (claude keys some lines by it, and `--resume` matches the file
 * name). The message tree (`uuid`/`parentUuid`) is preserved verbatim — the two files are never
 * loaded together, so the shared uuids can't collide. Unparseable lines (a partial last line claude
 * was mid-write on) are dropped so the fork is always clean. Returns the new id, or null if the
 * source transcript is missing/empty or the copy failed.
 */
export function duplicateTranscript(cwd: string, sourceSessionId: string): string | null {
  const dir = projectTranscriptDir(cwd)
  let raw: string
  try {
    raw = fs.readFileSync(path.join(dir, `${sourceSessionId}.jsonl`), 'utf8')
  } catch {
    return null
  }
  const newId = randomUUID()
  const out: string[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let o: any
    try {
      o = JSON.parse(s)
    } catch {
      continue // drop a partial/garbage line rather than copy invalid JSON into the fork
    }
    if (typeof o.sessionId === 'string') o.sessionId = newId
    out.push(JSON.stringify(o))
  }
  if (!out.length) return null
  try {
    fs.writeFileSync(path.join(dir, `${newId}.jsonl`), out.join('\n') + '\n', 'utf8')
  } catch {
    return null
  }
  return newId
}
