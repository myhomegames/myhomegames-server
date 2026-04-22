@echo off
REM Optional fallback (dev): double-click to start tray launcher via PowerShell.
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%MyHomeGames-Server-Tray.ps1"
if errorlevel 1 (
  echo.
  echo MyHomeGames Server could not start. Open README-WINDOWS.txt for help.
  pause
)
