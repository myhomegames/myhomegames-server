const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

function sanitizeExecutableName(name) {
  if (!name || typeof name !== "string") return "";
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function matchScriptLabel(base, label) {
  if (base === label) return true;
  const m = base.match(/^\d+-(.+)$/);
  if (!m) return false;
  const rest = m[1];
  return rest === label || rest.startsWith(`${label}-`);
}

function resolveExecutableScriptPath(metadataPath, gameId, executableName) {
  const sanitizedExecutableName = sanitizeExecutableName(executableName);
  const scriptsDir = path.join(metadataPath, "content", "games", String(gameId), "scripts");
  let fullCommandPath = path.join(scriptsDir, `${sanitizedExecutableName}.sh`);
  if (!fs.existsSync(fullCommandPath)) {
    fullCommandPath = path.join(scriptsDir, `${sanitizedExecutableName}.bat`);
  }
  if (!fs.existsSync(fullCommandPath) && fs.existsSync(scriptsDir)) {
    const files = fs.readdirSync(scriptsDir);
    const match = files.find((f) => {
      const ext = path.extname(f).toLowerCase();
      if (ext !== ".sh" && ext !== ".bat") return false;
      const base = path.basename(f, ext);
      return matchScriptLabel(base, sanitizedExecutableName);
    });
    if (match) fullCommandPath = path.join(scriptsDir, match);
  }
  return { fullCommandPath, scriptsDir };
}

/**
 * Resolve launch target for a game from in-memory catalog + metadata scripts dir.
 *
 * @returns {{ ok: true, executableName: string, fullCommandPath: string } | { ok: false, status: number, error: string, detail?: string }}
 */
function resolveGameLaunch(allGames, metadataPath, gameId, requestedExecutableName) {
  const entry = allGames[Number(gameId)];
  if (!entry) {
    return { ok: false, status: 404, error: "Game not found" };
  }

  const executables = entry.executables;
  if (!executables || !Array.isArray(executables) || executables.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Launch failed",
      detail: "No executables configured. Please check the game configuration.",
    };
  }

  let executableName;
  if (requestedExecutableName && typeof requestedExecutableName === "string" && requestedExecutableName.trim()) {
    const trimmed = requestedExecutableName.trim();
    if (!executables.includes(trimmed)) {
      return {
        ok: false,
        status: 400,
        error: "Launch failed",
        detail: `Executable "${trimmed}" not found in game configuration.`,
      };
    }
    executableName = trimmed;
  } else {
    executableName = executables[0];
  }

  if (!executableName || typeof executableName !== "string" || executableName.trim() === "") {
    return {
      ok: false,
      status: 400,
      error: "Launch failed",
      detail: "Invalid executable name. Please check the game configuration.",
    };
  }

  const { fullCommandPath } = resolveExecutableScriptPath(metadataPath, gameId, executableName);
  if (!fs.existsSync(fullCommandPath)) {
    return {
      ok: false,
      status: 404,
      error: "Launch failed",
      detail: `Script file not found: ${fullCommandPath}. Please upload the executable file first.`,
    };
  }

  return { ok: true, executableName, fullCommandPath };
}

/**
 * Spawn the resolved game script detached on the host.
 *
 * @returns {Promise<{ status: "launched", pid: number }>}
 */
function spawnGameLaunch(fullCommandPath) {
  return new Promise((resolve, reject) => {
    const quotedPath = fullCommandPath.includes(" ") ? `"${fullCommandPath}"` : fullCommandPath;
    const child = spawn(quotedPath, {
      shell: true,
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (err) => {
      const errorMessage =
        err.code === "ENOENT"
          ? `Executable not found: ${fullCommandPath}. Please check if the executable exists.`
          : err.message;
      reject(new Error(errorMessage));
    });

    child.once("spawn", () => {
      child.unref();
      resolve({ status: "launched", pid: child.pid });
    });
  });
}

/**
 * Kill a process and its descendants (best-effort).
 * On Unix, prefers the process group when the child was spawned detached.
 */
function killProcessTree(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "invalid-pid" };

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(n), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-n, "SIGTERM");
      } catch {
        process.kill(n, "SIGTERM");
      }
      try {
        setTimeout(() => {
          try {
            process.kill(-n, "SIGKILL");
          } catch {
            try {
              process.kill(n, "SIGKILL");
            } catch {
              // already gone
            }
          }
        }, 1500).unref?.();
      } catch {
        // ignore
      }
    }
    return { ok: true, pid: n };
  } catch (error) {
    return { ok: false, pid: n, detail: error?.message || String(error) };
  }
}

/**
 * @param {Record<number, object>} allGames
 * @param {string} metadataPath
 * @param {string|number} gameId
 * @param {string} [requestedExecutableName]
 */
async function launchGame(allGames, metadataPath, gameId, requestedExecutableName) {
  const resolved = resolveGameLaunch(allGames, metadataPath, gameId, requestedExecutableName);
  if (!resolved.ok) {
    const err = new Error(resolved.detail || resolved.error);
    err.status = resolved.status;
    err.payload = { error: resolved.error, detail: resolved.detail };
    throw err;
  }
  const result = await spawnGameLaunch(resolved.fullCommandPath);
  return { ...result, executableName: resolved.executableName, gameId: Number(gameId) };
}

module.exports = {
  launchGame,
  resolveGameLaunch,
  resolveExecutableScriptPath,
  sanitizeExecutableName,
  killProcessTree,
};
