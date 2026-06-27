import { app, BrowserWindow, ipcMain, dialog, Notification, Menu, clipboard, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { startHookServer, type HookServer } from './hook-server'
import { SessionManager } from './session-manager'
import { readContextFile } from './context-watch'
import { listProjects } from './projects'
import { ProjectsWatcher } from './projects-watch'
import { listSkills } from './skills'
import { listMcpServers, restartMcpServer } from './mcp'
import { loadConfig, saveConfig } from './config'
import { listHistory, duplicateTranscript } from './history'
import { loadWorkspace, saveWorkspace, loadWindowState, saveWindowState } from './workspace'
import { checkUpdate, runUpdate, closeExternalClaude } from './updater'
import { readDir, readTextFile, saveTextFile, searchFiles, FileWatcher } from './files'
import { CoordinationWatcher } from './coordination'
import { LogWatcher, listKeyDocs } from './logs'
import { readProjectConfig } from './project-config'
import { fixGuiPath } from './shell-path'
import { runDelegate, cancelDelegate, delegateStatuses } from './delegate'
import { setKey as setProviderKey, clearKey as clearProviderKey } from './provider-keys'

import { IPC, type AppConfig, type CreateSessionArgs, type DelegateSendArgs, type HookEvent, type McpServer, type WorkspaceState } from '../shared/events'


// Single-instance guard: only one Orbit may run. If a second copy is launched, it exits
// immediately and the existing instance gets a 'second-instance' event to bring its
// window to the front instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

let win: BrowserWindow | null = null
let hookServer: HookServer | null = null
let sessions: SessionManager | null = null
let fileWatcher: FileWatcher | null = null
let coordWatcher: CoordinationWatcher | null = null
let logWatcher: LogWatcher | null = null
let projectsWatcher: ProjectsWatcher | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ——— Desktop notifications ———————————————————————————————————————————————
// Each notification names the project, shows what kind of attention is needed (leading
// glyph), carries the prompt being worked on, and — when clicked — brings Orbit to the
// front and jumps straight to the session that raised it.

/** What the toast is about; drives the leading glyph + title wording. */
type NotifyKind = 'done' | 'input' | 'permission' | 'info'

const NOTIFY_GLYPH: Record<NotifyKind, string> = {
  done: '✅',
  input: '💬',
  permission: '🔐',
  info: '🔔'
}

// The renderer reports which window (session) the user is currently looking at, so we can
// skip toasts for the session that's right in front of them.
let activeSessionId: string | null = null

// Anti-spam: the same kind of toast for the same session won't repeat within this window
// (claude re-sends idle/permission Notification hooks while it waits — one nag is enough).
const NOTIFY_COOLDOWN_MS = 60_000
const lastNotified = new Map<string, number>()

function notify(opts: { kind: NotifyKind; project: string; headline: string; body: string; sessionId?: string }): void {
  try {
    const cfg = loadConfig()
    if (!cfg.notifyEnabled || !Notification.isSupported()) return
    if (opts.kind === 'done' && cfg.notifyOnDone === false) return
    if ((opts.kind === 'input' || opts.kind === 'permission' || opts.kind === 'info') && cfg.notifyOnWait === false) return
    // The user is looking at Orbit right now — the UI already shows every session's
    // status, so any toast is noise regardless of which session raised it.
    if (win?.isFocused()) return
    // Dedup: same kind for the same session within the cooldown → drop.
    const dedupKey = `${opts.sessionId ?? opts.project}:${opts.kind}`
    const prev = lastNotified.get(dedupKey)
    if (prev !== undefined && Date.now() - prev < NOTIFY_COOLDOWN_MS) return
    lastNotified.set(dedupKey, Date.now())
    const n = new Notification({
      title: `${NOTIFY_GLYPH[opts.kind]} ${opts.project} — ${opts.headline}`,
      body: opts.body,
      silent: !cfg.notifySound,
      icon: path.join(app.getAppPath(), 'resources', 'orbit.png'),
      // needs-input toasts should linger until acted on (Windows honors this; no-op elsewhere)
      timeoutType: opts.kind === 'done' ? 'default' : 'never'
    })
    n.on('click', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (opts.sessionId) send(IPC.NotifyActivate, { sessionId: opts.sessionId })
    })
    n.show()
  } catch {
    /* ignore */
  }
}

