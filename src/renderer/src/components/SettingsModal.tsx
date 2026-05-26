import type { AppConfig, ThemeName } from '../../../shared/events'

const THEME_LABELS: Record<ThemeName, string> = {
  'tokyo-night': 'Tokyo Night',
  'github-dark': 'GitHub Dark',
  gruvbox: 'Gruvbox'
}

interface Props {
  config: AppConfig
  onChange: (cfg: AppConfig) => void
  onClose: () => void
}

export function SettingsModal({ config, onChange, onClose }: Props): JSX.Element {
  const browse = async (): Promise<void> => {
    const folder = await window.orbit.pickFolder()
    if (folder) onChange({ ...config, projectRoot: folder })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
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

          <label className="field">
            <span>Theme</span>
            <select
              value={config.theme}
              onChange={(e) => onChange({ ...config, theme: e.target.value as ThemeName })}
            >
              {(Object.keys(THEME_LABELS) as ThemeName[]).map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Font size</span>
            <input
              type="number"
              min={9}
              max={24}
              value={config.fontSize}
              onChange={(e) => onChange({ ...config, fontSize: Number(e.target.value) || config.fontSize })}
            />
          </label>

          <label className="field-check">
            <input
              type="checkbox"
              checked={config.restoreOnLaunch}
              onChange={(e) => onChange({ ...config, restoreOnLaunch: e.target.checked })}
            />
            <span>Resume previous sessions on launch</span>
          </label>
          <div className="field-hint">
            Right-click a project to make just that one start empty.
          </div>

          <label className="field">
            <span>Log folders (LOGS tab, comma-separated)</span>
            <input
              value={config.logDirs.join(', ')}
              onChange={(e) =>
                onChange({
                  ...config,
                  logDirs: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>

          <label className="field">
            <span>Lease shown as stale after (minutes)</span>
            <input
              type="number"
              min={1}
              max={240}
              value={config.leaseStaleMin}
              onChange={(e) => onChange({ ...config, leaseStaleMin: Number(e.target.value) || config.leaseStaleMin })}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
