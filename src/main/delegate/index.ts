import type { DelegateSendArgs, DelegateStatuses } from '../../shared/events'
import { buildContext } from './transcript-read'
import { streamCompletion, IMPLEMENTED } from './providers'
import { cursorAgentAvailable } from './cursor'
import { availability, getKey } from '../provider-keys'

/**
 * Orchestrates one delegated turn end-to-end: pick the key, build context from the transcript,
 * stream the external model's answer (forwarding tokens), then write the exchange back into the
 * transcript (append to the existing one, or create a fresh one for start-of-chat). Keeps a
 * per-turn AbortController so a turn can be canceled mid-stream.
 */

const inflight = new Map<string, AbortController>()

/**
 * Per-provider readiness for the dropdown + Settings. OpenAI/Gemini are REST APIs gated on a stored
 * key; Cursor is the logged-in `cursor-agent` CLI (no key — `cursor-agent login` provides auth), so
 * it's ready when the CLI is installed.
 */
export function delegateStatuses(): DelegateStatuses {
  const have = availability()
  const cursorCli = cursorAgentAvailable()
  return {
    openai: { hasKey: have.openai, ready: have.openai && IMPLEMENTED.openai },
    gemini: { hasKey: have.gemini, ready: have.gemini && IMPLEMENTED.gemini },
    composer: {
      hasKey: false, // Cursor needs no API key — it uses the cursor-agent login
      ready: IMPLEMENTED.composer && cursorCli,
      note: cursorCli ? undefined : 'Cursor CLI (cursor-agent) not found on PATH.'
    }
  }
}

export interface DelegateCallbacks {
  onToken: (chunk: string) => void
  onDone: (text: string) => void
  onError: (message: string) => void
}

export async function runDelegate(args: DelegateSendArgs, cb: DelegateCallbacks): Promise<void> {
  if (!IMPLEMENTED[args.provider]) {
    cb.onError(`${args.provider} is not supported yet.`)
    return
  }
  // Cursor authenticates via the cursor-agent login (no key); the REST providers need a stored key.
  let apiKey = ''
  if (args.provider !== 'composer') {
    const k = getKey(args.provider)
    if (!k) {
      cb.onError('No API key is configured for this provider.')
      return
    }
    apiKey = k
  }

  const ac = new AbortController()
  inflight.set(args.turnId, ac)
  try {
    // Context = the native Claude conversation so far (from its transcript) + this session's prior
    // delegated turns (held in the UI, passed in). We do NOT write to Claude's transcript here —
    // delegate turns are folded into Claude on demand by injecting them as a real user message
    // (see the renderer's "Return to Claude"), which avoids fighting Claude's resume-leaf tracking.
    const context = buildContext(args.cwd, args.resumeId || '')
    for (const h of args.history ?? []) {
      context.messages.push({ role: 'user', parts: [{ type: 'text', text: h.prompt }] })
      context.messages.push({ role: 'assistant', parts: [{ type: 'text', text: h.answer }] })
    }
    const answer = await streamCompletion({
      provider: args.provider,
      model: args.model,
      apiKey,
      cwd: args.cwd,
      context,
      prompt: args.prompt,
      onToken: cb.onToken,
      signal: ac.signal
    })
    if (!answer.trim()) {
      cb.onError('The model returned an empty response.')
      return
    }
    cb.onDone(answer)
  } catch (e: any) {
    if (e?.name === 'AbortError') cb.onError('Canceled.')
    else cb.onError(e?.message ? String(e.message) : 'Delegate request failed.')
  } finally {
    inflight.delete(args.turnId)
  }
}

export function cancelDelegate(turnId: string): void {
  inflight.get(turnId)?.abort()
  inflight.delete(turnId)
}
