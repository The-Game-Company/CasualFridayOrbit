import type { TermKind } from '../../shared/events'

export const KIND_META: Record<TermKind, { icon: string; label: string }> = {
  claude: { icon: '◆', label: 'Claude' },
  powershell: { icon: '≫', label: 'PowerShell' },
  cmd: { icon: '▸_', label: 'cmd' }
}
