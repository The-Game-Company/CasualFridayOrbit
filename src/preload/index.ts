import { contextBridge, ipcRenderer, webFrame } from 'electron'
import {
  IPC,
  type AppConfig,
  type ContextNode,
  type CoordState,
  type CreateSessionArgs,
  type ExternalChange,
  type FileNode,
  type HistoryEntry,
  type HookEvent,
  type KeyDoc,
  type LogState,
  type McpRestartResult,
  type McpServer,
  type Project,
  type ProjectInfo,
  type ReadFileResult,
  type SaveResult,
  type Skill,
  type UpdateProgress,
  type UpdateResult,
  type UpdateStatus,
  type WorkspaceState
} from '../shared/events'

const api = {
  /** Host platform, so the renderer can offer the right shells (powershell/cmd vs zsh/bash). */
  platform: process.platform,

  // queries
  listProjects: (): Promise<{ root: string; projects: Project[] }> =>
    ipcRenderer.invoke(IPC.ProjectList),
  listSkills: (projectPath: string | null): Promise<Skill[]> =>
    ipcRenderer.invoke(IPC.SkillsList, projectPath),
  listMcp: (projectPath: string | null): Promise<McpServer[]> =>
    ipcRenderer.invoke(IPC.McpList, projectPath),
  restartMcp: (server: McpServer): Promise<McpRestartResult> =>
    ipcRenderer.invoke(IPC.McpRestart, server),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigGet),
  /** global UI zoom for the whole window (panels, text, icons — everything) */
  setUiZoom: (factor: number): void => webFrame.setZoomFactor(factor),
  setConfig: (cfg: AppConfig): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigSet, cfg),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PickFolder),
  readContextFile: (path: string): Promise<string> => ipcRenderer.invoke(IPC.ContextRead, path),
  listHistory: (projectPath: string): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HistoryList, projectPath),
  loadWorkspace: (): Promise<WorkspaceState | null> => ipcRenderer.invoke(IPC.WorkspaceLoad),
  saveWorkspace: (state: WorkspaceState): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WorkspaceSave, state),

  // Claude Code self-update (checked at launch, before any session locks the binary)
  checkUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UpdateCheck),
  runUpdate: (): Promise<UpdateResult> => ipcRenderer.invoke(IPC.UpdateRun),
  onUpdateProgress: (cb: (p: UpdateProgress) => void): (() => void) => {
    const fn = (_e: unknown, p: UpdateProgress): void => cb(p)
    ipcRenderer.on(IPC.UpdateProgress, fn)
    return () => ipcRenderer.removeListener(IPC.UpdateProgress, fn)
  },
  closeExternalClaude: (): Promise<number> => ipcRenderer.invoke(IPC.UpdateCloseExternal),
  relaunchApp: (): Promise<boolean> => ipcRenderer.invoke(IPC.AppRelaunch),
  rebuildApp: (): Promise<boolean> => ipcRenderer.invoke(IPC.AppRebuild),

  // file browser + editor
  gitStatus: (projectPath: string): Promise<string[]> => ipcRenderer.invoke(IPC.GitStatus, projectPath),
  readDir: (dir: string): Promise<FileNode[]> => ipcRenderer.invoke(IPC.ReadDir, dir),
  searchFiles: (root: string, query: string, isRegex: boolean): Promise<FileNode[]> =>
    ipcRenderer.invoke(IPC.SearchFiles, root, query, isRegex),
  readTextFile: (path: string): Promise<ReadFileResult> => ipcRenderer.invoke(IPC.ReadTextFile, path),
  saveTextFile: (
    path: string,
    content: string,
    baselineHash: string,
    force: boolean
  ): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.SaveTextFile, { path, content, baselineHash, force }),
  clipboardRead: (
    allowTextFile?: boolean
  ): Promise<{ text: string; imagePath: string | null; textPath?: string | null }> =>
    ipcRenderer.invoke(IPC.ClipboardRead, allowTextFile),
  clipboardWriteText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.ClipboardWriteText, text),
  watchFile: (path: string): void => ipcRenderer.send(IPC.WatchFile, path),
  unwatchFile: (): void => ipcRenderer.send(IPC.UnwatchFile),
  onFileExternalChange: (cb: (c: ExternalChange) => void): (() => void) => {
    const fn = (_e: unknown, c: ExternalChange): void => cb(c)
    ipcRenderer.on(IPC.FileExternalChange, fn)
    return () => ipcRenderer.removeListener(IPC.FileExternalChange, fn)
  },

  // coordination (leases / WIP / takeovers)
  coordWatch: (projectPath: string): void => ipcRenderer.send(IPC.CoordWatch, projectPath),
  onCoordUpdate: (cb: (c: CoordState) => void): (() => void) => {
    const fn = (_e: unknown, c: CoordState): void => cb(c)
    ipcRenderer.on(IPC.CoordUpdate, fn)
    return () => ipcRenderer.removeListener(IPC.CoordUpdate, fn)
  },
  listKeyDocs: (projectPath: string): Promise<KeyDoc[]> => ipcRenderer.invoke(IPC.KeyDocs, projectPath),
  getProjectInfo: (projectPath: string): Promise<ProjectInfo> =>
    ipcRenderer.invoke(IPC.ProjectInfo, projectPath),

  // log tailer
  logWatch: (projectPath: string): void => ipcRenderer.send(IPC.LogWatch, projectPath),
  logUnwatch: (): void => ipcRenderer.send(IPC.LogUnwatch),
  onLogUpdate: (cb: (s: LogState) => void): (() => void) => {
    const fn = (_e: unknown, s: LogState): void => cb(s)
    ipcRenderer.on(IPC.LogUpdate, fn)
    return () => ipcRenderer.removeListener(IPC.LogUpdate, fn)
  },

  // window chrome (single-bar mode): pop the hidden app menu / re-tint the native buttons
  startWindowMove: (): void => ipcRenderer.send(IPC.WindowStartMove),
  popupAppMenu: (x: number, y: number): void => ipcRenderer.send(IPC.MenuPopup, { x, y }),
  setTitleBarTheme: (color: string, symbolColor: string): void =>
    ipcRenderer.send(IPC.TitleBarTheme, { color, symbolColor }),

  // desktop notifications: report the focused session (for toast suppression) and react
  // to a toast click by jumping to the session that raised it
  setNotifyActiveSession: (sessionId: string | null): void =>
    ipcRenderer.send(IPC.NotifyActiveSession, sessionId),
  onNotifyActivate: (cb: (sessionId: string) => void): (() => void) => {
    const fn = (_e: unknown, p: { sessionId: string }): void => cb(p.sessionId)
    ipcRenderer.on(IPC.NotifyActivate, fn)
    return () => ipcRenderer.removeListener(IPC.NotifyActivate, fn)
  },

  // session control
  createSession: (args: CreateSessionArgs): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SessionCreate, args),
  closeSession: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SessionClose, sessionId),
  sessionInput: (sessionId: string, data: string): void =>
    ipcRenderer.send(IPC.SessionInput, { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.SessionResize, { sessionId, cols, rows }),

  // push subscriptions -> return an unsubscribe fn
  onSessionData: (cb: (sessionId: string, data: string) => void): (() => void) => {
    const fn = (_e: unknown, p: { sessionId: string; data: string }): void => cb(p.sessionId, p.data)
    ipcRenderer.on(IPC.SessionData, fn)
    return () => ipcRenderer.removeListener(IPC.SessionData, fn)
  },
  onSessionExit: (cb: (sessionId: string, code: number) => void): (() => void) => {
    const fn = (_e: unknown, p: { sessionId: string; code: number }): void => cb(p.sessionId, p.code)
    ipcRenderer.on(IPC.SessionExit, fn)
    return () => ipcRenderer.removeListener(IPC.SessionExit, fn)
  },
  onMenuCommand: (cb: (command: string) => void): (() => void) => {
    const fn = (_e: unknown, command: string): void => cb(command)
    ipcRenderer.on(IPC.MenuCommand, fn)
    return () => ipcRenderer.removeListener(IPC.MenuCommand, fn)
  },
  onHookEvent: (cb: (evt: HookEvent) => void): (() => void) => {
    const fn = (_e: unknown, evt: HookEvent): void => cb(evt)
    ipcRenderer.on(IPC.HookEvent, fn)
    return () => ipcRenderer.removeListener(IPC.HookEvent, fn)
  },
  onProjectsChanged: (cb: () => void): (() => void) => {
    const fn = (): void => cb()
    ipcRenderer.on(IPC.ProjectsChanged, fn)
    return () => ipcRenderer.removeListener(IPC.ProjectsChanged, fn)
  },
  onContextTree: (cb: (sessionId: string, tree: ContextNode[]) => void): (() => void) => {
    const fn = (_e: unknown, p: { sessionId: string; tree: ContextNode[] }): void =>
      cb(p.sessionId, p.tree)
    ipcRenderer.on(IPC.ContextTree, fn)
    return () => ipcRenderer.removeListener(IPC.ContextTree, fn)
  }
}

contextBridge.exposeInMainWorld('orbit', api)

export type OrbitApi = typeof api
