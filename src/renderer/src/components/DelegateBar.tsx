import { useEffect, useRef, useState } from 'react'
import type { DelegateModelInfo } from '../../../shared/events'
import type { SessionState } from '../session-model'

interface Props {
  session: SessionState
  /** delegate models the dropdown may offer (only providers with a key + a working client) */
  availableModels: DelegateModelInfo[]
  /** change the chat's target model. 'claude' = native; App reconciles a stale chat on switch-back. */
  onModelChange: (model: string) => void
  /** a delegated turn finished and was written to the transcript: App marks the chat stale +
   *  adopts a freshly-created transcript id (start-of-chat case). */
  onComplete: (label: string, newResumeId?: string) => void
}

/**
 * Per-chat control docked under a Claude window: a model dropdown (default "Claude (native)")
 * plus, when a non-Claude model is picked, a slim prompt input and a live streaming strip. The
 * answer streams here, then folds into the conversation transcript; the terminal repaints it
 * inline on the next --resume (when the user switches back to Claude). Kept compact so up to four
 * of these can sit side-by-side without crowding the screen.
 */
export function DelegateBar({ session, availableModels, onModelChange, onComplete }: Props): JSX.Element | null {
  const [prompt, setPrompt] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const turnIdRef = useRef<string | null>(null)
  const streamBoxRef = useRef<HTMLDivElement>(null)

  const selected = session.selectedModel || 'claude'
  const isDelegate = selected !== 'claude'
  const current = availableModels.find((m) => m.provider === selected) ?? null

  // Stream subscriptions: filter to this session + the in-flight turn.
  useEffect(() => {
    const offToken = window.orbit.onDelegateToken((t) => {
      if (t.sessionId !== session.id || t.turnId !== turnIdRef.current) return
      setStreamText((prev) => prev + t.chunk)
    })
    const offDone = window.orbit.onDelegateDone((d) => {
      if (d.sessionId !== session.id || d.turnId !== turnIdRef.current) return
      turnIdRef.current = null
      setStreaming(false)
      setStreamText(d.text)
      onComplete(current?.label ?? selected, d.newResumeId)
    })
    const offErr = window.orbit.onDelegateError((d) => {
      if (d.sessionId !== session.id || d.turnId !== turnIdRef.current) return
      turnIdRef.current = null
      setStreaming(false)
      setError(d.message)
    })
    return () => {
      offToken()
      offDone()
      offErr()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, current?.label, selected])

  // Keep the streaming box pinned to the latest tokens.
  useEffect(() => {
    const el = streamBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamText])

  if (!availableModels.length) return null

  const send = (): void => {
    const text = prompt.trim()
    if (!text || streaming || !current) return
    const turnId = crypto.randomUUID()
    turnIdRef.current = turnId
    setError(null)
    setStreamText('')
    setStreaming(true)
    window.orbit.delegateSend({
      turnId,
      sessionId: session.id,
      cwd: session.projectPath,
      resumeId: session.resumeId,
      provider: current.provider,
      model: current.model,
      prompt: text
    })
    setPrompt('')
  }

  const cancel = (): void => {
    if (turnIdRef.current) window.orbit.delegateCancel(turnIdRef.current)
    turnIdRef.current = null
    setStreaming(false)
  }

  return (
    <div className={`delegate-bar${isDelegate ? ' active' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="delegate-row">
        <span className="delegate-label">↪</span>
        <select
          className="delegate-select"
          value={selected}
          onChange={(e) => onModelChange(e.target.value)}
          title="Model for this chat's next prompt"
        >
          <option value="claude">Claude (native)</option>
          {availableModels.map((m) => (
            <option key={m.provider} value={m.provider}>
              {m.label}
            </option>
          ))}
        </select>
        {session.delegateStale && selected !== 'claude' && (
          <span className="delegate-stale" title="Switch to Claude (native) to fold these turns back into the chat">
            pending merge
          </span>
        )}
      </div>

      {isDelegate && (
        <div className="delegate-compose">
          <textarea
            className="delegate-input"
            rows={1}
            placeholder={`Ask ${current?.label ?? 'the model'}…`}
            value={prompt}
            disabled={streaming}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {streaming ? (
            <button className="delegate-btn cancel" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button className="delegate-btn" onClick={send} disabled={!prompt.trim()}>
              Send
            </button>
          )}
        </div>
      )}

      {isDelegate && (streaming || streamText || error) && (
        <div className="delegate-stream" ref={streamBoxRef}>
          {error ? (
            <span className="delegate-error">⚠ {error}</span>
          ) : (
            <>
              {streamText}
              {streaming && <span className="delegate-caret">▋</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
