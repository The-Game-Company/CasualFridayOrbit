import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../shared/events'
import { defaultProjectRoot } from './projects'

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): AppConfig {
  const defaults: AppConfig = {
    projectRoot: defaultProjectRoot(),
    theme: 'tokyo-night',
    fontSize: 14,
    restoreOnLaunch: true,
    restoreExclude: [],
    hidden: [],
    projectOrder: [],
    logDirs: ['PlayLogs', 'logs', 'Logs'],
    leaseStaleMin: 20,
    leftWidth: 230,
    rightWidth: 340,
    autoFocus: false
  }
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return defaults
  }
}

export function saveConfig(cfg: AppConfig): AppConfig {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  } catch {
    /* best effort */
  }
  return cfg
}
