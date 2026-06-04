<#
  Orbit - one-shot, double-click installer for Windows (dev mode, run from source).

  Installs Node (via winget, machine-wide - the only step that needs admin) and the Claude
  Code CLI if missing, installs npm dependencies, generates icons, builds Orbit, then creates
  Desktop + Start Menu shortcuts and launches it once. Self-elevates ONLY when Node must be
  installed; an already-set-up machine never sees a UAC prompt.

  Designed for PowerShell 5.1 (no &&/|| chains, no ternary). Launched by Install Orbit (Windows).cmd.
#>
param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Info($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!   $m" -ForegroundColor Yellow }

# Print a plain-English failure and exit non-zero so the launching .cmd pauses on it.
function Fail($m) {
  Write-Host ""
  Write-Host "Could not finish setting up Orbit." -ForegroundColor Red
  Write-Host $m -ForegroundColor Red
  exit 1
}

# Native commands (npm, node, winget) don't throw on non-zero exit; check $LASTEXITCODE.
function Assert-LastExit($what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit $LASTEXITCODE). See the messages above." } }

# Re-read machine + user PATH from the registry so a just-installed tool is usable this run.
function Refresh-Path {
  $machine = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name Path -ErrorAction SilentlyContinue).Path
  $user = (Get-ItemProperty 'HKCU:\Environment' -Name Path -ErrorAction SilentlyContinue).Path
  $parts = @()
  if ($machine) { $parts += $machine }
  if ($user) { $parts += $user }
  $env:Path = ($parts -join ';')
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "Installing Orbit for Windows" -ForegroundColor White
Info "repo: $repo"
Write-Host ""

# --- Step 1/5: Node.js -------------------------------------------------------
Info "Step 1/5: Checking Node.js..."
$needNode = $true
if (Have node) {
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -ge 18) { Ok "Node $(node -v)"; $needNode = $false }
  else { Warn "Node $(node -v) is too old (Orbit needs >= 18); will install a newer one." }
}
if ($needNode) {
  if (-not (Have winget)) {
    Fail "Node.js 18+ is required but winget isn't available to install it. Install Node from https://nodejs.org/en/download (LTS), then double-click this installer again."
  }
  # Installing Node machine-wide needs admin; self-elevate now if we aren't already.
  if (-not (Test-Admin)) {
    Info "Node needs to be installed - asking for administrator permission..."
    $psi = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    try {
      $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $psi -Verb RunAs -PassThru
    } catch {
      Fail "Administrator permission is needed to install Node. Please click Yes on the prompt, or install Node yourself from https://nodejs.org and re-run."
    }
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { exit $p.ExitCode }
    # The elevated child did the install + build + shortcuts; finish by launching from here.
    $electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
    Write-Host ""
    Ok "Orbit is installed (Node was installed with administrator permission)."
    if (Test-Path $electron) {
      Info "Launching Orbit now..."
      Start-Process -FilePath $electron -ArgumentList "`"$repo`"" -WorkingDirectory $repo
    } else {
      Warn "electron.exe not found - open Orbit from the Desktop shortcut instead."
    }
    exit 0
  }
  Info "Installing Node LTS via winget (this can take a couple of minutes)..."
  winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
  Refresh-Path
  if (-not (Have node)) {
    Fail "Node was installed but isn't visible yet. Close this window and double-click the installer one more time."
  }
  Ok "Node $(node -v)"
}

# --- Step 2/5: Claude Code CLI ----------------------------------------------
Info "Step 2/5: Checking Claude Code CLI..."
if (Have claude) {
  $v = (claude --version 2>$null | Select-Object -First 1)
  Ok "Claude Code present ($v)"
} else {
  Warn "Claude Code CLI not found - installing..."
  $installed = $false
  if (Have winget) {
    Info "Installing via winget (Anthropic.ClaudeCode)..."
    try {
      winget install --id Anthropic.ClaudeCode --source winget --accept-source-agreements --accept-package-agreements
      if ($LASTEXITCODE -eq 0) { $installed = $true }
    } catch { Warn "winget install failed: $($_.Exception.Message)" }
  }
  if (-not $installed) {
    Info "Falling back to npm (@anthropic-ai/claude-code, no admin needed)..."
    npm install -g @anthropic-ai/claude-code
    Assert-LastExit "npm install -g @anthropic-ai/claude-code"
  }
  Refresh-Path
  if (Have claude) { Ok "Claude Code installed." }
  else { Warn "Claude installed but not on PATH yet - you can still sign in from Orbit's terminal." }
}

# --- Step 3/5: dependencies + icons -----------------------------------------
Info "Step 3/5: Installing dependencies..."
npm install
Assert-LastExit "npm install"
Ok "Dependencies installed."

# The Electron postinstall sometimes skips the binary download; fetch it explicitly if missing.
$electronExe = Join-Path $repo 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electronExe)) {
  Info "Downloading the Electron runtime (one-time)..."
  node node_modules/electron/install.js
  Assert-LastExit "Electron runtime download"
  if (-not (Test-Path $electronExe)) { Fail "The Electron runtime did not download. Check your internet connection and double-click the installer again." }
  Ok "Electron runtime downloaded."
}

if (-not (Test-Path "resources\orbit.ico")) {
  Info "Generating app icons..."
  node scripts/gen-icon.mjs
  Assert-LastExit "icon generation"
}

# --- Step 4/5: build --------------------------------------------------------
Info "Step 4/5: Building Orbit..."
npm run build
Assert-LastExit "npm run build"
Ok "Build complete."

# --- Step 5/5: shortcuts ----------------------------------------------------
Info "Step 5/5: Creating Desktop and Start Menu shortcuts..."
$shortcut = Join-Path $PSScriptRoot 'install-orbit-shortcut.ps1'
try {
  & $shortcut -Desktop
  & $shortcut
  Ok "Shortcuts created (Desktop + Start Menu)."
} catch {
  Fail "Setup finished but the shortcut couldn't be created: $($_.Exception.Message). You can still launch Orbit with launch.cmd in this folder."
}

# --- Launch + first-use note ------------------------------------------------
Write-Host ""
Ok "Orbit is installed."
Write-Host "First time only: Orbit drives your logged-in 'claude'. If you haven't signed in yet," -ForegroundColor White
Write-Host "open a terminal in Orbit (or run 'claude' anywhere), and log in with your subscription -" -ForegroundColor White
Write-Host "no API key needed." -ForegroundColor White
Write-Host ""
# Skip the launch in the elevated child so Orbit runs at normal rights from the parent window.
if ($Elevated) {
  Info "Done - this window will close and Orbit will open from the original window."
  exit 0
}
Info "Launching Orbit now..."
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
if (Test-Path $electron) {
  Start-Process -FilePath $electron -ArgumentList "`"$repo`"" -WorkingDirectory $repo
} else {
  Warn "electron.exe not found - open Orbit from the Desktop shortcut instead."
}
exit 0
