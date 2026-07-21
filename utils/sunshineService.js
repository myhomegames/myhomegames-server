"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  ensureSunshineBinary,
  findSunshineExecutable,
  resolveMacAppBundle,
  resolveSunshineInstallDir,
} = require("./sunshineBinary");
const { ensureSunshineWebCredentials } = require("./sunshineCredentials");
const { probeSunshineReachable, readStreamingSettings } = require("./streaming");

/** @type {import('child_process').ChildProcess | null} */
let managedSunshineChild = null;
/** @type {string | null} */
let managedSunshineExecutable = null;
/** True when this server process started Sunshine (or adopted our install). */
let manageSunshineLifecycle = false;

function isSunshineEnabled(env = process.env) {
  return env.SUNSHINE_ENABLED !== "false";
}

function buildSunshineArgs(executable, env = process.env) {
  const extra = env.SUNSHINE_ARGS?.trim();
  if (extra) {
    return extra.split(/\s+/).filter(Boolean);
  }

  if (process.platform === "linux" && executable.endsWith(".AppImage")) {
    return [];
  }

  return [];
}

function spawnSunshine(executable, env = process.env) {
  const args = buildSunshineArgs(executable, env);
  const cwd = path.dirname(executable);
  const child = spawn(executable, args, {
    cwd: fs.existsSync(cwd) ? cwd : undefined,
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, ...env },
  });

  child.on("error", (error) => {
    console.error("Sunshine process error:", error.message || error);
  });

  if (process.platform !== "win32") {
    child.unref();
  }
  return child;
}

function resolveDarwinAppBundle(executable) {
  return (
    resolveMacAppBundle(executable) ||
    (executable.endsWith(".app") ? executable : null) ||
    (executable.includes("/Contents/MacOS/") ? executable.split("/Contents/MacOS/")[0] : null)
  );
}

function startSunshineProcess(executable, env = process.env) {
  // On macOS, launch via `open -a` so TCC Accessibility/Input Monitoring attach to
  // Sunshine.app. Spawning Contents/MacOS/Sunshine directly breaks mouse/keyboard
  // injection even when Accessibility is granted. Do not re-sign on every start —
  // `codesign --force` invalidates prior privacy grants (signing happens at install).
  if (process.platform === "darwin") {
    const appBundle = resolveDarwinAppBundle(executable);
    if (appBundle && fs.existsSync(appBundle)) {
      try {
        execFileSync("open", ["-na", appBundle], { stdio: "ignore" });
        managedSunshineChild = null;
        return { mode: "open", child: null };
      } catch (error) {
        console.warn(
          `open -a Sunshine failed (${error.message || error}); falling back to spawn`,
        );
      }
    }
  }

  managedSunshineChild = spawnSunshine(executable, env);
  return { mode: "spawn", child: managedSunshineChild };
}

async function waitForSunshine(streamingSettings, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probeSunshineReachable(streamingSettings)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // ignore
  }
}

function killSunshineByPath(executable) {
  if (!executable) return;

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/IM", "sunshine.exe", "/F", "/T"], { stdio: "ignore" });
    } catch {
      // ignore — process may already be gone
    }
    return;
  }

  const patterns = new Set([executable]);
  const appBundle = resolveMacAppBundle(executable);
  if (appBundle) {
    patterns.add(appBundle);
    patterns.add(path.join(appBundle, "Contents", "MacOS", "Sunshine"));
    patterns.add(path.join(appBundle, "Contents", "MacOS", "sunshine"));
  }

  for (const pattern of patterns) {
    try {
      execFileSync("pkill", ["-TERM", "-f", pattern], { stdio: "ignore" });
    } catch {
      // pkill exits 1 when no process matched
    }
  }

  // Give processes a moment, then force-kill leftovers matching our install.
  if (appBundle) {
    try {
      execFileSync("pkill", ["-KILL", "-f", appBundle], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }
}

/**
 * Download (if needed) and start Sunshine when the MyHomeGames server boots.
 */
async function ensureSunshineRunning({ metadataPath, readSettings, env = process.env } = {}) {
  if (!isSunshineEnabled(env)) {
    return { started: false, reason: "disabled" };
  }

  const settings = typeof readSettings === "function" ? readSettings() : {};
  const streaming = readStreamingSettings(settings);
  const installDir = resolveSunshineInstallDir(metadataPath);

  if (await probeSunshineReachable(streaming)) {
    managedSunshineExecutable = findSunshineExecutable(installDir);
    manageSunshineLifecycle = true;
    console.log("Sunshine is already running.");
    return { started: false, reason: "already-running", streaming };
  }

  const { executable, version } = await ensureSunshineBinary({ metadataPath, env });
  managedSunshineExecutable = executable;
  manageSunshineLifecycle = true;

  try {
    ensureSunshineWebCredentials(executable, env);
  } catch (error) {
    console.warn(`Could not bootstrap Sunshine credentials: ${error.message || error}`);
  }

  console.log(`Starting Sunshine (${version || "unknown"})...`);
  startSunshineProcess(executable, env);

  const ready = await waitForSunshine(streaming);
  if (ready) {
    console.log("Sunshine is ready for Moonlight clients.");
    return { started: true, executable, streaming, ready: true };
  }

  console.warn(
    "Sunshine was started but is not responding yet. Open https://localhost:47990 (default login: sunshine / admin) if needed.",
  );
  return { started: true, executable, streaming, ready: false };
}

function stopManagedSunshine() {
  if (!manageSunshineLifecycle && !managedSunshineChild) {
    managedSunshineChild = null;
    managedSunshineExecutable = null;
    return;
  }

  console.log("Stopping Sunshine...");

  if (managedSunshineChild && !managedSunshineChild.killed) {
    killProcessTree(managedSunshineChild.pid);
  }
  managedSunshineChild = null;

  killSunshineByPath(managedSunshineExecutable);

  manageSunshineLifecycle = false;
  managedSunshineExecutable = null;
}

module.exports = {
  isSunshineEnabled,
  ensureSunshineRunning,
  stopManagedSunshine,
};
