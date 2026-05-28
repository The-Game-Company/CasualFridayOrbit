#!/usr/bin/env bash
#
# Orbit — one-shot setup for macOS (Apple Silicon & Intel).
#
# Installs anything missing (Node via Homebrew, the Claude Code CLI), installs npm
# dependencies, generates the app icons, then runs or packages Orbit.
#
# Usage:
#   scripts/setup-mac.sh           set up, then launch dev mode (npm run dev)   [default]
#   scripts/setup-mac.sh --app     set up, then build an unpacked Orbit.app     (npm run dist)
#   scripts/setup-mac.sh --dmg     set up, then build a .dmg + .zip             (npm run dist:installer)
#   scripts/setup-mac.sh --setup   set up only (deps + Claude); don't run/build
#   scripts/setup-mac.sh --help
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Make freshly-installed CLIs (Homebrew, the Claude native installer) visible to this
# script without needing a brand-new shell.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  # Print the leading comment block (everything after the shebang up to the first code line).
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
}

MODE="dev"
case "${1:-}" in
  --app)               MODE="app" ;;
  --dmg|--installer)   MODE="dmg" ;;
  --setup|--setup-only) MODE="setup" ;;
  ""|--dev|--run)      MODE="dev" ;;
  -h|--help)           usage; exit 0 ;;
  *) die "unknown option: $1 (try --help)" ;;
esac

bold "Orbit setup for macOS"
info "repo: $REPO"
echo

# --- 1. Node.js --------------------------------------------------------------
ensure_node() {
  if have node; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "${major:-0}" -ge 18 ]; then ok "Node $(node -v)"; return; fi
    warn "Node $(node -v) is too old (Orbit needs >= 18)."
  else
    warn "Node.js not found."
  fi
  if have brew; then
    info "Installing Node via Homebrew…"
    brew install node
    ok "Node $(node -v)"
  else
    die "Node.js >= 18 is required. Install Homebrew (https://brew.sh) and re-run, or get Node from https://nodejs.org."
  fi
}
ensure_node

# --- 2. Claude Code CLI ------------------------------------------------------
# Orbit drives your logged-in `claude`; it needs to be installed (login is interactive,
# so we can't do that part for you).
ensure_claude() {
  if have claude; then
    ok "Claude Code present ($(claude --version 2>/dev/null | head -n1))"
    return
  fi
  warn "Claude Code CLI not found — installing…"
  # Prefer Anthropic's official native installer; fall back to the npm package.
  if have curl && curl -fsSL https://claude.ai/install.sh | bash; then
    ok "Installed Claude Code (native installer)."
  else
    warn "Native installer unavailable/failed; falling back to npm…"
    npm install -g @anthropic-ai/claude-code
  fi
  export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if have claude; then
    ok "Claude Code installed ($(claude --version 2>/dev/null | head -n1))"
  else
    warn "Claude installed but not on PATH yet — open a new terminal (or add ~/.local/bin to PATH)."
  fi
  warn "Before using Orbit, run 'claude' once and log in with your subscription (no API key needed)."
}
ensure_claude

# --- 3. dependencies + icons -------------------------------------------------
info "Installing npm dependencies…"
npm install
ok "Dependencies installed."

if [ ! -f resources/orbit.icns ]; then
  info "Generating app icons…"
  node scripts/gen-icon.mjs
fi

# --- 4. run / build ----------------------------------------------------------
echo
case "$MODE" in
  setup)
    ok "Setup complete."
    info "Next: 'npm run dev' (live) · 'npm run dist' (.app) · 'npm run dist:installer' (.dmg)"
    ;;
  app)
    info "Building unpacked Orbit.app (npm run dist)…"
    npm run dist
    ok "Done — see the dist/ folder for Orbit.app."
    ;;
  dmg)
    info "Building installer (npm run dist:installer)…"
    npm run dist:installer
    ok "Done — see the dist/ folder for the .dmg and .zip."
    ;;
  dev)
    ok "Setup complete — launching dev mode (Ctrl+C to stop)."
    npm run dev
    ;;
esac
