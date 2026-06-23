import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectTranscriptDir } from '../history'
import type { DelegateProvider } from '../../shared/events'

/**
 * Forge + persist a delegated turn into a Claude Code transcript (approach "1A").
 *
 * A chat's whole context IS its transcript JSONL, and Claude loads it verbatim on `--resume`. So
 * to make a non-Claude turn a real, durable part of the conversation we write a clean user line
 * (the prompt) followed by an `assistant` line carrying the external model's answer — chained via
 * `parentUuid` to the current leaf and tagged with `message.model` (e.g. "gpt-5") plus an
 * `orbitDelegate` marker so Orbit can recognize its own forged turns. The content stays clean (no
 * badges) so Claude continues from it exactly as it would from its own turn.
 *
 * This mirrors the existing transcript-rewriting Orbit already does in history.ts::duplicateTranscript.
 */

export interface DelegateTurn {
  provider: DelegateProvider
  /** provider model id, used as the forged assistant's message.model */
  model: string
  prompt: string
  answer: string
}

interface LeafInfo {
  parentUuid: string | null
  cwd?: string
  version?: string
  gitBranch?: string
}

const nowIso = (): string => new Date().toISOString()

/** Scan parsed lines newest→oldest for the last real message (the tree leaf) to chain onto. */
function findLeaf(lines: any[], fallbackCwd: string): LeafInfo {
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i]
    if ((o?.type === 'user' || o?.type === 'assistant') && typeof o?.uuid === 'string') {
      return {
        parentUuid: o.uuid,
        cwd: typeof o.cwd === 'string' ? o.cwd : fallbackCwd,
        version: typeof o.version === 'string' ? o.version : undefined,
        gitBranch: typeof o.gitBranch === 'string' ? o.gitBranch : undefined
      }
    }
  }
  return { parentUuid: null, cwd: fallbackCwd }
}

function forgeUserLine(prompt: string, sessionId: string, parentUuid: string | null, leaf: LeafInfo): any {
  const line: any = {
    parentUuid,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: prompt },
    uuid: randomUUID(),
    timestamp: nowIso(),
    userType: 'external',
    entrypoint: 'cli',
    cwd: leaf.cwd,
    sessionId
  }
  if (leaf.version) line.version = leaf.version
  if (leaf.gitBranch) line.gitBranch = leaf.gitBranch
  return line
}

function forgeAssistantLine(
  turn: DelegateTurn,
  sessionId: string,
  parentUuid: string,
  leaf: LeafInfo
): any {
  const line: any = {
    parentUuid,
    isSidechain: false,
    message: {
      model: turn.model,
      id: `msg_${randomUUID().replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: turn.answer }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }
    },
    // marker so Orbit recognizes its own forged turns (Claude ignores unknown top-level keys)
    orbitDelegate: { provider: turn.provider, model: turn.model },
    requestId: `req_${randomUUID().replace(/-/g, '')}`,
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: nowIso(),
    userType: 'external',
    entrypoint: 'cli',
    cwd: leaf.cwd,
    sessionId
  }
  if (leaf.version) line.version = leaf.version
  if (leaf.gitBranch) line.gitBranch = leaf.gitBranch
  return line
}

function readParsedLines(file: string): any[] {
  const raw = fs.readFileSync(file, 'utf8')
  const out: any[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {
      /* skip a partial/garbage line */
    }
  }
  return out
}

export interface AppendResult {
  ok: boolean
  error?: string
}

/**
 * Append a forged user+assistant pair to an existing transcript. Returns {ok:false} if the
 * transcript can't be read/written (caller should surface an error and not claim success).
 */
export function appendDelegateTurn(cwd: string, sessionId: string, turn: DelegateTurn): AppendResult {
  const file = path.join(projectTranscriptDir(cwd), `${sessionId}.jsonl`)
  let lines: any[]
  try {
    lines = readParsedLines(file)
  } catch {
    return { ok: false, error: 'transcript not found' }
  }
  const leaf = findLeaf(lines, cwd)
  const userLine = forgeUserLine(turn.prompt, sessionId, leaf.parentUuid, leaf)
  const assistantLine = forgeAssistantLine(turn, sessionId, userLine.uuid, leaf)
  try {
    fs.appendFileSync(file, JSON.stringify(userLine) + '\n' + JSON.stringify(assistantLine) + '\n', 'utf8')
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to write transcript' }
  }
}

/**
 * Create a brand-new transcript seeded with a single delegated exchange (start-of-chat
 * delegation, before any claude process has run). Returns the new session id to --resume, or null.
 */
export function createDelegateTranscript(cwd: string, turn: DelegateTurn): string | null {
  const dir = projectTranscriptDir(cwd)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }
  const sessionId = randomUUID()
  const leaf: LeafInfo = { parentUuid: null, cwd }
  const modeLine = { type: 'mode', mode: 'normal', sessionId }
  const userLine = forgeUserLine(turn.prompt, sessionId, null, leaf)
  const assistantLine = forgeAssistantLine(turn, sessionId, userLine.uuid, leaf)
  const body =
    JSON.stringify(modeLine) + '\n' + JSON.stringify(userLine) + '\n' + JSON.stringify(assistantLine) + '\n'
  try {
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), body, 'utf8')
    return sessionId
  } catch {
    return null
  }
}
