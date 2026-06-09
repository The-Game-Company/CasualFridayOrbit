import { useState } from 'react'
import type { AppConfig, ThemeName } from '../../../shared/events'
import { THEME_LIST } from '../themes'

const DARK_THEMES = THEME_LIST.filter((t) => t.appearance === 'dark')
const LIGHT_THEMES = THEME_LIST.filter((t) => t.appearance === 'light')

type Tab = 'general' | 'appearance' | 'notifications' | 'editor' | 'advanced'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'editor', label: 'Editor' },
  { id: 'advanced', label: 'Advanced' },
]

interface Props {
  config: AppConfig
  onChange: (cfg: AppConfig) => void
  onClose: () => void
}

export function SettingsModal({ config, onChange, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('general')

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
