const fs = require("fs");
const os = require("os");
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
 * First non-empty, non-comment line of a launch script (typical MHG one-liner).
 */
function readLaunchScriptCommandLine(scriptPath) {
  const raw = fs.readFileSync(scriptPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

/**
 * Absolute paths embedded in a launch command (ROM, conf, iso, exe, …).
 * Longer / more specific paths are preferred for pkill matching.
 */
function extractLaunchCommandPaths(commandLine) {
  if (!commandLine) return [];
  const paths = [];
  const re = /(?:^|[\s=])("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\/|~\/|[A-Za-z]:\\)[^\s"']+)/g;
  let match;
  while ((match = re.exec(commandLine)) !== null) {
    let token = match[1];
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    token = token.replace(/\\(.)/g, "$1").trim();
    if (!token) continue;
    if (token.startsWith("~/")) {
      token = path.join(os.homedir(), token.slice(2));
    }
    // Keep only absolute filesystem paths (skip quoted flags like "dosbox quit warning=false").
    if (!(token.startsWith("/") || /^[A-Za-z]:[\\/]/.test(token))) continue;
    paths.push(token);
  }
  // Prefer longer paths (e.g. rom/conf over /Applications/.../dosbox-x).
  return [...new Set(paths)].sort((a, b) => b.length - a.length);
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGenericLaunchBinaryPath(p) {
  const normalized = String(p || "").replace(/\\/g, "/");
  if (/\/(env|sh|bash|zsh|dash|cmd\.exe|powershell\.exe|pwsh\.exe)$/i.test(normalized)) {
    return true;
  }
  if (/^\/(usr\/)?bin\/(env|sh|bash|zsh|dash)$/i.test(normalized)) {
    return true;
  }
  return false;
}

function scoreLaunchMatcher(p) {
  let s = p.length;
  // Prefer ROM/config/content paths over emulator binaries in /Applications.
  if (!/\/(Applications|usr|bin|sbin|opt\/homebrew|System)\//i.test(p)) s += 1000;
  if (!/Contents\/MacOS\//i.test(p)) s += 200;
  if (
    /\.(conf|iso|cue|chd|zip|7z|rar|rvz|wua|wud|wux|nsp|xci|n64|z64|gba|gbc|gb|nes|smc|sfc|nds|3ds|cia|pbp|cso|vpk|wad|wbfs|gcm|tgc|dol|elf|exe|bat|cmd|dsk|adf|ipf|fsb|toc|mds|mdf|nrg|ccd|img|bin|rom)(\b|$)/i.test(
      p,
    )
  ) {
    s += 500;
  }
  return s;
}

/**
 * Kill processes that still match the launch script command line.
 * Needed because detached shell PIDs often exit (or leave the process group)
 * while the real emulator/game keeps running.
 *
 * Uses pgrep + SIGKILL (not only pkill -TERM): GUI emulators on macOS often
 * ignore a soft TERM, and pkill can report success after matching unrelated
 * shells that merely echo the same path in their argv.
 */
function killProcessesMatchingLaunchScript(scriptPath) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return { ok: false, reason: "missing-script" };
  }

  const commandLine = readLaunchScriptCommandLine(scriptPath);
  if (!commandLine) {
    return { ok: false, reason: "empty-script" };
  }

  const matchers = extractLaunchCommandPaths(commandLine)
    .filter((p) => p.length >= 12)
    .filter((p) => !isGenericLaunchBinaryPath(p))
    .sort((a, b) => scoreLaunchMatcher(b) - scoreLaunchMatcher(a));
  if (matchers.length === 0) {
    const fallback = extractLaunchCommandPaths(commandLine)
      .filter((p) => p.length >= 16)
      .filter((p) => !isGenericLaunchBinaryPath(p))
      .sort((a, b) => scoreLaunchMatcher(b) - scoreLaunchMatcher(a));
    matchers.push(...fallback.slice(0, 1));
  }
  if (matchers.length === 0) {
    const compact = commandLine.replace(/\s+/g, " ").trim().slice(0, 180);
    if (compact.length >= 12) matchers.push(compact);
  }
  if (matchers.length === 0) {
    return { ok: false, reason: "no-matcher" };
  }

  const tryMatchers =
    matchers.length > 1 && scoreLaunchMatcher(matchers[0]) >= 1000
      ? matchers.slice(0, 1)
      : matchers.slice(0, 2);

  if (process.platform === "win32") {
    const matched = [];
    const errors = [];
    for (const matcher of tryMatchers) {
      try {
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${JSON.stringify(matcher)}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
          ],
          { stdio: "ignore", timeout: 15_000 },
        );
        matched.push(matcher);
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
    return {
      ok: matched.length > 0,
      matched,
      ...(errors.length ? { detail: errors.join("; ") } : {}),
    };
  }

  const selfPid = process.pid;
  const selfPpid = typeof process.ppid === "number" ? process.ppid : null;
  const killedPids = new Set();
  const matched = [];
  const errors = [];

  for (const matcher of tryMatchers) {
    const pattern = escapeRegexLiteral(matcher);
    let pids = [];
    try {
      const out = execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim();
      pids = out
        .split(/\s+/)
        .map((p) => Number(p))
        .filter((p) => Number.isFinite(p) && p > 0);
    } catch (error) {
      if (error?.status !== 1) {
        errors.push(error?.message || String(error));
      }
      continue;
    }

    let killedForMatcher = false;
    for (const pid of pids) {
      if (pid === selfPid || pid === selfPpid) continue;
      // Avoid killing login shells / Cursor wrappers that only mention the path in a huge -c script.
      let cmd = "";
      try {
        cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
          encoding: "utf8",
        }).trim();
      } catch {
        continue;
      }
      if (!cmd.includes(matcher)) continue;
      // Prefer real game/emulator processes over interactive shells embedding the path.
      if (/\b(zsh|bash|sh|fish|nu)\b/i.test(cmd) && /\s-c\s/.test(cmd) && cmd.length > 500) {
        continue;
      }
      try {
        process.kill(pid, "SIGKILL");
        killedPids.add(pid);
        killedForMatcher = true;
      } catch (error) {
        if (error?.code !== "ESRCH") {
          errors.push(`pid ${pid}: ${error?.message || error}`);
        }
      }
    }
    if (killedForMatcher) matched.push(matcher);
  }

  return {
    ok: killedPids.size > 0,
    matched,
    killedPids: [...killedPids],
    ...(errors.length ? { detail: errors.join("; ") } : {}),
  };
}

/**
 * Kill by remembered PID (process group) and by launch-script command match.
 */
function killLaunchedGame({ pid, fullCommandPath } = {}) {
  const byPid = pid ? killProcessTree(pid) : { ok: false, reason: "no-pid" };
  const byScript = fullCommandPath
    ? killProcessesMatchingLaunchScript(fullCommandPath)
    : { ok: false, reason: "no-script" };
  return {
    ok: Boolean(byPid.ok || byScript.ok),
    byPid,
    byScript,
  };
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
  return {
    ...result,
    executableName: resolved.executableName,
    gameId: Number(gameId),
    fullCommandPath: resolved.fullCommandPath,
  };
}

module.exports = {
  launchGame,
  resolveGameLaunch,
  resolveExecutableScriptPath,
  sanitizeExecutableName,
  killProcessTree,
  killProcessesMatchingLaunchScript,
  killLaunchedGame,
  readLaunchScriptCommandLine,
  extractLaunchCommandPaths,
};
