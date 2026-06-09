import type { ITheme } from '@xterm/xterm'
import type { ThemeName } from '../../shared/events'

/**
 * SINGLE SOURCE OF TRUTH FOR ALL THEMING.
 *
 * Every theme must define every UI token below and a full terminal palette.
 * The `UiTokens` type makes this a compile-time contract: if you add a new
 * token here, TypeScript will refuse to build until *every* theme provides a
 * value for it — so themes can never silently fall out of sync.
 *
 * ── Adding a new color to the app ────────────────────────────────────────────
 *  1. Add a key to `UiTokens` (e.g. `'badge-bg'`).
 *  2. The compiler will now flag every theme as incomplete — fill in a value
 *     for that token in each theme's `ui` block.
 *  3. In CSS, reference it as `var(--badge-bg)`. Never hardcode a hex value in
 *     styles.css or a component — always go through a token so it themes.
 *
 * ── Adding a new theme ───────────────────────────────────────────────────────
 *  1. Add its name to `ThemeName` in src/shared/events.ts.
 *  2. Add an entry to `THEMES` below. TypeScript guarantees you fill in every
 *     UI token and terminal color; there is nothing else to wire up — the
 *     dropdown, CSS variables, and terminal colors all read from here.
 */

/** Semantic UI colors. Each becomes a CSS custom property: `bg` -> `--bg`. */
export interface UiTokens {
  /** main / center surface (deepest layer) */
  bg: string
  /** raised surface: panels, titlebar, tabs */
  'bg-2': string
  /** hover / inset surface */
  'bg-3': string
  /** borders and dividers */
  line: string
  /** primary body text */
  fg: string
  /** strongest text (active/selected rows) */
  'fg-strong': string
  /** secondary text */
  'fg-dim': string
  /** tertiary / muted text */
  'fg-mute': string
  /** primary accent (focus, links, busy state) */
  accent: string
  /** skill / agent accent (purple-ish) */
  skill: string
  /** success / additions */
  green: string
  /** warning / waiting state */
  amber: string
  /** secondary warning / auto-focus */
  orange: string
  /** error / destructive / deletions */
  red: string
  /** scrollbar thumb */
  'scroll-thumb': string
}

export interface Theme {
  /** human-readable name shown in Settings */
  label: string
  /** light vs dark — used to group the picker and pick sensible defaults */
  appearance: 'dark' | 'light'
  /** UI surface + accent colors (drive the CSS custom properties) */
  ui: UiTokens
  /** xterm.js terminal palette */
  terminal: ITheme
}

