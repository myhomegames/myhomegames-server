#!/usr/bin/env node
/**
 * Full Windows desktop zip: pkg (Node server .exe) + Go tray stub + PS1 + README + config.
 * Self-contained — users need only MyHomeGames-*-win-x64-tray.zip.
 * Requires Go 1.21+ on PATH for the small Start-MyHomeGames-Server.exe.
 */
const { findWinExe, runPkgWindowsOnly, packageWindowsTrayZip } = require("./windows-release-assets");

console.log("Packaging Windows tray zip (standalone: server exe + launcher)…\n");
try {
  if (!findWinExe()) {
    console.log("No server .exe in build/ — running pkg (node18-win-x64)…\n");
    runPkgWindowsOnly();
  }
  packageWindowsTrayZip();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
