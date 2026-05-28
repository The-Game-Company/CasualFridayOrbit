import type { ShellKind, TermKind } from '../../shared/events'

export const KIND_META: Record<TermKind, { icon: string; label: string }> = {
  claude: { icon: '◆', label: 'Claude' },
  powershell: { icon: '≫', label: 'PowerShell' },
  cmd: { icon: '▸_', label: 'cmd' },
  zsh: { icon: '≫', label: 'zsh' },
  bash: { icon: '≫', label: 'bash' }
}

/** Shells offered for the host platform (Windows: powershell/cmd; macOS/Linux: zsh/bash). */
export function shellKindsFor(platform: string): ShellKind[] {
  return platform === 'win32' ? ['powershell', 'cmd'] : ['zsh', 'bash']
}

/** Kinds shown in the "new tab" menu: Claude plus the platform's shells. */
export function newTabKinds(platform: string): TermKind[] {
  return ['claude', ...shellKindsFor(platform)]
}

/** Default shell used when a quick-command doesn't declare one. */
export function defaultShellKind(platform: string): ShellKind {
  return platform === 'win32' ? 'powershell' : 'zsh'
}
