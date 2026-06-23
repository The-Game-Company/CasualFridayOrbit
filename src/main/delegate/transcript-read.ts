import fs from 'node:fs'
import path from 'node:path'
import { projectTranscriptDir } from '../history'

/**
 * Reads a Claude Code transcript JSONL and flattens it into a portable, provider-agnostic
 * conversation so a non-Claude model can continue it with full context.
 *
 * Claude's transcript is a tree of richly-typed lines (thinking, tool_use/tool_result, images,
 * plus meta lines). We keep only the user/assistant message lines, drop thinking (internal +
 * opaque signature) and all meta lines, and render tool calls/results as compact text notes so
 * the external model can see what happened without us forging foreign tool-call structures.
 * Consecutive same-role lines are merged so the result strictly alternates user/assistant —
 * required by providers like Gemini.
 */

export type PortablePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string }

export interface PortableMessage {
  role: 'user' | 'assistant'
  parts: PortablePart[]
}

export interface PortableContext {
  /** present only if a system prompt could be derived (claude rarely stores one as a line) */
  system?: string
  /** prior conversation, oldest→newest, strictly alternating user/assistant */
  messages: PortableMessage[]
}

/** ~chars to keep (trimmed from the oldest end) so we never ship a multi-MB transcript to an API. */
const DEFAULT_MAX_CHARS = 400_000

function textPart(text: string): PortablePart {
  return { type: 'text', text }
}

/** Pull plain text (and any images) out of a tool_result block's `content` (string | block[]). */
function fromToolResultContent(content: unknown): PortablePart[] {
  if (typeof content === 'string') return content.trim() ? [textPart(content)] : []
  if (Array.isArray(content)) {
    const out: PortablePart[] = []
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string') out.push(textPart(b.text))
      else if (b?.type === 'image' && b.source) {
        const img = imageFromSource(b.source)
        if (img) out.push(img)
      }
    }
    return out
  }
  return []
}

function imageFromSource(source: any): PortablePart | null {
  if (source?.type === 'base64' && typeof source.data === 'string') {
    return { type: 'image', mediaType: typeof source.media_type === 'string' ? source.media_type : 'image/png', dataBase64: source.data }
  }
  return null
}

function compactInput(input: unknown): string {
  try {
    const s = JSON.stringify(input)
    return s.length > 200 ? s.slice(0, 200) + '…' : s
  } catch {
    return ''
  }
}

/** Convert one transcript line's message into portable parts, or null to drop the line. */
function partsFromLine(o: any): { role: 'user' | 'assistant'; parts: PortablePart[] } | null {
  if (o?.isMeta) return null
  const type = o?.type
  if (type !== 'user' && type !== 'assistant') return null
  const content = o?.message?.content
  const parts: PortablePart[] = []

  if (typeof content === 'string') {
    const t = content.trim()
    // skip system-injected wrapped messages (e.g. <local-command-caveat>…), keep real prose
    if (t && !t.startsWith('<')) parts.push(textPart(content))
  } else if (Array.isArray(content)) {
    for (const b of content) {
      switch (b?.type) {
        case 'text':
          if (typeof b.text === 'string' && b.text.trim()) parts.push(textPart(b.text))
          break
        case 'thinking':
          break // internal reasoning — drop
        case 'tool_use':
          parts.push(textPart(`[tool: ${b.name}(${compactInput(b.input)})]`))
          break
        case 'tool_result': {
          const inner = fromToolResultContent(b.content)
          const prefix = b.is_error ? '[tool error] ' : '[tool result] '
          if (inner.length) {
            const first = inner[0]
            if (first.type === 'text') inner[0] = textPart(prefix + first.text)
            else inner.unshift(textPart(prefix.trim()))
          }
          parts.push(...inner)
          break
        }
        case 'image': {
          const img = imageFromSource(b.source)
          if (img) parts.push(img)
          break
        }
        default:
          break
      }
    }
  }

  return parts.length ? { role: type, parts } : null
}

/** Merge consecutive same-role messages into one so the sequence strictly alternates. */
function mergeRuns(seq: { role: 'user' | 'assistant'; parts: PortablePart[] }[]): PortableMessage[] {
  const out: PortableMessage[] = []
  for (const m of seq) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.parts.push(...m.parts)
    else out.push({ role: m.role, parts: [...m.parts] })
  }
  return out
}

function approxLen(m: PortableMessage): number {
  let n = 0
  for (const p of m.parts) n += p.type === 'text' ? p.text.length : 2000 // count an image as a fixed weight
  return n
}

/** Trim oldest messages until under the char budget; keep the sequence starting on a user turn. */
function trimToBudget(messages: PortableMessage[], maxChars: number): PortableMessage[] {
  let total = messages.reduce((n, m) => n + approxLen(m), 0)
  let start = 0
  while (total > maxChars && start < messages.length - 1) {
    total -= approxLen(messages[start])
    start++
  }
  let trimmed = messages.slice(start)
  // a model expects history to begin with a user turn — drop a leading assistant if trimming exposed one
  while (trimmed.length && trimmed[0].role === 'assistant') trimmed = trimmed.slice(1)
  return trimmed
}

/**
 * Build portable context from a claude session's transcript. Returns empty messages if the
 * transcript is missing/unreadable (e.g. a brand-new chat) — the caller then sends just the prompt.
 */
export function buildContext(cwd: string, sessionId: string, maxChars = DEFAULT_MAX_CHARS): PortableContext {
  if (!sessionId) return { messages: [] }
  let raw: string
  try {
    raw = fs.readFileSync(path.join(projectTranscriptDir(cwd), `${sessionId}.jsonl`), 'utf8')
  } catch {
    return { messages: [] }
  }
  const seq: { role: 'user' | 'assistant'; parts: PortablePart[] }[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let o: any
    try {
      o = JSON.parse(s)
    } catch {
      continue
    }
    const m = partsFromLine(o)
    if (m) seq.push(m)
  }
  const merged = mergeRuns(seq)
  return { messages: trimToBudget(merged, maxChars) }
}
