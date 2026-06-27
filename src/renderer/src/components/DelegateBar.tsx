import { useEffect, useRef, useState } from 'react'
import type { DelegateModelInfo } from '../../../shared/events'
import type { SessionState } from '../session-model'

interface Props {
  session: SessionState
  /** delegate models the dropdown may offer; not-ready ones appear disabled to nudge to Settings */
  availableModels: DelegateModelInfo[]
  /** change the chat's target model. 'claude' = native (just switches where the next prompt goes). */
  onModelChange: (model: string) => void
  /** a delegated turn finished: App marks the chat as having unmerged delegate turns. */
  onComplete: (label: string) => void
  /** fold the delegate exchange back into Claude: types `text` into the live claude as a user turn. */
  onMerge: (text: string) => void
}

interface ThreadTurn {
  prompt: string
  answer: string
  model: string
}

/**
 * Per-chat control docked under a Claude window: a model dropdown (default "Claude (native)") plus,
 * when a non-Claude model is picked, a prompt box, a live "working/streaming" view, and the running
 * thread of this session's delegated turns (so you can see the back-and-forth is retained). A
 * "Return to Claude" button folds everything back into the native chat via --resume.
 */
export function DelegateBar({ session, availableModels, onModelChange, onComplete, onMerge }: Props): JSX.Element | null {
  const [prompt, setPrompt] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadTurn[]>([])
  const turnIdRef = useRef<string | null>(null)
  const pendingPromptRef = useRef('')
  const streamBoxRef = useRef<HTMLDivElement>(null)

  const selected = session.selectedModel || 'claude'
  const current = availableModels.find((m) => m.provider === selected) ?? null
  // a delegate turn is only possible on a *ready* provider; not-ready selections just show a hint
  const isDelegate = selected !== 'claude' && !!current?.ready

  useEffect(() => {
    const offToken = window.orbit.onDelegateToken((t) => {
      if (t.sessionId !== session.id || t.turnId !== turnIdRef.current) return
      setStreamText((prev) => prev + t.chunk)
    })
    const offDone = window.orbit.onDelegateDone((d) => {
      if (d.sessionId !== session.id || d.turnId !== turnIdRef.current) return
      turnIdRef.current = null
      setStreaming(false)
      setStreamText('')
      setThread((prev) => [...prev, { prompt: pendingPromptRef.current, answer: d.text, model: current?.label ?? selected }])
      onComplete(current?.label ?? selected)
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

  // keep the live view + thread pinned to the latest content
  useEffect(() => {
    const el = streamBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamText, thread.length])

  if (!availableModels.length) return null

  const send = (): void => {
    const text = prompt.trim()
    if (!text || streaming || !current?.ready) return
    const turnId = crypto.randomUUID()
    turnIdRef.current = turnId
    pendingPromptRef.current = text
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
      prompt: text,
      history: thread.map((t) => ({ prompt: t.prompt, answer: t.answer }))
    })
    setPrompt('')
  }

  const cancel = (): void => {
    if (turnIdRef.current) window.orbit.delegateCancel(turnIdRef.current)
    turnIdRef.current = null
    setStreaming(false)
  }

  // Fold the side-conversation back into Claude: a single user message Claude reads + continues from.
  const returnToClaude = (): void => {
    if (thread.length) {
      const blocks = thread.map(
        (t) => `**Me → ${t.model}:**\n${t.prompt}\n\n**${t.model}:**\n${t.answer}`
      )
      onMerge(
        'While you were paused I consulted external model(s) via Orbit. Here is the full exchange — ' +
          'please read it and continue our work with it in mind:\n\n' +
          blocks.join('\n\n———\n\n')
      )
    } else {
      onModelChange('claude')
    }
    setThread([])
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
            <option key={m.provider} value={m.provider} disabled={!m.ready}>
              {m.label}
            </option>
          ))}
        </select>
        {/* Unmerged delegate turns exist → offer to fold them back into the native Claude chat. */}
        {session.delegateStale && (
          <button
            className="delegate-merge"
            onClick={returnToClaude}
            title="Send this whole exchange into Claude as a message, so it continues with full context"
          >
            ⤺ Return to Claude{thread.length ? ` (${thread.length})` : ''}
          </button>
        )}
      </div>

      {isDelegate && (
        <>
          {/* The session's delegated Q&A so far — makes the retained back-and-forth visible. */}
          {(thread.length > 0 || streaming || error) && (
            <div className="delegate-thread" ref={streamBoxRef}>
              {thread.map((t, i) => (
                <div key={i} className="delegate-msg">
                  <div className="delegate-q">❯ {t.prompt}</div>
                  <div className="delegate-a">{t.answer}</div>
                </div>
              ))}
              {streaming && (
                <div className="delegate-msg live">
                  <div className="delegate-q">❯ {pendingPromptRef.current}</div>
                  <div className="delegate-a">
                    {streamText ? (
                      <>
                        {streamText}
                        <span className="delegate-caret">▋</span>
                      </>
                    ) : (
                      <span className="delegate-working">
                        <span className="delegate-spinner">●</span> {current?.label ?? 'model'} is working…
                      </span>
                    )}
                  </div>
                </div>
              )}
              {error && <div className="delegate-error">⚠ {error}</div>}
            </div>
          )}

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
        </>
      )}
    </div>
  )
}
