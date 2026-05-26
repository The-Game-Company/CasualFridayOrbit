@echo off
rem Build the latest source, then launch Orbit.
cd /d "%~dp0"
echo Building Orbit (latest changes)...
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED - see errors above.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0