/** "3s" / "2m 14s" / "1h 05m" — how long the turn ran, shown on done-toasts. */
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Classify claude's Notification hook message so the toast says what's actually needed. */
function classifyMessage(msg: string): { kind: NotifyKind; headline: string } {
  if (/permission|approve|allow/i.test(msg)) return { kind: 'permission', headline: 'permission needed' }
  if (/waiting for (your )?input|idle|waiting/i.test(msg)) return { kind: 'input', headline: 'waiting for you' }
  return { kind: 'info', headline: 'notification' }
}

const projectName = (cwd: unknown): string =>
  (typeof cwd === 'string' && cwd.split(/[\\/]/).filter(Boolean).pop()) || 'Orbit'

// Per-window reasoning effort: claude doesn't expose it to hook subprocesses when launched
// without it in the parent env (as Orbit does), so we resolve it the way claude itself does —
// from the settings files, most-specific first: project-local → project-shared → user-global.
//
// Effort is keyed per-session (not per-cwd) so that changing effort in one project window
// doesn't corrupt other windows that fall through to the same global settings file.
const effortCache = new Map<string, { effort: string | null; at: number }>()
// Last effort we settled on for a session. '' is a real entry meaning "resolved once, found
// nothing" — distinct from `undefined` ("never resolved"), so a later global edit can't
// silently relabel a session we already decided was unknown.
const sessionEffort = new Map<string, string>()

// Canonical effort ladder. We normalize whatever claude/settings hand us to one of these so
// the badge's CSS class and color are always valid; common spellings collapse to a canon.
const EFFORT_ALIASES: Record<string, string> = {
  l: 'low', lo: 'low', low: 'low',
  m: 'medium', med: 'medium', medium: 'medium',
  h: 'high', high: 'high',
  xhigh: 'xhigh', 'x-high': 'xhigh', 'extra-high': 'xhigh', extrahigh: 'xhigh', 'xtra-high': 'xhigh',
  max: 'max', maximum: 'max', maximal: 'max',
}
/** Trim/lowercase and map to the canonical ladder; unknown non-empty values pass through
 *  lowercased (future levels still render, just without a dedicated color). Empty → null. */
function normEffort(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (!s) return null
  return EFFORT_ALIASES[s] ?? s
}

function readEffortLevel(file: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return normEffort(j?.effortLevel)
  } catch {
    return null
  }
}

/**
 * Resolve a session's reasoning effort from the settings files, claude's own precedence:
 * project-local → project-shared → user-global. The settings are re-read every event (so a
 * mid-session `/effort` is picked up), but a change to the *global* default only relabels the
 * session the user is actively driving — otherwise `/effort` in one window would wrongly
 * relabel every other window that falls through to the same global file. Project-local
 * overrides are cwd-specific and unambiguous, so they're always trusted live.
 */
