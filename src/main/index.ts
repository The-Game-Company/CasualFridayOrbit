import { app, BrowserWindow, ipcMain, dialog, Notification, Menu, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { startHookServer, type HookServer } from './hook-server'
import { SessionManager } from './session-manager'
import { readContextFile } from './context-watch'
import { listProjects } from './projects'
import { listSkills } from './skills'
import { loadConfig, saveConfig } from './config'
import { listHistory } from './history'
import { loadWorkspace, saveWorkspace } from './workspace'
import { readDir, readTextFile, saveTextFile, FileWatcher } from './files'
import { CoordinationWatcher } from './coordination'
import { LogWatcher, listKeyDocs } from './logs'
import { readProjectConfig } from './project-config'
import { IPC, type AppConfig, type CreateSessionArgs, type HookEvent, type WorkspaceState } from '../shared/events'

let win: BrowserWindow | null = null
let hookServer: HookServer | null = null
let sessions: SessionManager | null = null
let fileWatcher: FileWatcher | null = null
let coordWatcher: CoordinationWatcher | null = null
let logWatcher: LogWatcher | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
  } catch {
    /* ignore */
  }
}

function onHookEvent(evt: HookEvent): void {
  send(IPC.HookEvent, evt)
  // Light-touch desktop notifications.
  if (evt.event === 'Stop') notify('Orbit', 'Turn complete')
  if (evt.event === 'Notification' && evt.data?.message) notify('Orbit', String(evt.data.message))
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
  proc.stdout.on('data', (d) => (log += d))
  proc.stderr.on('data', (d) => (log += d))
  proc.on('close', (code) => {
    rebuilding = false
    if (code === 0) {
      app.relaunch()
      app.quit()
    } else {
      win?.setTitle('Orbit')
      dialog.showErrorBox('Orbit rebuild failed', log.slice(-4000) || `build exited with code ${code}`)
    }
  })
  proc.on('error', (err) => {
    rebuilding = false
    win?.setTitle('Orbit')
    dialog.showErrorBox('Orbit rebuild failed', String(err))
  })
}

function buildAppMenu(): void {
  // Rebuild & Restart only makes sense in dev (source present); a packaged build has
  // nothing to rebuild, so we omit the item there and leave just Quit under File.
  const fileItems: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? [{ role: 'quit' }]
    : [
        {
          label: 'Rebuild & Restart',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => rebuildAndRestart()
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: fileItems
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    backgroundColor: '#16181d',
    title: 'Orbit',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC.ProjectList, () => {
    const root = loadConfig().projectRoot
    return { root, projects: listProjects(root) }
  })

  ipcMain.handle(IPC.SkillsList, (_e, projectPath: string | null) => listSkills(projectPath))

  ipcMain.handle(IPC.ConfigGet, () => loadConfig())
  ipcMain.handle(IPC.ConfigSet, (_e, cfg: AppConfig) => saveConfig(cfg))

  ipcMain.handle(IPC.PickFolder, async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.ContextRead, (_e, filePath: string) => readContextFile(filePath))

  ipcMain.handle(IPC.HistoryList, (_e, projectPath: string) => listHistory(projectPath))

  ipcMain.handle(IPC.ReadDir, (_e, dir: string) => readDir(dir))
  ipcMain.handle(IPC.ReadTextFile, (_e, file: string) => readTextFile(file))
  ipcMain.handle(IPC.SaveTextFile, (_e, a: { path: string; content: string; baselineHash: string; force: boolean }) =>
    saveTextFile(a.path, a.content, a.baselineHash, a.force)
  )
  // Clipboard image -> file. The terminal can't carry image bytes, so we persist the
  // pasted image to a file and hand the CLI its path (claude reads image references by
  // path). Returns the saved path, or null if the clipboard holds no image.
  ipcMain.handle(
    IPC.SaveClipboardImage,
    (_e, arg?: { data?: ArrayBuffer; ext?: string }): string | null => {
      const dir = path.join(app.getPath('temp'), 'orbit-pastes')
      const save = (bytes: Buffer, ext: string): string => {
        fs.mkdirSync(dir, { recursive: true })
        const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
        const file = path.join(dir, `paste-${Date.now()}.${clean}`)
        fs.writeFileSync(file, bytes)
        return file
      }

      // 1) Bytes handed over by the renderer (browser "copy image", copied files that
      //    expose an image blob on the DOM paste event).
      if (arg?.data) return save(Buffer.from(arg.data), arg.ext || 'png')

      // 2) A real image FILE copied from the file manager (Windows Explorer). Reuse its
      //    own path as-is rather than re-saving a copy.
      try {
        if (process.platform === 'win32' && clipboard.availableFormats().includes('FileNameW')) {
          const p = clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0+$/, '').trim()
          if (p && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p) && fs.existsSync(p)) return p
        }
      } catch {
        /* fall through to the bitmap path */
      }

      // 3) A raw bitmap on the OS clipboard (Win+Shift+S, PrintScreen, "copy image").
      //    This is the case the DOM paste event misses on Windows.
      const img = clipboard.readImage()
      if (!img.isEmpty()) return save(img.toPNG(), 'png')

      return null
    }
  )

  ipcMain.on(IPC.WatchFile, (_e, file: string) => fileWatcher?.watch(file))
  ipcMain.on(IPC.UnwatchFile, () => fileWatcher?.unwatch())

  ipcMain.on(IPC.CoordWatch, (_e, projectPath: string) => coordWatcher?.watch(projectPath))
  ipcMain.handle(IPC.KeyDocs, (_e, projectPath: string) => listKeyDocs(projectPath))
  ipcMain.handle(IPC.ProjectInfo, (_e, projectPath: string) => {
    const c = readProjectConfig(projectPath)
    return { commands: c.commands, accent: c.accent }
  })
  ipcMain.on(IPC.LogWatch, (_e, projectPath: string) => logWatcher?.watch(projectPath))
  ipcMain.on(IPC.LogUnwatch, () => logWatcher?.unwatch())
  ipcMain.handle(IPC.WorkspaceLoad, () => loadWorkspace())
  ipcMain.handle(IPC.WorkspaceSave, (_e, state: WorkspaceState) => {
    saveWorkspace(state)
    return true
  })

  ipcMain.handle(IPC.SessionCreate, (_e, args: CreateSessionArgs) => {
    sessions?.create(args)
    return true
  })
  ipcMain.handle(IPC.SessionClose, (_e, sessionId: string) => {
    sessions?.close(sessionId)
    return true
  })

  ipcMain.on(IPC.SessionInput, (_e, arg: { sessionId: string; data: string }) =>
    sessions?.write(arg.sessionId, arg.data)
  )
  ipcMain.on(IPC.SessionResize, (_e, arg: { sessionId: string; cols: number; rows: number }) =>
    sessions?.resize(arg.sessionId, arg.cols, arg.rows)
  )
}

app.whenReady().then(async () => {
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
  fileWatcher?.unwatch()
  coordWatcher?.unwatch()
  logWatcher?.unwatch()
  hookServer?.close()
}

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)
