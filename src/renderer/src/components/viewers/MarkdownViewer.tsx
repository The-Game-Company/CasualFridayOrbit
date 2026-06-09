import type { FileViewerProps } from '../../file-types/types'
import { CodeEditor } from './CodeEditor'
import { MarkdownLiveEditor } from './MarkdownLiveEditor'

/**
 * Markdown has two editable surfaces over the same buffer:
 *   'edit'    → raw markdown source in CodeMirror   ("Code")
 *   'preview' → byte-exact live-rendered editor      ("Formatted")
 * Both write back the same text, so toggling never reformats the file.
 */
export function MarkdownViewer(props: FileViewerProps): JSX.Element {
  return props.mode === 'edit' ? <CodeEditor {...props} /> : <MarkdownLiveEditor {...props} />
}
