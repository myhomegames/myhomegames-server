#!/usr/bin/env node
/**
 * Single Windows .exe: embeds server (pkg) + tray PS1 + config; extracts to AppData on first run.
 * Requires Go 1.21+ on PATH. Runs pkg if build/ has no Windows server exe yet.
 */
const { findWinExe, runPkgWindowsOnly, buildWindowsUnifiedExe } = require("./windows-release-assets");

console.log("Building MyHomeGames-*-win-x64-unified.exe (single file)…\n");
try {
  if (!findWinExe()) {
    console.log("No server .exe in build/ — running pkg (node18-win-x64)…\n");
    runPkgWindowsOnly();
  }
  buildWindowsUnifiedExe();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
