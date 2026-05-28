#!/usr/bin/env bash
#
# launch-mac.sh — build the latest source, then run the built Orbit.
# The macOS counterpart of launch.cmd. Use this for the in-app "Rebuild & Restart"
# (Cmd+Shift+R) workflow; for live hot-reload while editing, use `npm run dev` instead.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Pick up Homebrew / Node / Claude on PATH even from a minimal shell.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "Building Orbit (latest changes)…"
if ! npm run build; then
  echo
  echo "BUILD FAILED — see errors above."
  exit 1
fi

# The Electron binary sometimes doesn't download during `npm install`; fetch it if missing.
if [ ! -x "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
  echo "Electron binary missing — fetching it…"
  node ./node_modules/electron/install.js
fi

echo "Launching Orbit…"
exec ./node_modules/.bin/electron .
