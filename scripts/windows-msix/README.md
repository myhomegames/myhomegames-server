# MyHomeGames Windows MSIX

The package contains the `pkg` server, `MyHomeGames-Server-Tray.ps1`, `.env`, `server-info.json`, and optional tray icon. `MyHomeGames.exe` is the entry point: it starts the tray from the install folder. It does not extract files or create a Start Menu shortcut. Windows does that from `AppxManifest.xml`.

Library data stays in the real `%APPDATA%\MyHomeGames` and `%LOCALAPPDATA%\MyHomeGames` folders. The manifest excludes those paths from MSIX file virtualization, so an existing library is the one the package uses.

## Build

From `myhomegames-server/`:

```bash
npm run build:win-msix
```

Requires **Go 1.21+**. Runs `pkg` (`node18-win-x64`) if `build/` has no Windows server exe.

On macOS or Linux this writes `build/msix-layout/`. On Windows, with the Windows 10/11 SDK (`makeappx`, `signtool`), it also writes a signed `build/MyHomeGames-<ver>-win-x64.msix`. The manifest publisher is `CN=MyHomeGames`. If that cert is missing, `pack.ps1` creates a self-signed one and trusts it for the current user.

Pack a layout that was staged on another machine:

```powershell
powershell -File scripts/windows-msix/pack.ps1 -Layout build/msix-layout -OutFile build/MyHomeGames-1.2.5-win-x64.msix
Add-AppxPackage -Path build/MyHomeGames-1.2.5-win-x64.msix
```
