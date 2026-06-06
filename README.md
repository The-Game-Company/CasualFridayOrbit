<div align="center">

# ◆ Orbit

**A local desktop wrapper around the Claude Code CLI.**

Run your already-installed, already-logged-in `claude` behind a reactive, multi-session UI —
**no API key, no separate auth.** If you're logged in, Orbit uses your subscription.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-2b6cb0)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![license](https://img.shields.io/badge/license-MIT-3fb950)

</div>

---

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [How it works](#how-it-works)
- [Per-project config (`.orbit.json`)](#per-project-config-orbitjson)
- [Project layout](#project-layout)
- [Notes & limitations](#notes--limitations)

---

## Quick start

> [!NOTE]
> Orbit drives your **logged-in** `claude`. After installing the CLI, run `claude` once and
> sign in with your subscription (no API key). The setup scripts below install it for you if
> it's missing.

### macOS — easiest (no commands)

After cloning, **double-click `Install Orbit (macOS).command`** in the project folder. It
installs everything (Node, the Claude Code CLI, dependencies), builds Orbit, and puts it in
your **Applications and Dock** — like any normal Mac app. Then open Terminal once, run
`claude`, and sign in (no API key).

### Windows — easiest (no commands)

After cloning, **double-click `Install Orbit (Windows).cmd`** in the project folder. It installs
everything (Node, the Claude Code CLI, dependencies), builds Orbit, and adds **Desktop and Start
Menu** shortcuts — then opens it. You'll only see a Windows administrator prompt if Node has to be
installed. The first time, run `claude` once (or sign in from Orbit's terminal pane) with your
subscription (no API key).

### One-shot setup (from a terminal)

Installs Node + the Claude Code CLI if missing, installs dependencies, then runs or builds.

**macOS** (Apple Silicon or Intel):

```bash
./scripts/setup-mac.sh --install   # build + install to /Applications & Dock (same as the double-click)
./scripts/setup-mac.sh             # or just launch dev mode (hot reload)
./scripts/setup-mac.sh --dmg       # or build a .dmg / .zip
```

**Windows**:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1             # set up, then launch dev
pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Installer  # set up, then NSIS installer
```

### Manual

```bash
npm install
npm run dev               # dev server + hot reload
npm run dist              # package an unpacked app   → dist/
npm run dist:installer    # Windows: NSIS .exe  ·  macOS: .dmg + .zip
```

> [!TIP]
> If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary didn't
> download during install — run `node ./node_modules/electron/install.js`.

> [!IMPORTANT]
> macOS builds are unsigned. On first launch, right-click the app → **Open**
> (or `xattr -dr com.apple.quarantine Orbit.app`).

---

## Features

- **Many CLIs at once, grouped by project.** Each project keeps its own set of live
  `claude` terminals. Switching projects keeps every session running in the background;
  you come back to exactly where you left off. `＋` adds another CLI to the current project.
- **Faithful terminal feed.** The real `claude` TUI runs in a pseudo-terminal and is
  rendered with xterm.js (custom font + theme). Permission prompts, slash menus, etc. all
  still work.
- **Reactive status everywhere** (driven by Claude Code hooks):
  - per-tab + per-project **status dots** (idle / busy-pulsing / amber "waiting"),
  - **agent counters** — how many subagents (`Task`) are running right now, per tab and
    summed per project,
  - **active skill** highlighted in the Skills panel + a title-bar flash,
  - **files currently being edited/read** highlighted (pulsing) in the Context tree, with
    recently-touched files tinted.
- **"Waiting for you" indicator.** When a background session finishes (`Stop`) or needs
  input (`Notification`) while you're looking elsewhere, its tab + project get an amber
  pulse, plus a desktop notification.
- **Session persistence + auto-resume.** The whole workspace (which sessions are open per
  project, their kinds, titles, split layout, and each chat's real claude session id) is
  saved continuously and atomically to `userData/workspace.json`. On launch — even after a
  crash — every previously-open chat **reopens** (the captured session id comes from the
  `session_id` in the hook payloads).
- **Lazy-resume (no startup burst).** Restored tabs reopen *paused* (dimmed, ⏸). A chat's
  `claude --resume <id>` (or a shell) only actually spawns the first time you **show/focus**
  that tab — so launching with 20 saved chats doesn't spawn 20 processes at once. The
  currently-active project's visible pane(s) start immediately.
- **Restore controls.** Settings has a global **Resume previous sessions on launch** toggle;
  **right-click any project** to make just that one **start empty on launch** (marked with
  `∅`). While the global toggle is off, the saved layout is preserved (not overwritten) so
  re-enabling brings it back.
- **History of past chats.** The `⟲ history` toolbar button lists previous conversations
  for the active project (read from `~/.claude/projects/<cwd>/<id>.jsonl`, titled from the
  first real prompt or a summary). Click one to resume it in a new tab; if it's already
  open, it just focuses it.
- **Parallel-agent coordination (COORD tab).** Live view of `.claude/leases/*.lease.json`
  (resource, agent, age, stale-after-expiry), the `WIP.md` Active registry, and recent
  `takeovers.log` — watched and refreshed on change. Files covered by a lease show a 🔒 in
  the trees, and the editor warns when the open file is leased by another agent or being
  written *right now* by any session's agent. (The lease "stale" window is configurable
  in Settings — defaults to 20 min, no workflow-specific assumptions baked in.)
- **Live subagent tree (AGENTS).** When a session dispatches `Task` subagents, each shows
  as a node (type like `@backend`, its task, running/done) — built from the hook stream.
- **Log tailer (LOGS tab).** Auto-tails the newest `*.log` from configurable folders
  (default `PlayLogs, logs, Logs` — editable in Settings) for the active project, with a
  live filter + follow toggle.
- **Pinned docs nav.** Quick-open chips for a project's always-on docs (`CLAUDE.md`,
  `STATUS.md`, `WIP.md`, `ASSISTANT_RULES.md`, `INITIATIVES.md`, …) with staleness ages.
- **Non-locking, conflict-aware file editor.** Edit context files *or* any project file
  (Context ⇄ Files toggle in the right panel; the Files tree is a lazy project browser).
  Opening a file caches a snapshot + baseline hash and **never locks it**. While your
  buffer is clean it **live-refreshes** as the file changes on disk; the moment you start
  editing it freezes and, if the file then changes (an agent/the project), shows a
  "changed on disk" banner. If *any* session's agent is currently writing the file you get
  a "not a good time" warning. **Save is the only write**: it compares the disk hash to
  your baseline and, on divergence, offers **Overwrite / Reload-latest / Cancel** — exactly
  like Notepad++. `.md` files open in a **rendered Markdown view** with an Edit toggle.
  The editor can run as a full overlay or be **docked beside the terminals** (⤡ toggle) so
  you can edit while watching agents work.
- **Skills browser.** Lists project + user skills; click one to drop `/skill ` into the
  active session.
- **Projects / Context / Activity panels**, a **session toolbar** (interrupt, restart,
  `--continue`, clear, font size), and **persisted settings** (projects folder w/ picker,
  theme, font size).

---

## How it works

```
   Electron MAIN (Node)                              Electron RENDERER (React)
 ┌──────────────────────────────────────┐         ┌────────────────────────────────────┐
 │ SessionManager: N× PtySession         │   IPC   │ Projects │  tabs + N× xterm │ Context│
 │   each spawns claude in a PTY,        │◄───────►│  Skills  │  toolbar         │ Activity│
 │   cwd = project, NO api key           │         └────────────────────────────────────┘
 │   claude --settings <temp.json>       │
 │                                       │   each hook runs hook-forwarder.cjs, which
 │ http server 127.0.0.1:<port> ◄─hooks──┤   POSTs {sessionId, event, data} to us
 │   tags events by ORBIT_SESSION_ID      │   → session-model.applyEvent() derives all
 │                                       │     the reactive state (status/agents/files…)
 │ chokidar per session ─ context files ─┤   → Context tree
 └──────────────────────────────────────┘
```

Three independent signal sources:

1. **Terminal feed** — interactive `claude` in a PTY (`@lydell/node-pty`, a prebuilt
   N-API build → **no C++ compiler needed**), rendered by xterm.js.
2. **Structured events** — hooks injected **only into our spawned sessions** via
   `claude --settings <temp.json>` (merges with, never clobbers, your global settings).
   A tiny forwarder POSTs each hook payload to a localhost server, tagged with the
   session id (`ORBIT_SESSION_ID`) so events route to the right tab. `PreToolUse`/
   `PostToolUse` drive busy/agent/file/skill state; `Stop`/`Notification` drive the
   "waiting for you" state.
3. **Context files** — one `chokidar` watch per session; independent of the CLI.

> [!NOTE]
> **No-API-key guarantee:** Orbit spawns the real `claude` with your normal environment and
> deliberately `delete`s `ANTHROPIC_API_KEY`. If you're logged in, it uses your subscription.
> It never uses `--bare` (the only mode that ignores your OAuth login).

---

## Per-project config (`.orbit.json`)

Orbit's collision detection has two tiers:

1. **Universal (zero-config):** Orbit injects its own hooks into every session it
   spawns, so the `busyFiles` / 🔒-in-tree / "an agent is writing this now" signals work on
   **any** project with no convention at all.
2. **Optional (adapter-driven):** the COORD panel reads a project's lease/WIP files. Their
   format is **not hardcoded** — Orbit reads a project's own `.orbit.json` declaration,
   falling back to sensible defaults. So if a project changes its lease format, it edits its
   `.orbit.json`, **not Orbit**. A project with no `.orbit.json` just uses the
   defaults (and the panel is empty if it has no such files — it can never break the app,
   since this is read-only).

Drop a `.orbit.json` at a project root to declare your layout — see
[`orbit.example.json`](orbit.example.json) for every field. Beyond coordination, the
same manifest also drives:

| Field | What it does |
| --- | --- |
| `commands` | Quick buttons in the command bar; each opens a shell session running the command (e.g. tail newest log, a repo's verify cmd). |
| `prompts` | Quick-prompt buttons floating on the focused claude window (e.g. "Check Logs", "Commit & push"); clicking one types the prompt into claude and submits it. |
| `subprojects` | Monorepo members shown nested in the Projects panel, each a full project with its own context/COORD/config. Auto-detected from a `*.code-workspace` if omitted. |
| `accent` | A hex color that color-codes the project across its tabs/UI. |
| `docs` | The exact always-on docs for the pinned-docs strip. |

---

## Project layout

```
src/
  main/
    index.ts            app lifecycle, window, IPC, desktop notifications
    session-manager.ts  owns N sessions (PTY + context watcher each)
    pty.ts              resolve the claude binary + spawn it in a PTY (per session)
    shell-path.ts       recover the login-shell PATH for Finder-launched apps (macOS)
    hook-server.ts      localhost server receiving hook events (tagged by session)
    settings-inject.ts  temp settings.json + hook-forwarder.cjs
    context-watch.ts    chokidar watch of context files
    projects.ts         enumerate project folders
    skills.ts           discover project + user skills (SKILL.md)
    history.ts          read past claude transcripts (~/.claude/projects/<cwd>/*.jsonl)
    workspace.ts        load/save the restartable workspace (atomic write)
    files.ts            file browser IO + hash-based save + single-file disk watcher
    coordination.ts     parse/watch .claude/leases + WIP.md + takeovers.log; lease↔path match
    logs.ts             newest-log tailer + key-doc (pinned docs) listing
    updater.ts          check/run Claude Code self-update (winget / npm)
    config.ts           persisted settings (userData/config.json)
  preload/index.ts      contextBridge API (window.orbit.*)
  renderer/src/
    App.tsx             orchestration: sessions, tabs, active project
    session-model.ts    SessionState + applyEvent() reducer (the reactive brain)
    themes.ts           xterm themes
    components/         Terminal, TabBar, Toolbar, Projects, SkillsPanel, ContextPanel,
                         FileTree, EditorModal, HistoryModal, Activity, SettingsModal, indicators
  shared/events.ts      shared types + IPC channel names
scripts/
  setup-mac.sh          one-shot macOS setup (Node + Claude Code + deps + run/build)
  setup-windows.ps1     one-shot Windows setup (same)
  launch-mac.sh         build, then run the built app (macOS counterpart of launch.cmd)
  gen-icon.mjs          generate orbit.ico / .png / .icns from code
```

---

## Notes & limitations

- `--resume` fails gracefully: if a transcript was deleted, claude prints an error in that
  pane; just restart it fresh.
- Excluding a project from restore drops its sessions from the workspace cache on next
  boot (they remain reachable via `⟲ history`).
- Agent/file counters are reset on each `Stop`, so they're accurate per-turn even without
  pairing tool ids; mid-turn they reflect in-flight `Pre`/`Post` deltas.
- On first run in a folder, `claude` shows its **trust prompt** (and possibly a
  **review-hooks prompt**) in the terminal — answer it there.
- Skill detection assumes the `Skill` tool input key is `skill`/`skill_name`/`name`.
- macOS packaging is unsigned/un-notarized — fine for a local build, but a downloaded copy
  would need `xattr -dr com.apple.quarantine Orbit.app` (or right-click → Open) to bypass
  Gatekeeper. Set up a Developer ID + notarization before distributing.
