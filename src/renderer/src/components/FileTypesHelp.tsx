interface Props {
  onClose: () => void
}

interface Group {
  icon: string
  title: string
  description: string
  features: string[]
  exts: string[]
}

const GROUPS: Group[] = [
  {
    icon: '{ }',
    title: 'Structured Data',
    description: 'Smart viewers that parse structure — no raw scrolling through brackets.',
    features: [
      'JSON / JSONC — collapsible tree, depth auto-collapse, JSON lint errors in edit mode',
      'JSONL / NDJSON — one row per line, smart preview (role/content, type, level…), paginated',
      'CSV / TSV — sortable table with row numbers, edit raw or view as grid',
    ],
    exts: ['.json', '.jsonc', '.jsonl', '.ndjson', '.csv', '.tsv'],
  },
  {
    icon: '< >',
    title: 'Code',
    description: 'CodeMirror editor with full language support across the stack.',
    features: [
      'Syntax highlighting for 15+ languages',
      'JSON lint — inline red underlines on parse errors',
      'Bracket matching, auto-close, auto-indent',
      'Fold gutters — collapse functions, objects, blocks',
      'Autocomplete (keywords, local identifiers)',
      'Find / Replace panel — Ctrl+F',
      'Save with Ctrl+S',
    ],
    exts: [
      '.ts', '.tsx', '.js', '.jsx', '.mjs',
      '.py', '.rs', '.go', '.cs', '.java', '.kt',
      '.c', '.cpp', '.h', '.hpp',
      '.css', '.scss', '.html', '.sql',
      '.yaml', '.yml', '.xml', '.sh', '.bash', '.ps1',
    ],
  },
  {
    icon: '✎',
    title: 'Documents',
    description: 'Formatted preview with source editing.',
    features: [
      'Markdown / MDX — rendered HTML preview with syntax-highlighted code blocks',
      'SVG — rendered image preview, switch to Edit to modify the XML source',
      'All document types toggle between Preview and Edit in the toolbar',
    ],
    exts: ['.md', '.mdx', '.markdown', '.svg'],
  },
  {
    icon: '⚙',
    title: 'Config & Ops',
    description: 'Contextual viewers that understand the file\'s purpose.',
    features: [
      '.env files — key = value layout, secrets auto-masked, one-click reveal',
      'Diff / patch — color-coded unified diff (green additions, red deletions, @@ hunks)',
      'Log files — level-aware line colors (ERROR red, WARN amber, INFO default, DEBUG muted)',
    ],
    exts: ['.env', '.env.*', '.diff', '.patch', '.log'],
  },
  {
    icon: '🖼',
    title: 'Images',
    description: 'Inline preview — no "binary file" wall of noise.',
    features: [
      'Renders directly in the editor pane via the local file path',
      'SVG also available here (see Documents above for source editing)',
    ],
    exts: ['.png', '.jpg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'],
  },
  {
    icon: '·',
    title: 'Plain Text (fallback)',
    description: 'Any text file not matched above opens in the code editor — no syntax coloring, but full editing, search, and Ctrl+S.',
    features: [],
    exts: ['(everything else)'],
  },
]

export function FileTypesHelp({ onClose }: Props): JSX.Element {
  return (
    <div className="fth-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fth-panel">
        <div className="fth-head">
          <span className="fth-title">Supported file types</span>
          <button className="fth-close" onClick={onClose}>✕</button>
        </div>
        <div className="fth-body">
          {GROUPS.map((g) => (
            <div key={g.title} className="fth-group">
              <div className="fth-group-head">
                <span className="fth-group-icon">{g.icon}</span>
                <span className="fth-group-title">{g.title}</span>
              </div>
              <p className="fth-desc">{g.description}</p>
              {g.features.length > 0 && (
                <ul className="fth-features">
                  {g.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
              <div className="fth-exts">
                {g.exts.map((e) => <code key={e} className="fth-ext">{e}</code>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
