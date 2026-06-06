<div align="center">

# ◆ Orbit

**A desktop app for Claude Code — multi-session, multi-project, reactive.**

No API key. No separate auth. If you're subscribed to Claude, Orbit uses it.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-2b6cb0)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![license](https://img.shields.io/badge/license-MIT-3fb950)

</div>

---

## Quick start

> [!NOTE]
> Orbit drives your **logged-in** `claude` CLI. The setup scripts install it if it's missing — then run `claude` once to sign in.

**macOS:** double-click `Install Orbit (macOS).command` → installs everything, adds to Applications + Dock.

**Windows:** double-click `Install Orbit (Windows).cmd` → installs everything, adds Desktop + Start Menu shortcuts.

<details>
<summary>Terminal / manual install</summary>

```bash
# macOS
./scripts/setup-mac.sh --install   # build + install to /Applications
./scripts/setup-mac.sh             # dev mode

# Windows
pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1             # dev mode
pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Installer  # NSIS installer

# Manual
npm install && npm run dev         # dev mode
npm run dist:installer             # build installer
```

> If `npm run dev` fails with `Error: Electron uninstall`, run `node ./node_modules/electron/install.js`.

</details>

> [!IMPORTANT]
> macOS builds are unsigned. First launch: right-click → **Open** (or `xattr -dr com.apple.quarantine Orbit.app`).

---

## Features

<details>
<summary><b>Sessions & projects</b> — many Claude tabs, one window</summary>

- Open as many Claude sessions as you want per project, split side-by-side or stacked.
- Switch projects without killing anything — every session keeps running in the background.
- Add plain terminal tabs (PowerShell, cmd, zsh, bash) alongside Claude.
- Sidebar shows live per-project counts: **working / waiting / idle**.

</details>

<details>
<summary><b>Live status</b> — see what Claude is doing at a glance</summary>

Status dots, agent counters, and file highlights update in real time from Claude Code hooks — no polling.

- Per-tab and per-project **status dots**: idle, busy (pulsing), waiting (amber).
- **Agent counters** showing how many subagents are running right now.
- **Files being read or written** pulse in the context tree.
- **Active skill** highlighted in the Skills panel with a title-bar flash.

</details>

<details>
<summary><b>Alerts</b> — know when Claude needs you</summary>

When a background session finishes or hits a permission prompt, its tab pulses amber and a desktop notification fires. Click the notification to jump straight to that session.

Notification types (done, waiting, permission) and sound are configurable in Settings.

</details>

<details>
<summary><b>Session persistence</b> — pick up exactly where you left off</summary>

Your whole workspace — every project, tab, split layout, and chat — is saved continuously and fully restored on relaunch, even after a crash.

- Tabs restore **paused** and only spawn their process when you focus them (20 saved sessions = 0 processes started until you look).
- Right-click any project to mark it **start empty on launch** (`∅`).
- Global toggle in Settings to disable resume without losing the saved layout.
- `⟲` button lists past conversations; click any to resume in a new tab.

</details>

<details>
<summary><b>File editor</b> — edit while watching Claude work</summary>

A full CodeMirror editor docked beside the terminals (or as a full overlay — toggle with `⤡`). Multi-tab, conflict-aware:

- Live-refreshes while your buffer is clean; freezes the moment you start typing.
- If the file changed on disk while you were editing: **Overwrite / Reload / Cancel**.
- Warns if an agent is actively writing the file right now.

Typed viewers per file: `.md` (rendered Markdown), `.json`, `.csv`, `.log` (auto-tailing), images, diffs.

</details>

<details>
<summary><b>File browser</b> — search and git status at a glance</summary>

Full project file tree with background-threaded search (fast on large repos) and **git status badges** on every file and folder.

</details>

<details>
<summary><b>Panels</b> — Skills, MCP, Subagents, Logs, COORD</summary>

- **Skills** — lists project + user skills; click to insert `/skill` into the active session. Active skill highlights live.
- **MCP** — every configured server with live status; expand for details, right-click to restart.
- **Subagents** — live tree of running `Task` subagents: type, task, status.
- **Logs** — auto-tails the newest `.log` from configurable folders, with live filter + follow toggle.
- **COORD** — for parallel-agent setups: active leases grouped by agent, WIP.md registry, takeover log. Leased files show 🔒 in the file tree; the editor warns before you touch one.

</details>

<details>
<summary><b>Quick prompts & commands</b> — one click, no typing</summary>

- **Quick-prompt buttons** float over the focused Claude window — click to type and submit a preset prompt ("Check the logs", "Commit and push", etc.).
- **Command bar** buttons open a terminal tab running a preset shell command.

Both are configured per project in `.orbit.json`.

</details>

<details>
<summary><b>Keyboard shortcuts</b></summary>

| | |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+\` | Split window |
| `Ctrl+W` / `Ctrl+Shift+W` | Close / undo-close window |
| `Ctrl+1…9` | Jump to Nth tab |
| `Alt+←/→/↑/↓` | Move between splits and tabs |
| `Ctrl+Shift+↑/↓` | Previous / next project |
| `Ctrl+,` / `Ctrl+H` / `Ctrl+/` | Settings / History / Shortcuts |

</details>

---

## Per-project config (`.orbit.json`)

Drop a `.orbit.json` at a project root — every field is optional. See [`orbit.example.json`](orbit.example.json) for all options.

| Field | What it does |
|---|---|
| `prompts` | Quick-prompt buttons on the Claude window |
| `commands` | Command bar shell buttons |
| `accent` | Hex color to identify this project across the UI |
| `docs` | Pinned docs strip files (`CLAUDE.md`, `WIP.md`, etc.) |
| `logDirs` | Folders the LOGS panel watches |
| `subprojects` | Monorepo members (auto-detected from `*.code-workspace` if omitted) |
| `coordination` | Lease dir, field names, WIP file — for parallel-agent setups |

---

## Notes

- First run in a new folder: `claude` shows a trust prompt in the terminal pane — answer it there.
- If resume fails (transcript deleted), Claude prints an error — just start a fresh session.
- Orbit removes `ANTHROPIC_API_KEY` from every spawned session so your subscription is always used.
