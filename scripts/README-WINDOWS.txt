MyHomeGames Server — Windows
==============================

DISTRIBUTION
------------
**Single file (simplest):** MyHomeGames-*-win-x64-unified.exe — one download. Double-click
it; on first run it unpacks the server, scripts and config under:

  %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version>\\

and starts the tray. No zip to extract. Same tray behaviour as below.

**Folder package (all-in-one zip):** MyHomeGames-*-win-x64-tray.zip — contains the packaged
server (`myhomegames-server-*.exe`), tray launcher (`Start-MyHomeGames-Server.exe`),
`MyHomeGames-Server-Tray.ps1`, `README-WINDOWS.txt`, optional `MyHomeGames-Tray.png`,
plus `.env` and `server-info.json`. Unzip anywhere and use QUICK START below.

**Optional smaller package:** MyHomeGames-*-win-x64-exe.zip — server executable + `.env`
+ `server-info` only (no tray; for headless / scripting).

QUICK START (tray zip — recommended layout)
--------------------------------------------
Double-click:

  Start-MyHomeGames-Server.exe

Or use **MyHomeGames-*-win-x64-unified.exe** (single file) instead — no unzip step.

This starts the server in the background (no server console window) and shows an icon
in the system tray (notification area, near the clock). Right-click the icon
for:

  - Open web app
  - Open API (browser)
  - About…
  - Quit server

FIRST RUN
---------
If Windows PowerShell asks about execution policy, the script uses
-ExecutionPolicy Bypass for this session only.

The server reads .env in this same folder. Default HTTPS URL is
https://localhost:41440

WINDOWS SECURITY / SMARTSCREEN / DEFENDER
------------------------------------------
The tray launcher and server .exe are not code-signed. Windows may show:

  - **SmartScreen** — "Windows protected your PC" / (IT) *Un'app non riconosciuta…* /
    **Consenti sull'app** — use **More info** / *Altre informazioni*, then **Run anyway**
    / *Esegui comunque* if you downloaded MyHomeGames from the official site or GitHub.

  - **Microsoft Defender** — a detection name (often a heuristic) on first run. Open
    **Windows Security** → **Protection history** → select the item → **Actions** →
    **Allow on device** / restore (wording depends on Windows version and language).

This behaviour is a known false positive for small tools that start PowerShell in the
background. Only allow the file if you trust the source of the download.

ERROR LOG (copy/paste support)
------------------------------
If something fails, the same folder as the launcher may contain:

  MyHomeGames-Server-Tray-errors.log

It is **appended** on each error (timestamped blocks). Open it in Notepad to copy the
full text for support. The error dialog also shows this path when applicable.

TROUBLESHOOTING
---------------
"Already running" but no tray icon — a stale lock file can remain after a crash. Delete:

  %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version>\\.tray-instance.lock

then start again.

"Could not start the tray launcher" / exit code 1 — if the log says **server
executable not found**, the packaged server `.exe` is missing next to the launcher
(same folder). Re-extract the full **win-x64-tray** zip or copy `myhomegames-server-*.exe`
back into that folder.

MyHomeGames-Tray.png (when present) is the same icon as the macOS app — keep it
next to the scripts so the tray uses it.

ALTERNATIVE: run the .exe directly
----------------------------------
myhomegames-server-win-x64.exe opens a console (CMD) window. Use
Start-MyHomeGames-Server.exe above if you prefer no server window and a tray icon.
