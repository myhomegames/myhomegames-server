#!/usr/bin/env node
/**
 * Build only the Windows server executable (pkg) and zip: exe + .env + server-info.json
 * Does not include the tray launcher zip (stub EXE + PS1).
 */
const { runPkgWindowsOnly, packageWindowsExeZip } = require("./windows-release-assets");

console.log("Building Windows server executable (pkg win-x64)…\n");
try {
  runPkgWindowsOnly();
  packageWindowsExeZip();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
