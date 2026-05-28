#!/usr/bin/env bash
#
# Double-click this file (after cloning the repo) to install Orbit as a real macOS app.
# It installs everything needed, builds Orbit, and puts it in your Applications + Dock.
#
cd "$(dirname "${BASH_SOURCE[0]}")"

clear
echo "──────────────────────────────────────────────"
echo "  Installing Orbit for macOS"
echo "──────────────────────────────────────────────"
echo
echo "This sets up everything and installs Orbit as an app. It may ask for your"
echo "Mac password, and you'll sign into Claude separately. First run can take a"
echo "few minutes — you can leave this window alone until it finishes."
echo

bash scripts/setup-mac.sh --install
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "✅  Orbit is installed — find it in Applications or the Dock."
  echo "    (If you haven't yet: open Terminal, run 'claude', and sign in.)"
else
  echo "❌  Something went wrong — see the messages above."
fi
echo
read -n 1 -s -r -p "Press any key to close this window."
echo
