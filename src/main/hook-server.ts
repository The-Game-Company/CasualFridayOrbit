import http from 'node:http'
import crypto from 'node:crypto'
import type { HookEvent } from '../shared/events'

export interface HookServer {
  port: number
  token: string
  close(): void
}

/**
 * A tiny localhost-only HTTP server that receives hook events from the claude
 * session. The injected hooks (see settings-inject.ts) run a forwarder that POSTs
 * each hook payload here. Access is gated by a per-session random token so only our
 * own spawned claude can push events.
 */
export function startHookServer(onEvent: (evt: HookEvent) => void): Promise<HookServer> {
  const token = crypto.randomBytes(16).toString('hex')

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404)
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 5_000_000) req.destroy() // guard against runaway payloads
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          const ok = parsed.token === token || req.headers['x-orbit-token'] === token
          if (ok) {
            onEvent({
              sessionId: String(parsed.sessionId ?? ''),
              event: String(parsed.event ?? 'unknown'),
              ts: parsed.ts ?? Date.now(),
              data: parsed.data
            })
          }
        } catch {
          /* ignore malformed payloads */
        }
        res.writeHead(204)
        res.end()
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ port, token, close: () => server.close() })
    })
  })
}
