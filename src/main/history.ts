import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HistoryEntry } from '../shared/events'

/**
 * Claude stores per-project transcripts at
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * where the cwd is encoded by replacing ':' '\' '/' with '-'.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-')
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