function resolveEffort(sessionId: string, cwd: unknown, isActive: boolean): string | null {
  if (typeof cwd !== 'string' || !cwd) return sessionEffort.get(sessionId) || null

  for (const f of [
    path.join(cwd, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
  ]) {
    const e = readEffortLevel(f)
    if (e) {
      sessionEffort.set(sessionId, e)
      return e
    }
  }

  // Global default — shared across windows, so read it (briefly cached) but gate adoption.
  const cached = effortCache.get(cwd)
  const globalEffort =
    cached && Date.now() - cached.at < 1500
      ? cached.effort
      : (() => {
          const e = readEffortLevel(path.join(app.getPath('home'), '.claude', 'settings.json'))
          effortCache.set(cwd, { effort: e, at: Date.now() })
          return e
        })()

  const known = sessionEffort.get(sessionId)
  // A background session keeps whatever it last showed — don't let another window's /effort
  // (which rewrote the shared global file) bleed into it.
  if (known !== undefined && !isActive) return known || null
  if (globalEffort) {
    sessionEffort.set(sessionId, globalEffort)
    return globalEffort
  }
  if (known !== undefined) return known || null
  sessionEffort.set(sessionId, '') // resolved once, nothing found — pin "unknown"
  return null
}

const clip = (s: unknown, n = 80): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// Remember each session's most recent prompt + project + when it was submitted, so
// Stop/Notification toasts can name them and report how long the turn took.
const lastPrompt = new Map<string, { project: string; prompt: string; ts: number }>()

function onHookEvent(evt: HookEvent): void {
  const d = evt.data ?? {}
  // Stamp the live effort. CLAUDE_EFFORT from the hook env is authoritative when present —
  // it's per-session and tracks mid-session /effort changes — so prefer it; otherwise (Orbit
  // usually launches claude without it in the env) fall back to the settings files.
  const envEffort = normEffort(evt.effort)
  if (envEffort) {
    sessionEffort.set(evt.sessionId, envEffort)
    evt.effort = envEffort
  } else {
    const effort = resolveEffort(evt.sessionId, d.cwd, evt.sessionId === activeSessionId)
    evt.effort = effort ?? undefined
  }
  send(IPC.HookEvent, evt)
  const project = projectName(d.cwd)

  if (evt.event === 'UserPromptSubmit' && d.prompt) {
    lastPrompt.set(evt.sessionId, { project, prompt: clip(d.prompt), ts: evt.ts })
    // A new turn resets the anti-spam cooldowns — its completion/waits deserve fresh toasts.
    for (const k of lastNotified.keys()) if (k.startsWith(`${evt.sessionId}:`)) lastNotified.delete(k)
  }

  // Desktop notifications: glyph for the kind of attention needed, project + prompt for
  // context, turn duration on completion, and click-to-jump to the session.
  if (evt.event === 'Stop') {
    const ctx = lastPrompt.get(evt.sessionId)
    // Quick turns aren't worth a toast — the user almost certainly just asked and is
    // still looking; only longer turns mean they may have wandered off.
    if (ctx?.ts && evt.ts - ctx.ts < 15_000) return
    const took = ctx?.ts ? ` in ${fmtDuration(evt.ts - ctx.ts)}` : ''
    notify({
      kind: 'done',
      project: ctx?.project ?? project,
      headline: `done${took}`,
      body: ctx?.prompt ? `”${ctx.prompt}”` : 'Turn complete',
      sessionId: evt.sessionId
    })
  }
  if (evt.event === 'Notification' && d.message) {
    const ctx = lastPrompt.get(evt.sessionId)
    const { kind, headline } = classifyMessage(String(d.message))
    notify({
      kind,
      project: ctx?.project ?? project,
      headline,
      body: ctx?.prompt ? `${clip(d.message, 90)}\n”${ctx.prompt}”` : clip(d.message, 140),
      sessionId: evt.sessionId
    })
  }
}

// Rebuild Orbit from source, then relaunch the app on the freshly built `out/`.
// (Dev convenience — the same flow launch.cmd does, but without leaving the app.)
let rebuilding = false

function rebuildAndRestart(): void {
  if (rebuilding) return
  rebuilding = true
  const cwd = app.getAppPath()
  win?.setTitle('Orbit — rebuilding…')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const proc = spawn(npm, ['run', 'build'], { cwd, shell: true })
  let log = ''
  // electron-vite runs three sequential sub-builds: main → preload → renderer.
  // Each prints "building for production" at the start and "built in X.Xs" at the end.
  // We count occurrences to assign milestone percentages without relying on stage names.
  let buildStarts = 0
  let buildEnds = 0
  const START_PCTS = [5, 35, 55]   // pct when nth sub-build begins
  const END_PCTS   = [30, 50, 90]  // pct when nth sub-build finishes
  let lastPct = 2

  send(IPC.AppRebuildProgress, { line: 'Starting build…', pct: 2 })

  const onChunk = (d: Buffer): void => {
    const text = d.toString()
    log += text
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim()
      if (!line) continue
      let pct: number | null = null
      if (/building for production/i.test(line)) {
        const idx = buildStarts++
        pct = START_PCTS[idx] ?? null
      } else if (/\bbuilt in\b/i.test(line)) {
        const idx = buildEnds++
        pct = END_PCTS[idx] ?? null
      }
      if (pct != null && pct > lastPct) lastPct = pct
      send(IPC.AppRebuildProgress, { line, pct: lastPct })
    }
  }
  proc.stdout.on('data', onChunk)
  proc.stderr.on('data', onChunk)

  proc.on('close', (code) => {
    rebuilding = false
    if (code === 0) {
      send(IPC.AppRebuildProgress, { line: 'Build complete. Relaunching…', pct: 100 })
      setTimeout(() => { app.relaunch(); app.quit() }, 400)
    } else {
      win?.setTitle('Orbit')
      send(IPC.AppRebuildProgress, {
        line: 'Build failed.',
        pct: -1,
        errorOutput: log.slice(-4000) || `build exited with code ${code}`
      })
    }
  })
  proc.on('error', (err) => {
    rebuilding = false
    win?.setTitle('Orbit')
    send(IPC.AppRebuildProgress, { line: 'Build failed.', pct: -1, errorOutput: String(err) })
  })
}

