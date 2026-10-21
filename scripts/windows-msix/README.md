# MyHomeGames Windows MSIX

The package contains the `pkg` server, `MyHomeGames-Server-Tray.ps1`, `MyHomeGames.env`, `server-info.json`, and optional tray icon. `MyHomeGames.exe` is the entry point: it starts the server executable, then the tray. It does not extract files or create a Start Menu shortcut. Windows does that from `AppxManifest.xml`.

PowerShell cannot start another executable inside `WindowsApps` (CreateProcess returns access denied). The tray only attaches to the process id passed by the entry point (`MYGAMES_SERVER_PID`). The zip launcher still starts the server from the tray script, because those files are extracted under `%LOCALAPPDATA%`.

The config file is `MyHomeGames.env` rather than `.env`. An extensionless file has no Appx content type, and Windows refuses to install the package. The tray and the server read this name when `.env` is absent. The self-extracting exe still ships `.env`.

Library data stays in the real `%APPDATA%\MyHomeGames` and `%LOCALAPPDATA%\MyHomeGames` folders. The manifest excludes those paths from MSIX file virtualization, so an existing library is the one the package uses.

## Build

From `myhomegames-server/`:

```bash
npm run build:win-msix
```

Requires **Go 1.21+**. Runs `pkg` (`node18-win-x64`) if `build/` has no Windows server exe.

On macOS and Linux this writes a signed `build/MyHomeGames-1.2.9-win-x64.msix` and `build/MyHomeGames-1.2.9.cer`. The package version is `1.2.9` (`Identity` `1.2.9.0` in `scripts/windows-msix/build.js`) and does not follow `package.json`. Packing uses [openappx](https://github.com/gianlucamazza/openappx) (Python 3.10+). The first run creates `build/openappx-venv` and a self-signed certificate for `CN=E85A2E78-E3FE-4829-96B9-294CD6CDD7C2` in `build/msix-signing/`, valid through 9999-12-31. Keep that directory: a new certificate must be trusted again on Windows. The package identity is `lucastancapiano.myhomegames-server`.

These files are for Partner Center and local sideload. `npm run release` does not upload them; the public Windows download remains the zip.

On Windows, with the Windows 10/11 SDK (`makeappx`, `signtool`), the same command packs and signs with the SDK instead. `pack.ps1` also writes the public `.cer`.

Install on Windows (sideload or Developer Mode enabled):

```powershell
Import-Certificate -FilePath MyHomeGames-1.2.9.cer -CertStoreLocation Cert:\CurrentUser\TrustedPeople
Add-AppxPackage -Path MyHomeGames-1.2.9-win-x64.msix
```
