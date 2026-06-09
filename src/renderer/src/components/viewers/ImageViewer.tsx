import type { FileViewerProps } from '../../file-types/types'
import { startPathDrag } from '../drag'
import { CodeEditor } from './CodeEditor'

function pathToFileUrl(p: string): string {
  // Windows: C:\foo\bar.png → file:///C:/foo/bar.png
  // POSIX:   /foo/bar.png   → file:///foo/bar.png
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '')
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function ImageViewer(props: FileViewerProps): JSX.Element {
  const { path, mode } = props

  // SVG in edit mode → show the XML source via CodeEditor
  if (mode === 'edit') {
    return <CodeEditor {...props} />
  }

  // Preview: render via file:// URL (works for raster and SVG alike)
  const url = pathToFileUrl(path)
  const name = baseName(path)

  // The container is the drag source (drops the file's path into a session); the <img> itself is
  // non-draggable so its native image drag — a file:// uri-list that would navigate the window —
  // never takes over.
  return (
    <div className="viewer-image" draggable onDragStart={(e) => startPathDrag(e, path)}>
      <img src={url} alt={name} draggable={false} />
    </div>
  )
}
