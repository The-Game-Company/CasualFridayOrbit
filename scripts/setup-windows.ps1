<#
  Orbit — one-shot setup for Windows.

  Installs anything missing (Node via winget, the Claude Code CLI), installs npm
  dependencies, generates the app icons, then runs or packages Orbit.

  Usage (from any shell):
    pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1             # setup, then dev
    pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -App        # setup, then unpacked build (npm run dist)
    pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Installer  # setup, then NSIS installer (npm run dist:installer)
    pwsh -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -SetupOnly  # deps + Claude only
#>
param(
  [switch]$App,
  [switch]$Installer,
  [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Info($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!   $m" -ForegroundColor Yellow }
# Native commands (npm, node) don't throw on non-zero exit even under -ErrorAction Stop, so check explicitly.
function Assert-LastExit($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Write-Host "Orbit setup for Windows" -ForegroundColor White
Info "repo: $repo"
Write-Host ""

# --- 1. Node.js --------------------------------------------------------------
if (Have node) {
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -ge 18) { Ok "Node $(node -v)" }
  else { throw "Node $(node -v) is too old (Orbit needs >= 18). Update from https://nodejs.org and re-run." }
} else {
  Warn "Node.js not found."
  if (Have winget) {
    Info "Installing Node LTS via winget..."
    try { winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements }
    catch { throw "Couldn't install Node automatically. Install it from https://nodejs.org and re-run." }
    Warn "Open a NEW terminal so Node is on PATH, then re-run this script."
    exit 0
  } else {
    throw "Node.js >= 18 is required. Install it from https://nodejs.org and re-run."
  }
}

# --- 2. Claude Code CLI ------------------------------------------------------
# Orbit drives your logged-in `claude`; it needs to be installed (login is interactive,
# so we can't do that part for you).
function Install-Claude {
  if (Have claude) {
    $v = (claude --version 2>$null | Select-Object -First 1)
    Ok "Claude Code present ($v)"
    return
  }
  Warn "Claude Code CLI not found - installing..."
  $installed = $false
  if (Have winget) {
    Info "Installing via winget (Anthropic.ClaudeCode)..."
    try {
      winget install --id Anthropic.ClaudeCode --source winget --accept-source-agreements --accept-package-agreements
      $installed = $true
    } catch { Warn "winget install failed: $($_.Exception.Message)" }
  }
  if (-not $installed) {
    Info "Falling back to npm (@anthropic-ai/claude-code)..."
    npm install -g @anthropic-ai/claude-code
    Assert-LastExit "npm install -g @anthropic-ai/claude-code"
  }
  if (Have claude) { Ok "Claude Code installed." }
  else { Warn "Claude installed but not on PATH yet - open a new terminal." }
  Warn "Before using Orbit, run 'claude' once and log in with your subscription (no API key needed)."
}
Install-Claude

# --- 3. dependencies + icons -------------------------------------------------
Info "Installing npm dependencies..."
npm install
Assert-LastExit "npm install"
Ok "Dependencies installed."

if (-not (Test-Path "resources\orbit.ico")) {
  Info "Generating app icons..."
  node scripts/gen-icon.mjs
  Assert-LastExit "icon generation"
}

# --- 4. run / build ----------------------------------------------------------
Write-Host ""
if ($SetupOnly) {
  Ok "Setup complete."
  Info "Next: npm run dev (live) | npm run dist (unpacked) | npm run dist:installer (NSIS)"
  return
}
if ($Installer) {
  Info "Building installer (npm run dist:installer)..."
  npm run dist:installer
  Assert-LastExit "dist:installer"
  Ok "Done - see the dist\ folder for the installer."
  return
}
if ($App) {
  Info "Building unpacked app (npm run dist)..."
  npm run dist
  Assert-LastExit "dist"
  Ok "Done - see the dist\ folder for the app."
  return
}
Ok "Setup complete - launching dev mode (Ctrl+C to stop)."
npm run dev
