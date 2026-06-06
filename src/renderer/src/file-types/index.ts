/**
 * File type registry — registers all built-in handlers in priority order.
 *
 * To add a new file type:
 *   1. Create a viewer component in src/renderer/src/components/viewers/
 *   2. Call registerFileType() below with an appropriate score() function
 *
 * Score conventions (higher = more specific):
 *   100  exact binary type (images, archives)
 *   90   specific text format (json, csv, diff, env, md)
 *   80   broad language category (all code files)
 *   1    catch-all plain text fallback
 */

import { registerFileType, resolveFileType } from './registry'
import { ImageViewer } from '../components/viewers/ImageViewer'
import { JsonTreeViewer } from '../components/viewers/JsonTreeViewer'
import { JsonlViewer } from '../components/viewers/JsonlViewer'
import { CsvViewer } from '../components/viewers/CsvViewer'
import { DiffFileViewer } from '../components/viewers/DiffFileViewer'
import { LogViewer } from '../components/viewers/LogViewer'
import { MarkdownViewer } from '../components/viewers/MarkdownViewer'
import { EnvViewer } from '../components/viewers/EnvViewer'
import { CodeEditor } from '../components/viewers/CodeEditor'

function ext(p: string): string {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i + 1).toLowerCase() : ''
}

function fileName(p: string): string {
  return p.split(/[\\/]/).pop()?.toLowerCase() ?? ''
}

// ── Raster images — binary, no text content ──────────────────────────────────
const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'avif'])
registerFileType({
  id: 'image-raster',
  score: (p) => (RASTER_EXTS.has(ext(p)) ? 100 : 0),
  modes: ['preview'],
  Viewer: ImageViewer,
  editable: false,
  handlesBinary: true,
})

// ── SVG — text-based image; edit source or view rendered ──────────────────────
registerFileType({
  id: 'image-svg',
  score: (p) => (ext(p) === 'svg' ? 95 : 0),
  modes: ['preview', 'edit'],
  defaultMode: () => 'preview',
  Viewer: ImageViewer,
  editable: true,
})

// ── JSON tree viewer ──────────────────────────────────────────────────────────
registerFileType({
  id: 'json',
  score: (p, binary) => (!binary && ['json', 'jsonc'].includes(ext(p)) ? 90 : 0),
  modes: ['tree', 'edit', 'raw'],
  defaultMode: () => 'tree',
  Viewer: JsonTreeViewer,
  editable: true,
})

// ── JSONL / newline-delimited JSON ───────────────────────────────────────────
registerFileType({
  id: 'jsonl',
  score: (p, binary) => (!binary && ['jsonl', 'ndjson'].includes(ext(p)) ? 90 : 0),
  modes: ['tree', 'raw'],
  defaultMode: () => 'tree',
  Viewer: JsonlViewer,
  editable: false,
})

// ── CSV / TSV table viewer ────────────────────────────────────────────────────
registerFileType({
  id: 'csv',
  score: (p, binary) => (!binary && ['csv', 'tsv'].includes(ext(p)) ? 90 : 0),
  modes: ['table', 'edit', 'raw'],
  defaultMode: () => 'table',
  Viewer: CsvViewer,
  editable: true,
})

// ── Unified diff / patch files ────────────────────────────────────────────────
registerFileType({
  id: 'diff',
  score: (p, binary) => (!binary && ['diff', 'patch'].includes(ext(p)) ? 90 : 0),
  modes: ['preview', 'raw'],
  defaultMode: () => 'preview',
  Viewer: DiffFileViewer,
  editable: false,
})

// ── Log files ─────────────────────────────────────────────────────────────────
registerFileType({
  id: 'log',
  score: (p, binary) => (!binary && ext(p) === 'log' ? 85 : 0),
  modes: ['preview', 'raw'],
  defaultMode: () => 'preview',
  Viewer: LogViewer,
  editable: false,
})

// ── Markdown ──────────────────────────────────────────────────────────────────
registerFileType({
  id: 'markdown',
  score: (p, binary) => (!binary && ['md', 'mdx', 'markdown'].includes(ext(p)) ? 90 : 0),
  modes: ['preview', 'edit'],
  defaultMode: () => 'preview',
  Viewer: MarkdownViewer,
  editable: true,
})

// ── .env files ────────────────────────────────────────────────────────────────
registerFileType({
  id: 'env',
  score: (p, binary) => {
    if (binary) return 0
    const n = fileName(p)
    return n === '.env' || n.startsWith('.env.') || ext(p) === 'env' ? 90 : 0
  },
  modes: ['preview', 'edit'],
  defaultMode: () => 'preview',
  Viewer: EnvViewer,
  editable: true,
})

// ── Code files — CodeMirror with syntax highlighting ─────────────────────────
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'cs', 'java', 'kt', 'swift',
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
  'css', 'scss', 'sass', 'less',
  'html', 'htm',
  'xml',
  'yaml', 'yml',
  'sql',
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  'toml', 'ini', 'conf',
  'graphql', 'gql',
  'prisma', 'proto',
  'vue', 'svelte',
])
registerFileType({
  id: 'code',
  score: (p, binary) => (!binary && CODE_EXTS.has(ext(p)) ? 80 : 0),
  modes: ['edit'],
  Viewer: CodeEditor,
  editable: true,
})

// ── Plain text fallback — also CodeMirror, but no language ──────────────────
registerFileType({
  id: 'text',
  score: (_p, binary) => (binary ? 0 : 1),
  modes: ['edit'],
  Viewer: CodeEditor,
  editable: true,
})

export { resolveFileType }
