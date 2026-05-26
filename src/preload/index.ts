import { contextBridge, ipcRenderer } from 'electron'
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
  type Project,
  type ProjectInfo,
  type ReadFileResult,
  type SaveResult,
  type Skill,
  type WorkspaceState
} from '../shared/events'

const api = {
  // queries
  listProjects: (): Promise<{ root: string; projects: Project[] }> =>
    ipcRenderer.invoke(IPC.ProjectList),
  listSkills: (projectPath: string | null): Promise<Skill[]> =>
    ipcRenderer.invoke(IPC.SkillsList, projectPath),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigGet),
  setConfig: (cfg: AppConfig): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigSet, cfg),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PickFolder),
  readContextFile: (path: string): Promise<string> => ipcRenderer.invoke(IPC.ContextRead, path),
  listHistory: (projectPath: string): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HistoryList, projectPath),
  loadWorkspace: (): Promise<WorkspaceState | null> => ipcRenderer.invoke(IPC.WorkspaceLoad),
  saveWorkspace: (state: WorkspaceState): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WorkspaceSave, state),

  // file browser + editor
  readDir: (dir: string): Promise<FileNode[]> => ipcRenderer.invoke(IPC.ReadDir, dir),
  readTextFile: (path: string): Promise<ReadFileResult> => ipcRenderer.invoke(IPC.ReadTextFile, path),
  saveTextFile: (
    path: string,
    content: string,
    baselineHash: string,
    force: boolean
  ): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.SaveTextFile, { path, content, baselineHash, force }),
  saveClipboardImage: (data?: ArrayBuffer, ext?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SaveClipboardImage, data ? { data, ext } : undefined),
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
  onHookEvent: (cb: (evt: HookEvent) => void): (() => void) => {
    const fn = (_e: unknown, evt: HookEvent): void => cb(evt)
    ipcRenderer.on(IPC.HookEvent, fn)
    return () => ipcRenderer.removeListener(IPC.HookEvent, fn)
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
