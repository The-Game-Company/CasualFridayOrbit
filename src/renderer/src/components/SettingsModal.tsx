import { useEffect, useState } from 'react'
import type { AppConfig, DelegateProvider, DelegateStatuses, ThemeName } from '../../../shared/events'
import { THEME_LIST } from '../themes'

const DARK_THEMES = THEME_LIST.filter((t) => t.appearance === 'dark')
const LIGHT_THEMES = THEME_LIST.filter((t) => t.appearance === 'light')

type Tab = 'general' | 'appearance' | 'notifications' | 'editor' | 'ai' | 'advanced'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'editor', label: 'Editor' },
  { id: 'ai', label: 'AI Models' },
  { id: 'advanced', label: 'Advanced' },
]

/**
 * Delegate providers shown in the AI tab. OpenAI/Gemini are REST APIs (need a key + a model id).
 * Cursor is `cliBased`: it's driven through the logged-in `cursor-agent` CLI, so it needs no key
 * and no model field — it just runs Cursor's Composer model.
 */
const DELEGATE_PROVIDERS: {
  id: DelegateProvider
  label: string
  placeholder: string
  cliBased?: boolean
}[] = [
  { id: 'openai', label: 'ChatGPT (OpenAI)', placeholder: 'sk-…' },
  { id: 'gemini', label: 'Gemini (Google)', placeholder: 'AIza…' },
  { id: 'composer', label: 'Composer (Cursor)', placeholder: '', cliBased: true },
]

/** Platform-appropriate one-liner to install the cursor-agent CLI. */
const CURSOR_INSTALL_CMD =
  window.orbit.platform === 'win32'
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : 'curl https://cursor.com/install -fsS | bash'

interface Props {
  config: AppConfig
  onChange: (cfg: AppConfig) => void
  onClose: () => void
}

