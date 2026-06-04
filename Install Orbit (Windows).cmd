@echo off
rem Double-click this file to install Orbit (dev mode) and add Desktop + Start Menu shortcuts.
cd /d "%~dp0"

echo ----------------------------------------------
echo   Installing Orbit for Windows
echo ----------------------------------------------
echo.
echo This sets up everything needed (Node, the Claude Code CLI, dependencies),
echo builds Orbit, and adds shortcuts. It may ask for administrator permission
echo only if Node has to be installed. First run can take a few minutes.
echo.

rem Prefer PowerShell 7 if it's installed, but Windows PowerShell 5.1 must work too.
set "PS=powershell.exe"
where pwsh.exe >nul 2>&1 && set "PS=pwsh.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Orbit is installed - look for "Orbit" on your Desktop and in the Start menu.
) else (
  echo Something went wrong - see the messages above.
)
echo.
pause
exit /b %RC%