function buildAppMenu(): void {
  // Rebuild & Restart only makes sense in dev (source present); a packaged build has
  // nothing to rebuild, so we omit the item there and leave just Quit under File.
  const appItems: Electron.MenuItemConstructorOptions[] = [
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send(IPC.MenuCommand, 'settings') },
    { label: 'History…', accelerator: 'CmdOrCtrl+H', click: () => send(IPC.MenuCommand, 'history') }
  ]
  const fileItems: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? [...appItems, { type: 'separator' }, { role: 'quit' }]
    : [
        ...appItems,
        { type: 'separator' },
        {
          label: 'Rebuild & Restart',
          accelerator: 'CmdOrCtrl+Shift+R',
          // Route through the renderer so it can warn if chats are still running;
          // it calls back via IPC.AppRebuild once the user confirms.
          click: () => send(IPC.MenuCommand, 'rebuild')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
  // NOTE: we deliberately do NOT include the standard Edit/View/Window role menus. Their
  // accelerators (Ctrl+C/V/X, Ctrl+R reload, Ctrl+Shift+R, Ctrl+W) would be captured at the
  // native level and never reach the terminal — breaking copy/paste and interrupt in the
  // xterm pane. Copy/paste is wired directly in the renderer (see Terminal.tsx); text inputs
  // and the editor still get Chromium's built-in editing shortcuts without a menu entry.
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: fileItems },
    {
      label: 'View',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => send(IPC.MenuCommand, 'shortcuts')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  // Restore the window to its last size/position (and maximized state) so Orbit reopens
  // exactly where the user left it, across quits and rebuilds.
  const saved = loadWindowState()
  win = new BrowserWindow({
    width: saved?.width ?? 1480,
    height: saved?.height ?? 940,
    x: saved?.x,
    y: saved?.y,
    backgroundColor: '#16181d',
    title: 'Orbit',
    // Single-bar chrome: the native title bar and menu bar are hidden; the renderer's tab
    // bar doubles as the titlebar (drag region + ☰ menu button), and the OS min/max/close
    // buttons are overlaid on its right edge. Colors are re-tinted per theme via IPC.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1b1e26', symbolColor: '#8b93a7', height: 38 },
    icon: path.join(app.getAppPath(), 'resources', 'orbit.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  if (saved?.maximized) win.maximize()

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Lock down navigation: the renderer should only ever live at our own URL. A link in
  // rendered markdown (or anything injected) must not be able to navigate the app window
  // or spawn a new one — http(s) links go to the user's real browser, everything else is denied.
  const isAppUrl = (url: string): boolean =>
    process.env.ELECTRON_RENDERER_URL
      ? url.startsWith(process.env.ELECTRON_RENDERER_URL)
      : url.startsWith('file://')
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // getNormalBounds() is the un-maximized geometry, so maximizing/restoring doesn't lose the
  // size to return to. Debounce the drag/resize bursts; also flush on close.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (!win) return
    const b = win.getNormalBounds()
    saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
  }
  const queueSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 400)
  }
  win.on('resize', queueSave)
  win.on('move', queueSave)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('close', persistBounds)

  win.on('closed', () => {
    win = null
  })
}

function registerIpc(): void {
  // The native menu bar is hidden (single-bar chrome) — the tab bar's ☰ button pops the
  // same application menu up at its own position instead. Accelerators work either way.
  ipcMain.on(IPC.WindowStartMove, () => { win?.startWindowMove?.() })

  ipcMain.on(IPC.MenuPopup, (_e, p: { x: number; y: number }) => {
    if (win) Menu.getApplicationMenu()?.popup({ window: win, x: Math.round(p.x), y: Math.round(p.y) })
  })

  // Re-tint the overlaid native window buttons when the renderer switches themes.
  ipcMain.on(IPC.TitleBarTheme, (_e, p: { color: string; symbolColor: string }) => {
    try {
      win?.setTitleBarOverlay({ color: p.color, symbolColor: p.symbolColor, height: 38 })
    } catch {
      // overlay re-tinting isn't supported on this platform (macOS) — keep launch colors
    }
  })

  ipcMain.handle(IPC.ProjectList, () => {
    const root = loadConfig().projectRoot
    return { root, projects: listProjects(root) }
  })

  ipcMain.handle(IPC.SkillsList, (_e, projectPath: string | null) => listSkills(projectPath))

  ipcMain.handle(IPC.McpList, (_e, projectPath: string | null) => listMcpServers(projectPath))

  ipcMain.handle(IPC.McpRestart, (_e, server: McpServer) => restartMcpServer(server))

  ipcMain.handle(IPC.ConfigGet, () => loadConfig())
  ipcMain.handle(IPC.ConfigSet, (_e, cfg: AppConfig) => {
    const saved = saveConfig(cfg)
    // Re-arm the project-config watchers in case the root moved.
    projectsWatcher?.watch(loadConfig().projectRoot, () => send(IPC.ProjectsChanged, null))
    return saved
  })

  // ——— Delegate (route a turn to a non-Claude model) ———————————————————————
  // Keys live encrypted in provider-keys.ts; only availability booleans cross to the renderer.
  ipcMain.handle(IPC.DelegateProviders, () => delegateStatuses())
  ipcMain.handle(IPC.DelegateSetKey, (_e, a: { provider: string; key: string }) =>
    setProviderKey(a.provider, a.key)
  )
  ipcMain.handle(IPC.DelegateClearKey, (_e, a: { provider: string }) => clearProviderKey(a.provider))
  // Fire-and-forget: the answer streams back over DelegateToken/Done/Error.
  ipcMain.on(IPC.DelegateSend, (_e, args: DelegateSendArgs) => {
    void runDelegate(args, {
      onToken: (chunk) => send(IPC.DelegateToken, { turnId: args.turnId, sessionId: args.sessionId, chunk }),
      onDone: (text) => send(IPC.DelegateDone, { turnId: args.turnId, sessionId: args.sessionId, text }),
      onError: (message) => send(IPC.DelegateError, { turnId: args.turnId, sessionId: args.sessionId, message })
    })
  })
  ipcMain.on(IPC.DelegateCancel, (_e, turnId: string) => cancelDelegate(turnId))

  ipcMain.handle(IPC.OpenInExplorer, (_e, folderPath: string) => {
    shell.showItemInFolder(folderPath)
  })

  ipcMain.handle(IPC.OpenExternal, (_e, url: string) => {
    // only open real web/docs links — never arbitrary file/scheme URLs from the renderer
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.PickFolder, async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.ContextRead, (_e, filePath: string) => readContextFile(filePath))

  ipcMain.handle(IPC.HistoryList, (_e, projectPath: string) => listHistory(projectPath))

  ipcMain.handle(IPC.GitStatus, (_e, projectPath: string): Promise<string[]> => {
    return new Promise((resolve) => {
      const proc = spawn('git', ['status', '--porcelain', '-uall'], { cwd: projectPath })
      let out = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.on('close', () => {
        const paths: string[] = []
        for (const line of out.split('\n')) {
          if (line.length < 4) continue
          const rel = line.slice(3).trim()
          if (rel) paths.push(path.join(projectPath, rel))
        }
        resolve(paths)
      })
      proc.on('error', () => resolve([]))
    })
  })

  ipcMain.handle(IPC.ReadDir, (_e, dir: string) => readDir(dir))
  ipcMain.handle(IPC.SearchFiles, (_e, root: string, query: string, isRegex: boolean) =>
    searchFiles(root, query, isRegex))
  ipcMain.handle(IPC.ReadTextFile, (_e, file: string) => readTextFile(file))
  ipcMain.handle(IPC.SaveTextFile, (_e, a: { path: string; content: string; baselineHash: string; force: boolean }) =>
    saveTextFile(a.path, a.content, a.baselineHash, a.force)
  )
  // Read the OS clipboard for a paste. If it holds an image we persist it to a temp file
  // and return its path (claude reads image references by path); otherwise we return its
  // text. The terminal can't carry image bytes, so the path is what we type into the CLI.
  // Huge text gets the same treatment when the caller allows it (claude sessions): pasting
  // megabytes through the pty wedges the CLI, while a file path is read instantly.
  const MAX_INLINE_PASTE = 100_000 // chars; beyond this a claude paste becomes a temp file
  ipcMain.handle(
    IPC.ClipboardRead,
    (_e, allowTextFile?: boolean): { text: string; imagePath: string | null; textPath?: string | null } => {
    const savePaste = (bytes: Buffer | string, ext = 'png'): string => {
      const dir = path.join(app.getPath('temp'), 'orbit-pastes')
      fs.mkdirSync(dir, { recursive: true })
      const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
      const file = path.join(dir, `paste-${Date.now()}.${clean}`)
      fs.writeFileSync(file, bytes)
      return file
    }

    // 1) An image FILE copied from Explorer — reuse its own path as-is.
    try {
      if (process.platform === 'win32' && clipboard.availableFormats().includes('FileNameW')) {
        const p = clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0+$/, '').trim()
        if (p && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p) && fs.existsSync(p)) {
          return { text: '', imagePath: p }
        }
      }
    } catch {
      /* fall through */
    }

    // 2) A raw bitmap on the clipboard (Win+Shift+S, PrintScreen, browser "copy image").
    const img = clipboard.readImage()
    if (!img.isEmpty()) return { text: '', imagePath: savePaste(img.toPNG()) }

    // 3) Plain text — huge pastes become a temp file whose path is typed in instead.
    const text = clipboard.readText() ?? ''
    if (allowTextFile && text.length > MAX_INLINE_PASTE) {
      try {
        return { text: '', imagePath: null, textPath: savePaste(text, 'txt') }
      } catch {
        /* disk hiccup — fall back to inline paste */
      }
    }
    return { text, imagePath: null }
  })

  ipcMain.handle(IPC.ClipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text ?? '')
    return true
  })

  ipcMain.on(IPC.WatchFile, (_e, file: string) => fileWatcher?.watch(file))
  ipcMain.on(IPC.UnwatchFile, (_e, file: string) => fileWatcher?.unwatch(file))

  ipcMain.on(IPC.CoordWatch, (_e, projectPath: string) => coordWatcher?.watch(projectPath))
  ipcMain.handle(IPC.KeyDocs, (_e, projectPath: string) => listKeyDocs(projectPath))
  ipcMain.handle(IPC.ProjectInfo, (_e, projectPath: string) => {
    const c = readProjectConfig(projectPath)
    return { commands: c.commands, prompts: c.prompts, accent: c.accent }
  })
  ipcMain.on(IPC.LogWatch, (_e, projectPath: string) => logWatcher?.watch(projectPath))
  ipcMain.on(IPC.LogUnwatch, () => logWatcher?.unwatch())
  ipcMain.handle(IPC.WorkspaceLoad, () => loadWorkspace())
  ipcMain.handle(IPC.WorkspaceSave, (_e, state: WorkspaceState) => {
    saveWorkspace(state)
    return true
  })

  ipcMain.handle(IPC.UpdateCheck, () => checkUpdate())
  ipcMain.handle(IPC.UpdateRun, () =>
    runUpdate((p) => win?.webContents.send(IPC.UpdateProgress, p))
  )
  ipcMain.handle(IPC.UpdateCloseExternal, () => closeExternalClaude())
  ipcMain.handle(IPC.AppRelaunch, () => {
    app.relaunch()
    app.quit()
    return true
  })
  ipcMain.handle(IPC.AppRebuild, () => {
    rebuildAndRestart()
    return true
  })

  ipcMain.handle(IPC.SessionCreate, (_e, args: CreateSessionArgs) => {
    sessions?.create(args)
    return true
  })
  // Fork a claude conversation's transcript to a new id (see duplicateTranscript). Returns the
  // new session id the renderer then opens with --resume, or null if there was nothing to fork.
  ipcMain.handle(
    IPC.SessionDuplicate,
    (_e, arg: { projectPath: string; sourceSessionId: string }): string | null =>
      duplicateTranscript(arg.projectPath, arg.sourceSessionId)
  )
  ipcMain.handle(IPC.SessionClose, (_e, sessionId: string) => {
    sessions?.close(sessionId)
    return true
  })

  // Renderer keeps us posted on which session is in front, so notify() can suppress
  // toasts for the session the user is already watching.
  ipcMain.on(IPC.NotifyActiveSession, (_e, sessionId: string | null) => {
    activeSessionId = sessionId
  })

  ipcMain.on(IPC.SessionInput, (_e, arg: { sessionId: string; data: string }) =>
    sessions?.write(arg.sessionId, arg.data)
  )
  ipcMain.on(IPC.SessionResize, (_e, arg: { sessionId: string; cols: number; rows: number }) =>
    sessions?.resize(arg.sessionId, arg.cols, arg.rows)
  )
}

