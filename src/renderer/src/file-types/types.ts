/** The rendering modes a viewer can offer. */
export type ViewMode = 'edit' | 'preview' | 'table' | 'tree' | 'raw'

/** A text selection inside a viewer, reported for the "Add to chat" action. */
export interface SelectionRef {
  /** raw selected text, exactly as it appears in the document */
  text: string
  /** 1-based line number where the selection starts */
  startLine: number
  /** 1-based line number where the selection ends */
  endLine: number
}

/** Props passed to every FileViewer component. */
export interface FileViewerProps {
  path: string
  /** Text content (the live editable buffer). Empty string for binary-only viewers. */
  buffer: string
  /** True when readTextFile flagged this as binary (or skipped for known binary types). */
  binary: boolean
  dirty: boolean
  onBufferChange: (v: string) => void
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
  busy: boolean
  leasedBy: string | null
  /** Called when the viewer wants to trigger a save (e.g. Ctrl+S in CodeEditor). */
  onSave?: () => void
  /**
   * When set, the viewer offers an "Add to chat" affordance on a text selection
   * and reports the raw selected text + its 1-based line range. The shell turns
   * this into a file-path/row/value reference for the agent. Undefined = off.
   */
  onAddSelectionToChat?: (sel: SelectionRef) => void
}

/** Describes one file-type handler — viewer + editor capabilities. */
export interface FileTypeEntry {
  /** Unique stable id — used for debugging and future persistence of user prefs. */
  id: string
  /**
   * Priority score for a given (path, binary) pair.
   * Higher score wins. 0 = this handler cannot handle the file.
   * Scores are arbitrary; built-in types use 80–100.
   */
  score(path: string, binary: boolean): number
  /**
   * Available view modes in display order.
   * The first entry is the default unless defaultMode() overrides it.
   */
  modes: ViewMode[]
  /**
   * Per-mode label overrides for this file type, taking precedence over the
   * global MODE_LABELS. Lets one type relabel a shared mode — e.g. markdown
   * calls its editable 'preview' "Formatted" without affecting other viewers.
   */
  modeLabels?: Partial<Record<ViewMode, string>>
  /** Override the default mode for a specific path (e.g. preview for .md). */
  defaultMode?(path: string): ViewMode
  /** The React component that renders (and optionally edits) the file. */
  Viewer: React.ComponentType<FileViewerProps>
  /**
   * True when the viewer produces editable content that can be saved back to disk.
   * When false, Save/Discard buttons are hidden in the EditorModal shell.
   */
  editable: boolean
  /**
   * True when the viewer handles the file entirely from the path (e.g. images via
   * file:// URL) and does NOT need readTextFile to be called. EditorModal skips
   * the text read and passes binary=true + buffer='' to the viewer.
   */
  handlesBinary?: boolean
}
