#!/usr/bin/env bash
#
# Orbit — one-shot setup for macOS (Apple Silicon & Intel).
#
# Installs anything missing (Homebrew, Node, the Claude Code CLI), installs npm
# dependencies, then runs, builds, or installs Orbit.
#
# Usage:
#   scripts/setup-mac.sh            set up, then launch dev mode (npm run dev)        [default]
#   scripts/setup-mac.sh --install  set up, build the app, install it to /Applications + Dock
#   scripts/setup-mac.sh --app      set up, then build an unpacked Orbit.app
#   scripts/setup-mac.sh --dmg      set up, then build a .dmg + .zip
#   scripts/setup-mac.sh --setup    set up only (deps + Claude); don't run/build
#   scripts/setup-mac.sh --help
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Make freshly-installed CLIs (Homebrew, Node, the Claude installer) visible to this run.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
}

MODE="dev"
case "${1:-}" in
  --install)            MODE="install" ;;
  --app)                MODE="app" ;;
  --dmg|--installer)    MODE="dmg" ;;
  --setup|--setup-only) MODE="setup" ;;
  ""|--dev|--run)       MODE="dev" ;;
  -h|--help)            usage; exit 0 ;;
  *) die "unknown option: $1 (try --help)" ;;
esac

bold "Orbit setup for macOS"
info "repo: $REPO"
echo

# --- 1. Homebrew + Node ------------------------------------------------------
ensure_node() {
  if have node; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "${major:-0}" -ge 18 ]; then ok "Node $(node -v)"; return; fi
    warn "Node $(node -v) is too old (Orbit needs >= 18); upgrading…"
  else
    warn "Node.js not found."
  fi
  if ! have brew; then
    warn "Installing Homebrew (you may be asked for your Mac password)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || true
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
  fi
  if have brew; then
    info "Installing Node via Homebrew…"
    brew install node
    ok "Node $(node -v)"
  else
    die "Couldn't install Node automatically. Install Node 18+ from https://nodejs.org and re-run."
  fi
}
ensure_node

# --- 2. Claude Code CLI ------------------------------------------------------
# Orbit drives your logged-in `claude`; it must be installed (login is interactive).
ensure_claude() {
  if have claude; then ok "Claude Code present ($(claude --version 2>/dev/null | head -n1))"; return; fi
  warn "Claude Code CLI not found — installing…"
  if have curl && curl -fsSL https://claude.ai/install.sh | bash; then
    ok "Installed Claude Code (native installer)."
  else
    warn "Native installer unavailable/failed; falling back to npm…"
    npm install -g @anthropic-ai/claude-code || true
  fi
  export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  have claude && ok "Claude Code installed ($(claude --version 2>/dev/null | head -n1))" \
              || warn "Claude installed but not on PATH yet — open a new terminal."
}
ensure_claude

# --- 3. dependencies + icons -------------------------------------------------
info "Installing npm dependencies…"
npm install
ok "Dependencies installed."
[ -f resources/orbit.icns ] || { info "Generating app icons…"; node scripts/gen-icon.mjs; }

# The dev Electron binary occasionally fails to download during `npm install`; fetch it.
# (Only the dev workflow needs this — the packaged build downloads its own Electron.)
ensure_electron_binary() {
  if [ ! -x "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    warn "Electron dev binary missing — reinstalling it…"
    node ./node_modules/electron/install.js || npm install electron --no-save || true
  fi
}

# Build the packaged app and install it to /Applications, then pin it to the Dock.
install_to_applications() {
  info "Building the app (first time can take a few minutes)…"
  npm run dist
  local app
  app="$(/usr/bin/find dist -maxdepth 4 -name 'Orbit.app' -type d 2>/dev/null | head -n1)"
  [ -n "$app" ] || die "Build finished but Orbit.app wasn't found under dist/."
  info "Installing to /Applications…"
  rm -rf "/Applications/Orbit.app"
  if ! cp -R "$app" "/Applications/Orbit.app" 2>/dev/null; then
    warn "Writing to /Applications needs permission — you may be asked for your password…"
    sudo cp -R "$app" "/Applications/Orbit.app"
  fi
  xattr -dr com.apple.quarantine "/Applications/Orbit.app" 2>/dev/null || true
  ok "Installed: /Applications/Orbit.app"
  # Pin to the Dock (best-effort, de-duped).
  if ! defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Orbit.app"; then
    defaults write com.apple.dock persistent-apps -array-add '<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>/Applications/Orbit.app</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>' 2>/dev/null \
      && killall Dock 2>/dev/null && ok "Pinned Orbit to the Dock." || true
  fi
}

# --- 4. run / build / install -----------------------------------------------
echo
case "$MODE" in
  setup)
    ok "Setup complete."
    info "Next: 'npm run dev' (live) · './scripts/setup-mac.sh --install' (real app in /Applications)"
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
  install)
    install_to_applications
    echo
    bold "All set!"
    if ! have claude || ! claude --version >/dev/null 2>&1; then
      warn "Run 'claude' once in Terminal and sign in (no API key) before using Orbit."
    else
      info "If you haven't yet, run 'claude' once in Terminal and sign in (no API key)."
    fi
    info "Orbit is in your Applications and Dock — opening it now…"
    open "/Applications/Orbit.app" 2>/dev/null || true
    ;;
  dev)
    ensure_electron_binary
    ok "Setup complete — launching dev mode (Ctrl+C to stop)."
    npm run dev
    ;;
esac
