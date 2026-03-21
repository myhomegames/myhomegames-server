# Start-MyHomeGames-Server.exe (stub)

Small Windows GUI-subsystem executable: starts `MyHomeGames-Server-Tray.ps1` via PowerShell with no console window.

**Build** (normally done by `npm run build:win-tray` from `myhomegames-server/`):

```bash
cd scripts/tray-launcher-exe
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ../../build/Start-MyHomeGames-Server.exe .
```

Requires **Go 1.21+** on `PATH`.

Runtime errors from the launcher are appended to **`MyHomeGames-Server-Tray-errors.log`** next to the executable (see `README-WINDOWS.txt`).
