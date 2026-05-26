import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Project } from '../shared/events'
import { readProjectConfig } from './project-config'

/**
 * Parse JSONC (e.g. a `.code-workspace`): strips // and /* *\/ comments + trailing commas,
 * but is string-aware so `//` inside a string value (URLs, `"//"` keys) is preserved.
 */
function parseJsonc(text: string): any {
  try {
    return JSON.parse(text) // fast path: already valid JSON
  } catch {
    /* fall through to the tolerant strip */
  }
  let out = ''
  let inStr = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const c2 = text[i + 1]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += c2 ?? ''
        i += 2
        continue
      }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      i++
      continue
    }
    if (c === '/' && c2 === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function workspaceFolders(dir: string): { name: string; path: string }[] {
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.code-workspace'))
  } catch {
    return []
  }
  for (const f of files) {
    try {
      const ws = parseJsonc(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (Array.isArray(ws.folders)) {
        return ws.folders
          .filter((x: any) => x && typeof x.path === 'string')
          .map((x: any) => ({ name: x.name ?? path.basename(x.path), path: path.resolve(dir, x.path) }))
      }
    } catch {
      /* ignore malformed workspace file */
    }
  }
  return []
}

/** Workspace members for a project: explicit `.orbit.json` subprojects, else a `.code-workspace`. */
export function subprojectsFor(dir: string): Project[] {
  const cfg = readProjectConfig(dir)
  let decls = cfg.subprojects.map((s) => ({ name: s.name, path: path.resolve(dir, s.path) }))
  if (!decls.length) decls = workspaceFolders(dir)
  const seen = new Set<string>()
  return decls
    .filter((d) => {
      const abs = path.resolve(d.path)
      if (abs === path.resolve(dir) || seen.has(abs)) return false
      seen.add(abs)
      try {
        return fs.statSync(abs).isDirectory()
      } catch {
        return false
      }
    })
    .map((d) => ({ name: d.name, path: path.resolve(d.path) }))
}

/** Default folder to scan for projects. Falls back to the home dir. */
export function defaultProjectRoot(): string {
  const candidates = [
    path.join(os.homedir(), 'Documents', 'GitHub'),
    path.join(os.homedir(), 'GitHub'),
    path.join(os.homedir(), 'Projects'),
    os.homedir()
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c
    } catch {
      /* ignore */
    }
  }
  return os.homedir()
}

/** List immediate subdirectories of `root` as openable projects. */
export function listProjects(root: string): Project[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => {
      const full = path.join(root, e.name)
      const subprojects = subprojectsFor(full)
      return subprojects.length ? { name: e.name, path: full, subprojects } : { name: e.name, path: full }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
