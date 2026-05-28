import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { McpServer } from '../shared/events'

/** The shape of a single server entry inside any MCP config block. */
interface RawServer {
  type?: string
  command?: string
  args?: unknown
  url?: string
  env?: Record<string, unknown>
}

/** Infer the transport from the (optional) explicit `type` or the fields present. */
function transportOf(raw: RawServer): McpServer['transport'] {
  const t = (raw.type ?? '').toLowerCase()
  if (t === 'sse' || t === 'http') return t
  if (t === 'stdio') return 'stdio'
  if (raw.url) return 'http'
  return 'stdio'
}

/** Normalize one raw `mcpServers` entry into our shared shape. */
function toServer(
  name: string,
  raw: RawServer,
  scope: McpServer['scope'],
  configPath: string,
  enabled: boolean
): McpServer {
  return {
    name,
    scope,
    transport: transportOf(raw),
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    envKeys: raw.env && typeof raw.env === 'object' ? Object.keys(raw.env) : undefined,
    configPath,
    enabled
  }
}

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Normalize a project path for comparison: unify slashes, drop a trailing one, and
 *  (on Windows, where paths are case-insensitive) lowercase. ~/.claude.json stores some
 *  project keys with forward slashes and others with backslashes for the same folder, so a
 *  literal key lookup would miss entries that don't match the OS-native separator. */
function normPath(p: string): string {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/** All `projects[...]` entries in ~/.claude.json that refer to `projectPath`, regardless of
 *  how the key's separators/case were stored. */
function projectEntriesFor(projects: Record<string, any> | undefined, projectPath: string): any[] {
  if (!projects) return []
  const target = normPath(projectPath)
  return Object.entries(projects)
    .filter(([key]) => normPath(key) === target)
    .map(([, value]) => value)
}

/**
 * Discover the MCP servers available to a project, deduped by name with the most specific
 * scope winning (project `.mcp.json` > local per-project > global user). The returned list
 * is what Orbit shows alongside skills.
 */
export function listMcpServers(projectPath: string | null): McpServer[] {
  const homeConfigPath = path.join(os.homedir(), '.claude.json')
  const home = readJson(homeConfigPath) ?? {}
  const out: McpServer[] = []

  // 1) user scope — top-level mcpServers in ~/.claude.json (available everywhere)
  const userServers = home.mcpServers ?? {}
  for (const [name, raw] of Object.entries(userServers)) {
    out.push(toServer(name, raw as RawServer, 'user', homeConfigPath, true))
  }

  if (projectPath) {
    const projEntries = projectEntriesFor(home.projects, projectPath)

    // 2) local scope — projects[path].mcpServers in ~/.claude.json (private to this project)
    for (const projEntry of projEntries) {
      const localServers = projEntry.mcpServers ?? {}
      for (const [name, raw] of Object.entries(localServers)) {
        out.push(toServer(name, raw as RawServer, 'local', homeConfigPath, true))
      }
    }

    // 3) project scope — a .mcp.json checked into the repo (shared with the team).
    // Claude lets the user disable individual shared servers; honor that for the status dot.
    const disabled = new Set<string>()
    for (const projEntry of projEntries) {
      if (Array.isArray(projEntry.disabledMcpjsonServers)) {
        for (const name of projEntry.disabledMcpjsonServers) disabled.add(name)
      }
    }
    const mcpJsonPath = path.join(projectPath, '.mcp.json')
    const mcpJson = readJson(mcpJsonPath)
    const projServers = mcpJson?.mcpServers ?? {}
    for (const [name, raw] of Object.entries(projServers)) {
      out.push(toServer(name, raw as RawServer, 'project', mcpJsonPath, !disabled.has(name)))
    }
  }

  // Dedupe by name: the last (most specific) scope wins so a project override hides the global.
  const byName = new Map<string, McpServer>()
  for (const s of out) byName.set(s.name, s)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