export function SettingsModal({ config, onChange, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('general')

  // delegate provider key state (AI tab): per-provider readiness, and per-provider draft inputs
  const [avail, setAvail] = useState<DelegateStatuses | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<DelegateProvider, string>>>({})
  const [keyError, setKeyError] = useState<string | null>(null)

  const refreshAvail = (): void => {
    window.orbit.delegateProviders().then(setAvail)
  }
  useEffect(() => {
    refreshAvail()
  }, [])

  const saveKey = async (provider: DelegateProvider): Promise<void> => {
    const draft = (keyDrafts[provider] ?? '').trim()
    if (!draft) return
    setKeyError(null)
    const res = await window.orbit.delegateSetKey(provider, draft)
    if (!res.ok) {
      setKeyError(res.error ?? 'Failed to save key.')
      return
    }
    setKeyDrafts((d) => ({ ...d, [provider]: '' }))
    refreshAvail()
  }
  const clearKey = async (provider: DelegateProvider): Promise<void> => {
    setKeyError(null)
    await window.orbit.delegateClearKey(provider)
    setKeyDrafts((d) => ({ ...d, [provider]: '' }))
    refreshAvail()
  }
  const setModel = (provider: DelegateProvider, model: string): void =>
    onChange({ ...config, delegateModels: { ...config.delegateModels, [provider]: model } })

  const browse = async (): Promise<void> => {
    const folder = await window.orbit.pickFolder()
    if (folder) onChange({ ...config, projectRoot: folder })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body settings-body">
          {tab === 'general' && (
            <>
              <label className="field">
                <span>Projects folder</span>
                <div className="field-row">
                  <input
                    value={config.projectRoot}
                    onChange={(e) => onChange({ ...config, projectRoot: e.target.value })}
                  />
                  <button onClick={browse}>Browse…</button>
                </div>
              </label>

              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.restoreOnLaunch}
                  onChange={(e) => onChange({ ...config, restoreOnLaunch: e.target.checked })}
                />
                <span>Resume previous sessions on launch</span>
              </label>
              <div className="field-hint">Right-click a project to make just that one start empty.</div>

              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.autoFocus}
                  onChange={(e) => onChange({ ...config, autoFocus: e.target.checked })}
                />
                <span>Auto-focus sessions that finish</span>
              </label>
              <div className="field-hint">
                While the session you're watching is busy, jump to another window the moment it
                finishes and wants your input.
              </div>

              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.smartPaste ?? true}
                  onChange={(e) => onChange({ ...config, smartPaste: e.target.checked })}
                />
                <span>Smart paste images &amp; large text</span>
              </label>
              <div className="field-hint">
                On Ctrl+V, an image on the clipboard — or, in a chat, a very large text blob — is
                saved to a file and its path is typed in, so Claude can read it. Turn off for a
                plain text paste (clipboard images are then ignored).
              </div>
            </>
          )}

          {tab === 'appearance' && (
            <>
              <label className="field">
                <span>Theme</span>
                <select
                  value={config.theme}
                  onChange={(e) => onChange({ ...config, theme: e.target.value as ThemeName })}
                >
                  <optgroup label="Dark">
                    {DARK_THEMES.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Light">
                    {LIGHT_THEMES.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

              <label className="field">
                <span>Font size</span>
                <input
                  type="number"
                  min={9}
                  max={24}
                  value={config.fontSize}
                  onChange={(e) =>
                    onChange({ ...config, fontSize: Number(e.target.value) || config.fontSize })
                  }
                />
              </label>

              <label className="field">
                <span>Global UI size</span>
                <div className="field-slider">
                  <input
                    type="range"
                    min={80}
                    max={200}
                    step={5}
                    value={Math.round((config.uiScale || 1) * 100)}
                    onChange={(e) => onChange({ ...config, uiScale: Number(e.target.value) / 100 })}
                  />
                  <span className="field-slider-val">{Math.round((config.uiScale || 1) * 100)}%</span>
                </div>
              </label>
              <div className="field-hint">
                Zooms the entire app — side panels, titles, text, icons, buttons and terminals.
              </div>

              <label className="field">
                <span>Window UI size</span>
                <div className="field-slider">
                  <input
                    type="range"
                    min={80}
                    max={200}
                    step={5}
                    value={Math.round((config.windowUiScale || 1) * 100)}
                    onChange={(e) =>
                      onChange({ ...config, windowUiScale: Number(e.target.value) / 100 })
                    }
                  />
                  <span className="field-slider-val">
                    {Math.round((config.windowUiScale || 1) * 100)}%
                  </span>
                </div>
              </label>
              <div className="field-hint">
                Scales just the chat-window chrome — title bar at the bottom, pinned prompt, jump
                arrow and quick-prompt buttons.
              </div>
            </>
          )}

          {tab === 'notifications' && (
            <>
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.notifyEnabled}
                  onChange={(e) => onChange({ ...config, notifyEnabled: e.target.checked })}
                />
                <span>Desktop notifications</span>
              </label>
              <div className="field-hint">
                Toast when a session finishes (✅), waits for input (💬) or needs permission (🔐).
                Clicking a toast jumps straight to that session. Nothing fires for the session
                you&apos;re already looking at.
              </div>

              <div className="settings-indent">
                <label className="field-check">
                  <input
                    type="checkbox"
                    disabled={!config.notifyEnabled}
                    checked={config.notifyOnDone ?? true}
                    onChange={(e) => onChange({ ...config, notifyOnDone: e.target.checked })}
                  />
                  <span>Notify when done (✅)</span>
                </label>

                <label className="field-check">
                  <input
                    type="checkbox"
                    disabled={!config.notifyEnabled}
                    checked={config.notifyOnWait ?? true}
                    onChange={(e) => onChange({ ...config, notifyOnWait: e.target.checked })}
                  />
                  <span>Notify when waiting for input or permission (💬 🔐)</span>
                </label>

                <label className="field-check">
                  <input
                    type="checkbox"
                    disabled={!config.notifyEnabled}
                    checked={config.notifySound}
                    onChange={(e) => onChange({ ...config, notifySound: e.target.checked })}
                  />
                  <span>Notification sound</span>
                </label>
              </div>
            </>
          )}

          {tab === 'editor' && (
            <>
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.autoSave ?? false}
                  onChange={(e) => onChange({ ...config, autoSave: e.target.checked })}
                />
                <span>Auto-save files after idle</span>
              </label>
              <div className="field-hint">
                Automatically saves open files after a short pause in typing. Ctrl+S always saves
                immediately.
              </div>

              {(config.autoSave ?? false) && (
                <label className="field">
                  <span>Auto-save delay (ms)</span>
                  <input
                    type="number"
                    min={500}
                    max={10000}
                    step={500}
                    value={config.autoSaveDelay ?? 1000}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        autoSaveDelay: Math.max(500, Number(e.target.value) || 1000),
                      })
                    }
                  />
                </label>
              )}
            </>
          )}

          {tab === 'ai' && (
            <>
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={config.delegateEnabled ?? false}
                  onChange={(e) => onChange({ ...config, delegateEnabled: e.target.checked })}
                />
                <span>Enable delegating a chat turn to a non-Claude model</span>
              </label>
              <div className="field-hint">
                Adds a model dropdown to each chat (default <b>Claude (native)</b>). Pick another
                model to send one prompt to it — the reply streams in and is written into the
                conversation so Claude continues with it in context. Keys are encrypted on this
                machine and never leave it except to call the provider you chose.
              </div>

              <div className="field-row settings-recheck">
                <button onClick={refreshAvail}>Re-check providers</button>
                <span className="field-hint">
                  Run this after installing the Cursor CLI or signing in — Orbit re-detects without a
                  restart.
                </span>
              </div>

              {keyError && <div className="field-hint settings-key-error">{keyError}</div>}

              <div className="settings-indent">
                {DELEGATE_PROVIDERS.map((p) => {
                  const st = avail?.[p.id]
                  const hasKey = !!st?.hasKey
                  const ready = !!st?.ready

                  // Cursor: CLI-based, no key/model — just show install + login status.
                  if (p.cliBased) {
                    return (
                      <div key={p.id} className="settings-provider">
                        <div className="settings-provider-head">
                          <span className="settings-provider-name">{p.label}</span>
                          {ready ? (
                            <span className="settings-provider-tag ok">✓ ready</span>
                          ) : (
                            <span className="settings-provider-tag warn">CLI not found</span>
                          )}
                        </div>
                        {ready ? (
                          <div className="field-hint">
                            Runs Cursor’s Composer model via the <code>cursor-agent</code> CLI using
                            your existing Cursor login — no API key needed. If a turn fails with an
                            auth error, run <code>cursor-agent login</code> once.
                          </div>
                        ) : (
                          <>
                            <div className="field-hint">
                              Needs the Cursor CLI. Install it, then run{' '}
                              <code>cursor-agent login</code> once — no API key required.
                            </div>
                            <div className="field-row">
                              <input readOnly value={CURSOR_INSTALL_CMD} />
                              <button onClick={() => window.orbit.clipboardWriteText(CURSOR_INSTALL_CMD)}>
                                Copy
                              </button>
                              <button onClick={() => window.orbit.openExternal('https://cursor.com/docs/cli/installation')}>
                                Install guide
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  }

                  const modelPlaceholder = p.id === 'openai' ? 'gpt-5' : 'gemini-2.5-pro'
                  return (
                    <div key={p.id} className="settings-provider">
                      <div className="settings-provider-head">
                        <span className="settings-provider-name">{p.label}</span>
                        {ready ? (
                          <span className="settings-provider-tag ok">✓ key set</span>
                        ) : (
                          <span className="settings-provider-tag muted">no key</span>
                        )}
                      </div>

                      <div className="field-row">
                        <input
                          type="password"
                          autoComplete="off"
                          placeholder={hasKey ? '•••••••• (stored)' : p.placeholder}
                          value={keyDrafts[p.id] ?? ''}
                          onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveKey(p.id)
                          }}
                        />
                        <button onClick={() => saveKey(p.id)} disabled={!(keyDrafts[p.id] ?? '').trim()}>
                          Save
                        </button>
                        {hasKey && <button onClick={() => clearKey(p.id)}>Clear</button>}
                      </div>
                      <label className="field">
                        <span>Model</span>
                        <input
                          value={config.delegateModels?.[p.id] ?? ''}
                          placeholder={modelPlaceholder}
                          onChange={(e) => setModel(p.id, e.target.value)}
                        />
                      </label>
                      <div className="field-hint">
                        The {p.label} API requires a model id — change it to use a different model
                        (e.g. {p.id === 'openai' ? 'gpt-5-mini' : 'gemini-2.5-flash'}).
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {tab === 'advanced' && (
            <>
              <label className="field">
                <span>Log folders</span>
                <input
                  value={config.logDirs.join(', ')}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      logDirs: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <div className="field-hint">Comma-separated paths shown in the LOGS tab.</div>

              <label className="field">
                <span>Lease shown as stale after (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={config.leaseStaleMin}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      leaseStaleMin: Number(e.target.value) || config.leaseStaleMin,
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
