@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install-shortcut.ps1"

if not exist "%PS1%" (
  echo [SeMa] Missing script: "%PS1%"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
  echo [SeMa] Install shortcut failed.
  pause
  exit /b 1
)

echo [SeMa] Shortcuts installed.
exit /b 0