export const THEMES: Record<ThemeName, Theme> = {
  'tokyo-night': {
    label: 'Tokyo Night',
    appearance: 'dark',
    ui: {
      bg: '#16181d',
      'bg-2': '#1b1e26',
      'bg-3': '#21252f',
      line: '#2a2f3a',
      fg: '#d7dae0',
      'fg-strong': '#ffffff',
      'fg-dim': '#8b93a7',
      'fg-mute': '#5b6273',
      accent: '#7aa2f7',
      skill: '#bb9af7',
      green: '#9ece6a',
      amber: '#e0af68',
      orange: '#ff9e64',
      red: '#f7768e',
      'scroll-thumb': '#313845'
    },
    terminal: {
      background: '#16181d',
      foreground: '#d7dae0',
      cursor: '#7aa2f7',
      selectionBackground: '#2d3343',
      black: '#16181d',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
    }
  },
  black: {
    label: 'Black',
    appearance: 'dark',
    ui: {
      bg: '#000000',
      'bg-2': '#0a0a0a',
      'bg-3': '#141414',
      line: '#222222',
      fg: '#cfcfcf',
      'fg-strong': '#ffffff',
      'fg-dim': '#8a8a8a',
      'fg-mute': '#555555',
      accent: '#5fafff',
      skill: '#af87ff',
      green: '#5faf5f',
      amber: '#d7af5f',
      orange: '#d78700',
      red: '#d75f5f',
      'scroll-thumb': '#2a2a2a'
    },
    terminal: {
      background: '#000000',
      foreground: '#cfcfcf',
      cursor: '#cfcfcf',
      selectionBackground: '#303030',
      black: '#000000',
      red: '#d75f5f',
      green: '#5faf5f',
      yellow: '#d7af5f',
      blue: '#5fafff',
      magenta: '#af87ff',
      cyan: '#5fd7d7',
      white: '#cfcfcf',
      brightBlack: '#555555',
      brightRed: '#ff8787',
      brightGreen: '#87d787',
      brightYellow: '#ffd787',
      brightBlue: '#87afff',
      brightMagenta: '#d7afff',
      brightCyan: '#87ffff',
      brightWhite: '#ffffff'
    }
  },
  'github-dark': {
    label: 'GitHub Dark',
    appearance: 'dark',
    ui: {
      bg: '#0d1117',
      'bg-2': '#11151c',
      'bg-3': '#1b212a',
      line: '#232a33',
      fg: '#c9d1d9',
      'fg-strong': '#f0f6fc',
      'fg-dim': '#8b949e',
      'fg-mute': '#6e7681',
      accent: '#58a6ff',
      skill: '#d2a8ff',
      green: '#3fb950',
      amber: '#d29922',
      orange: '#f0883e',
      red: '#ff7b72',
      'scroll-thumb': '#30363d'
    },
    terminal: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc'
    }
  },
  gruvbox: {
    label: 'Gruvbox',
    appearance: 'dark',
    ui: {
      bg: '#1d2021',
      'bg-2': '#262827',
      'bg-3': '#32302f',
      line: '#3c3836',
      fg: '#ebdbb2',
      'fg-strong': '#fbf1c7',
      'fg-dim': '#a89984',
      'fg-mute': '#7c6f64',
      accent: '#83a598',
      skill: '#d3869b',
      green: '#b8bb26',
      amber: '#fabd2f',
      orange: '#fe8019',
      red: '#fb4934',
      'scroll-thumb': '#504945'
    },
    terminal: {
      background: '#1d2021',
      foreground: '#ebdbb2',
      cursor: '#fe8019',
      selectionBackground: '#504945',
      black: '#1d2021',
      red: '#fb4934',
      green: '#b8bb26',
      yellow: '#fabd2f',
      blue: '#83a598',
      magenta: '#d3869b',
      cyan: '#8ec07c',
      white: '#d5c4a1',
      brightBlack: '#665c54',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#fbf1c7'
    }
  },
  nord: {
    label: 'Nord',
    appearance: 'dark',
    ui: {
      bg: '#2e3440',
      'bg-2': '#2b313c',
      'bg-3': '#3b4252',
      line: '#434c5e',
      fg: '#d8dee9',
      'fg-strong': '#eceff4',
      'fg-dim': '#9aa4b8',
      'fg-mute': '#6c7689',
      accent: '#88c0d0',
      skill: '#b48ead',
      green: '#a3be8c',
      amber: '#ebcb8b',
      orange: '#d08770',
      red: '#bf616a',
      'scroll-thumb': '#434c5e'
    },
    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#88c0d0',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },
  'dracula-slate': {
    label: 'Dracula Slate',
    appearance: 'dark',
    ui: {
      bg: '#1e2230',
      'bg-2': '#181e2e',
      'bg-3': '#262e42',
      line: '#334266',
      fg: '#cdd6f4',
      'fg-strong': '#e8eeff',
      'fg-dim': '#9aabb8',
      'fg-mute': '#5a6e8a',
      accent: '#8be9fd',
      skill: '#bd93f9',
      green: '#50fa7b',
      amber: '#f1fa8c',
      orange: '#ffb86c',
      red: '#ff5555',
      'scroll-thumb': '#334266'
    },
    terminal: {
      background: '#1e2230',
      foreground: '#cdd6f4',
      cursor: '#8be9fd',
      selectionBackground: '#334266',
      black: '#181e2e',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#8be9fd',
      magenta: '#bd93f9',
      cyan: '#8be9fd',
      white: '#cdd6f4',
      brightBlack: '#5a6e8a',
      brightRed: '#ff7777',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#a4ffff',
      brightMagenta: '#d6acff',
      brightCyan: '#a4ffff',
      brightWhite: '#e8eeff'
    }
  },
  'dracula-rose': {
    label: 'Dracula Rose',
    appearance: 'dark',
    ui: {
      bg: '#2c1f2e',
      'bg-2': '#251928',
      'bg-3': '#362338',
      line: '#4e3354',
      fg: '#f8d7e6',
      'fg-strong': '#ffffff',
      'fg-dim': '#d4b0c8',
      'fg-mute': '#8a5f80',
      accent: '#ff79c6',
      skill: '#bd93f9',
      green: '#50fa7b',
      amber: '#f1fa8c',
      orange: '#ffb86c',
      red: '#ff5555',
      'scroll-thumb': '#4e3354'
    },
    terminal: {
      background: '#2c1f2e',
      foreground: '#f8d7e6',
      cursor: '#ff79c6',
      selectionBackground: '#4e3354',
      black: '#251928',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8d7e6',
      brightBlack: '#8a5f80',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  'dracula-void': {
    label: 'Dracula Void',
    appearance: 'dark',
    ui: {
      bg: '#0f0f1a',
      'bg-2': '#141420',
      'bg-3': '#1c1c2c',
      line: '#2a2a3c',
      fg: '#e0dff8',
      'fg-strong': '#ffffff',
      'fg-dim': '#9994c0',
      'fg-mute': '#54546e',
      accent: '#50fa7b',
      skill: '#bd93f9',
      green: '#69ff94',
      amber: '#f1fa8c',
      orange: '#ffb86c',
      red: '#ff5555',
      'scroll-thumb': '#2a2a3c'
    },
    terminal: {
      background: '#0f0f1a',
      foreground: '#e0dff8',
      cursor: '#50fa7b',
      selectionBackground: '#2a2a3c',
      black: '#141420',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#e0dff8',
      brightBlack: '#54546e',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  dracula: {
    label: 'Dracula',
    appearance: 'dark',
    ui: {
      bg: '#282a36',
      'bg-2': '#21222c',
      'bg-3': '#343746',
      line: '#44475a',
      fg: '#f8f8f2',
      'fg-strong': '#ffffff',
      'fg-dim': '#b9bdce',
      'fg-mute': '#6272a4',
      accent: '#bd93f9',
      skill: '#ff79c6',
      green: '#50fa7b',
      amber: '#f1fa8c',
      orange: '#ffb86c',
      red: '#ff5555',
      'scroll-thumb': '#44475a'
    },
    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  light: {
    label: 'Light',
    appearance: 'light',
    ui: {
      bg: '#eceef1',
      'bg-2': '#dfe2e7',
      'bg-3': '#d2d6dd',
      line: '#bcc2cc',
      fg: '#24292f',
      'fg-strong': '#000000',
      'fg-dim': '#57606a',
      'fg-mute': '#7e8794',
      accent: '#0969da',
      skill: '#8250df',
      green: '#1a7f37',
      amber: '#9a6700',
      orange: '#bc4c00',
      red: '#cf222e',
      'scroll-thumb': '#b0b7c1'
    },
    terminal: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#0969da',
      selectionBackground: '#b6d6fd',
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#2da44e',
      brightYellow: '#bf8700',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    }
  },
  'solarized-light': {
    label: 'Solarized Light',
    appearance: 'light',
    ui: {
      bg: '#fdf6e3',
      'bg-2': '#f4edda',
      'bg-3': '#eee8d5',
      line: '#e0dabd',
      fg: '#586e75',
      'fg-strong': '#073642',
      'fg-dim': '#657b83',
      'fg-mute': '#93a1a1',
      accent: '#268bd2',
      skill: '#6c71c4',
      green: '#859900',
      amber: '#b58900',
      orange: '#cb4b16',
      red: '#dc322f',
      'scroll-thumb': '#d6cfb5'
    },
    terminal: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  }
}

/** Ordered list for the Settings picker (label + appearance, no color noise). */
export const THEME_LIST: { name: ThemeName; label: string; appearance: Theme['appearance'] }[] =
  (Object.keys(THEMES) as ThemeName[]).map((name) => ({
    name,
    label: THEMES[name].label,
    appearance: THEMES[name].appearance
  }))

/**
 * Apply a theme's UI tokens as CSS custom properties on the document root.
 * Because every token is written here, switching themes can never leave a
 * stale value behind from a previous theme.
 */
/**
 * Pick black or white text for legibility on top of a solid background color.
 * Uses WCAG relative luminance and chooses whichever gives the higher contrast,
 * so it adapts to bright (e.g. neon green) and dark accents alike.
 */
export function readableOn(color: string): string {
  let hex = color.trim().replace(/^#/, '')
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length !== 6) return '#ffffff'
  const chan = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4)
  const contrastBlack = (L + 0.05) / 0.05
  const contrastWhite = 1.05 / (L + 0.05)
  return contrastBlack >= contrastWhite ? '#000000' : '#ffffff'
}

export function applyTheme(name: ThemeName): void {
  const theme = THEMES[name] ?? THEMES['tokyo-night']
  const root = document.documentElement
  for (const [token, value] of Object.entries(theme.ui)) {
    root.style.setProperty(`--${token}`, value)
  }
  // legible text color for elements painted on the accent (buttons, chips)
  root.style.setProperty('--accent-fg', readableOn(theme.ui.accent))
  // expose appearance for any CSS / native widgets that care (e.g. form controls)
  root.dataset.theme = name
  root.style.colorScheme = theme.appearance
  // the native min/max/close buttons overlay the tab bar — tint them to match it
  window.orbit.setTitleBarTheme(theme.ui['bg-2'], theme.ui['fg-dim'])
}