app.whenReady().then(async () => {
  // On macOS, recover the login-shell PATH so a Finder-launched Orbit can find claude/node/git
  // (no-op on Windows/Linux). Must run before we resolve/spawn anything.
  fixGuiPath()
  // Identify as Orbit (not generic "Electron") so Windows shows our icon/name and the
  // taskbar groups + pins us as one app. Must match the AUMID set on the pinned shortcut
  // (scripts/install-orbit-shortcut.ps1) and the electron-builder appId. Also enables our
  // desktop notifications to render on Windows.
  app.setAppUserModelId('com.shozd.orbit')
  hookServer = await startHookServer(onHookEvent)
  fileWatcher = new FileWatcher((c) => send(IPC.FileExternalChange, c))
  coordWatcher = new CoordinationWatcher(
    (c) => send(IPC.CoordUpdate, c),
    () => Math.max(1, loadConfig().leaseStaleMin) * 60
  )
  logWatcher = new LogWatcher(
    (s) => send(IPC.LogUpdate, s),
    () => loadConfig().logDirs
  )
  projectsWatcher = new ProjectsWatcher()
  projectsWatcher.watch(loadConfig().projectRoot, () => send(IPC.ProjectsChanged, null))
  sessions = new SessionManager(
    {
      onData: (sessionId, data) => send(IPC.SessionData, { sessionId, data }),
      onExit: (sessionId, code) => send(IPC.SessionExit, { sessionId, code }),
      onContextTree: (sessionId, tree) => send(IPC.ContextTree, { sessionId, tree })
    },
    { port: hookServer.port, token: hookServer.token }
  )
  registerIpc()
  buildAppMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function shutdown(): void {
  sessions?.disposeAll()
  fileWatcher?.unwatchAll()
  coordWatcher?.unwatch()
  logWatcher?.unwatch()
  projectsWatcher?.dispose()
  hookServer?.close()
}

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)
