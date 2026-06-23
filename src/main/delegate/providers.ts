import type { DelegateProvider } from '../../shared/events'
import type { PortableContext, PortableMessage, PortablePart } from './transcript-read'
import { streamCursor } from './cursor'

/**
 * Streaming chat clients for non-Claude providers. Each takes the portable context (prior
 * conversation) + the new prompt, streams the answer token-by-token via `onToken`, and resolves
 * with the full text. OpenAI/Gemini are HTTP (global `fetch`/undici, SSE). `composer` (Cursor) has
 * no public REST endpoint for its Composer model, so it's driven through the `cursor-agent` CLI
 * instead (see cursor.ts) — still a first-class provider, just a different transport.
 */

export const IMPLEMENTED: Record<DelegateProvider, boolean> = {
  openai: true,
  gemini: true,
  composer: true
}

export interface StreamArgs {
  provider: DelegateProvider
  model: string
  apiKey: string
  /** project cwd — the workspace for CLI-based providers (Cursor) */
  cwd: string
  context: PortableContext
  prompt: string
  onToken: (chunk: string) => void
  signal: AbortSignal
}

const DEFAULT_SYSTEM =
  'You are continuing an existing software-engineering conversation inside the Orbit coding tool. ' +
  'Earlier turns may include compact bracketed notes like [tool: Grep(...)] or [tool result] — ' +
  'these summarize actions already taken; treat them as context. Answer the latest message directly.'

/** Read an SSE response body line-by-line, invoking `onEvent` with each `data:` JSON payload. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (json: any) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try {
          onEvent(JSON.parse(data))
        } catch {
          /* ignore keep-alive / partial */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.slice(0, 500)
  } catch {
    return ''
  }
}

// ---- OpenAI -----------------------------------------------------------------

function openaiContent(parts: PortablePart[]): any {
  const hasImage = parts.some((p) => p.type === 'image')
  if (!hasImage) return parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } }
  )
}

function openaiMessages(ctx: PortableContext, prompt: string): any[] {
  const msgs: any[] = [{ role: 'system', content: ctx.system || DEFAULT_SYSTEM }]
  for (const m of ctx.messages) msgs.push({ role: m.role, content: openaiContent(m.parts) })
  msgs.push({ role: 'user', content: prompt })
  return msgs
}

async function streamOpenAI(args: StreamArgs): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` },
    body: JSON.stringify({
      model: args.model,
      stream: true,
      messages: openaiMessages(args.context, args.prompt)
    }),
    signal: args.signal
  })
  if (!res.ok || !res.body) throw new Error(`OpenAI ${res.status}: ${await errorText(res)}`)
  let full = ''
  await readSSE(res.body, args.signal, (json) => {
    const delta = json?.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta) {
      full += delta
      args.onToken(delta)
    }
  })
  return full
}

// ---- Gemini -----------------------------------------------------------------

function geminiParts(parts: PortablePart[]): any[] {
  return parts.map((p) =>
    p.type === 'text' ? { text: p.text } : { inline_data: { mime_type: p.mediaType, data: p.dataBase64 } }
  )
}

function geminiContents(messages: PortableMessage[], prompt: string): any[] {
  const out = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: geminiParts(m.parts)
  }))
  out.push({ role: 'user', parts: [{ text: prompt }] })
  return out
}

async function streamGemini(args: StreamArgs): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(args.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: geminiContents(args.context.messages, args.prompt),
      systemInstruction: { parts: [{ text: args.context.system || DEFAULT_SYSTEM }] }
    }),
    signal: args.signal
  })
  if (!res.ok || !res.body) throw new Error(`Gemini ${res.status}: ${await errorText(res)}`)
  let full = ''
  await readSSE(res.body, args.signal, (json) => {
    const parts = json?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p?.text === 'string' && p.text) {
          full += p.text
          args.onToken(p.text)
        }
      }
    }
  })
  return full
}

// ---- dispatch ---------------------------------------------------------------

export async function streamCompletion(args: StreamArgs): Promise<string> {
  switch (args.provider) {
    case 'openai':
      return streamOpenAI(args)
    case 'gemini':
      return streamGemini(args)
    case 'composer':
      return streamCursor(args)
    default:
      throw new Error(`unknown provider: ${args.provider}`)
  }
}
