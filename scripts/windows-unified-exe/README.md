# MyHomeGames `*-win-x64-unified.exe`

Single Windows executable built with Go (`embed`): includes the `pkg` server binary, `MyHomeGames-Server-Tray.ps1`, `.env`, `server-info.json`, optional `MyHomeGames-Tray.png`, and `README-WINDOWS.txt`.

On launch it writes files under:

`%LOCALAPPDATA%\MyHomeGames\server-runtime\<version>\`

and runs PowerShell with the tray script (same behaviour as the tray zip).

**Build** (from `myhomegames-server/`):

```bash
npm run build:win-unified
```

Requires **Go 1.21+**. Requires the Windows server exe in `build/` (script runs `pkg` if missing).
