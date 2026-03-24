MyHomeGames Server — Windows
==============================

DISTRIBUTION
------------
**Release build:** MyHomeGames-*-win-x64.zip — contains the installer executable.
Unzip anywhere, then run the .exe inside. On first run it unpacks the server, scripts
and config under:

  %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version>\\

and starts the tray.

QUICK START
-----------
Unzip the archive, then double-click:

  MyHomeGames-*-win-x64.exe

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

The server reads .env in the extracted runtime folder. Default HTTPS URL is
https://localhost:41440

WINDOWS SECURITY / SMARTSCREEN / DEFENDER
------------------------------------------
The unified launcher and server .exe are not code-signed. Windows may show:

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
If something fails, the runtime folder may contain:

  MyHomeGames-Server-Tray-errors.log

It is **appended** on each error (timestamped blocks). Open it in Notepad to copy the
full text for support. The error dialog also shows this path when applicable.

TROUBLESHOOTING
---------------
"Already running" but no tray icon — a stale lock file can remain after a crash. Delete:

  %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version>\\.tray-instance.lock

then start again.

"Could not start the tray launcher" / exit code 1 — if the log says **server
executable not found**, the runtime folder may be incomplete. Delete the runtime folder
for that version under `%LOCALAPPDATA%\\MyHomeGames\\server-runtime\\` and run the
unified .exe again, or re-download the release from the official source.

MyHomeGames-Tray.png (when present) is the same icon as the macOS app — it is embedded
in the unified .exe when available.

ALTERNATIVE: run the packaged server .exe directly
----------------------------------------------------
After extraction, `myhomegames-server-win-x64.exe` (name may vary) in the runtime folder
opens a console (CMD) window. Prefer the unified .exe above for no server window and a tray icon.
