import { useEffect, useRef, useState } from 'react'
import type { UpdateProgress, UpdateStatus } from '../../../shared/events'

interface Props {
  status: UpdateStatus
  /** "Not now" — dismiss and let Orbit start normally on the current version. */
  onDismiss: () => void
  /** Tear down Orbit's own tabs/windows so nothing holds claude.exe open during the upgrade. */
  onCloseEverything: () => void
}

type Phase = 'prompt' | 'working' | 'done' | 'error'

/**
 * Launch-time gate shown only when a newer Claude Code is available. Claude can't be upgraded
 * while a session has the binary open, so this runs before Orbit starts any windows: the user
 * either skips, or closes everything (Orbit's windows + any external claude.exe) and upgrades.
 */
export function UpdateModal({ status, onDismiss, onCloseEverything }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('prompt')
  const [external, setExternal] = useState(status.externalProcesses)
  const [output, setOutput] = useState('')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  // tear down the progress subscription if the modal unmounts mid-upgrade
  useEffect(() => () => unsubscribe.current?.(), [])

  const upgrade = async (): Promise<void> => {
    setPhase('working')
    setProgress({ line: 'Closing Claude Code…', pct: null })
    onCloseEverything()
    // stream live progress lines/percentages from the upgrade command
    unsubscribe.current = window.orbit.onUpdateProgress(setProgress)
    // External terminals/tools lock the binary — close them, then run the upgrade.
    const left = await window.orbit.closeExternalClaude()
    setExternal(left)
    const res = await window.orbit.runUpdate()
    unsubscribe.current?.()
    unsubscribe.current = null
    setOutput(res.output)
    setPhase(res.ok ? 'done' : 'error')
  }

  return (
    <div className="modal-overlay">
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Claude Code update available</span>
          {phase === 'prompt' && <button onClick={onDismiss}>✕</button>}
        </div>
        <div className="modal-body">
          <div className="update-versions">
            <span className="update-cur">{status.current ?? '?'}</span>
            <span className="update-arrow">→</span>
            <span className={`update-new ${status.latestUntested ? 'untested' : ''}`}>
              {status.latest ?? '?'}
            </span>
            <span className="update-method">via {status.installMethod}</span>
          </div>

          <div className="update-builtagainst" title="The Claude Code version Orbit was built and tested against">
            Orbit tested with Claude Code{' '}
            <b>{status.builtAgainst ?? 'an unknown version'}</b>
          </div>

          {phase === 'prompt' && (
            <>
              <p className="update-note">
                Claude Code can only be upgraded while no session has it open — so Orbit checks at
                launch, before opening any windows.
              </p>
              {status.latestUntested && (
                <div className="update-warn untested">
                  ⚠ {status.latest} is newer than the {status.builtAgainst} Orbit was tested with.
                  This version hasn’t been verified with Orbit and may behave unexpectedly — you can
                  still upgrade, or skip for now.
                </div>
              )}
              {external > 0 && (
                <div className="update-warn">
                  {external} Claude Code process{external > 1 ? 'es are' : ' is'} running outside
                  Orbit. Upgrading will close {external > 1 ? 'them' : 'it'} first.
                </div>
              )}
              <div className="update-actions">
                <button onClick={onDismiss}>Not now</button>
                <button className="primary" onClick={upgrade}>
                  Close everything &amp; upgrade
                </button>
              </div>
            </>
          )}

          {phase === 'working' && (
            <>
              <p className="update-note">
                Upgrading to {status.latest ?? 'the latest version'}… this can take a minute.
              </p>
              <div
                className={`update-progress ${progress?.pct == null ? 'indeterminate' : ''}`}
                role="progressbar"
                aria-valuenow={progress?.pct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="update-progress-bar"
                  style={progress?.pct != null ? { width: `${progress.pct}%` } : undefined}
                />
              </div>
              <div className="update-progress-line">
                {progress?.pct != null && <span className="update-progress-pct">{progress.pct}%</span>}
                <span className="update-progress-text">{progress?.line ?? 'Working…'}</span>
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <p className="update-note">Upgrade complete. Relaunch Orbit to use the new version.</p>
              <div className="update-actions">
                <button onClick={onDismiss}>Later</button>
                <button className="primary" onClick={() => window.orbit.relaunchApp()}>
                  Relaunch Orbit
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="update-warn">Upgrade failed.</div>
              <pre className="update-output">{output || 'No output.'}</pre>
              <div className="update-actions">
                <button onClick={onDismiss}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
