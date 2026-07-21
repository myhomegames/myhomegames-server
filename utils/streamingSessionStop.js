"use strict";

const { postJson, ensureMoonlightWebAdminCredentials } = require("./moonlightWebCredentials");
const { listMoonlightHosts, hostLooksPaired } = require("./moonlightWebPairing");
const { defaultManagedMoonlightWebUrl } = require("./streaming");
const { killLaunchedGame, resolveGameLaunch } = require("./gameLauncher");

const DEFAULT_SUNSHINE_HOST = "127.0.0.1";
const DEFAULT_SUNSHINE_HTTPS_PORT = 47990;
const DEFAULT_SUNSHINE_USERNAME = "sunshine";
const DEFAULT_SUNSHINE_PASSWORD = "admin";

/** @type {{ pid: number, gameId: number|null, executableName: string, fullCommandPath: string, startedAt: number } | null} */
let activeStreamingLaunch = null;

function rememberStreamingLaunch({
  pid,
  gameId = null,
  executableName = "",
  fullCommandPath = "",
} = {}) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) {
    activeStreamingLaunch = null;
    return null;
  }
  activeStreamingLaunch = {
    pid: n,
    gameId: gameId != null && Number.isFinite(Number(gameId)) ? Number(gameId) : null,
    executableName: String(executableName || ""),
    fullCommandPath: String(fullCommandPath || ""),
    startedAt: Date.now(),
  };
  return { ...activeStreamingLaunch };
}

function getActiveStreamingLaunch() {
  return activeStreamingLaunch ? { ...activeStreamingLaunch } : null;
}

function clearActiveStreamingLaunch() {
  activeStreamingLaunch = null;
}

/**
 * Kill the game process started by the last POST /streaming/launch (best-effort).
 * Uses both the remembered PID and the launch script command line (emulators often
 * outlive the shell PID we get from spawn).
 *
 * @param {{ gameId?: number|string|null, executableName?: string, allGames?: Record<number, object>, metadataPath?: string }} [fallback]
 */
function killActiveStreamingGame(fallback = {}) {
  const session = activeStreamingLaunch ? { ...activeStreamingLaunch } : null;
  let pid = session?.pid || null;
  let gameId = session?.gameId ?? null;
  let executableName = session?.executableName || "";
  const scripts = [];

  const pushScript = (path) => {
    const p = String(path || "").trim();
    if (p && !scripts.includes(p)) scripts.push(p);
  };

  const resolveScript = (id, exe) => {
    if (id == null || !fallback?.metadataPath || !fallback?.allGames) return null;
    try {
      const resolved = resolveGameLaunch(fallback.allGames, fallback.metadataPath, id, exe);
      return resolved.ok ? resolved : null;
    } catch {
      return null;
    }
  };

  // Client gameId wins: this is what Back/Exit intend to stop.
  if (fallback?.gameId != null) {
    const resolved = resolveScript(fallback.gameId, fallback.executableName);
    if (resolved) {
      pushScript(resolved.fullCommandPath);
      executableName = resolved.executableName;
      gameId = Number(fallback.gameId);
    } else {
      gameId = Number(fallback.gameId);
    }
  }
  pushScript(session?.fullCommandPath);

  if (!pid && scripts.length === 0) {
    return { ok: false, reason: "no-active-launch" };
  }

  let result = killLaunchedGame({
    pid,
    fullCommandPath: scripts[0] || "",
  });
  for (const script of scripts.slice(1)) {
    if (result.ok) break;
    const extra = killLaunchedGame({ fullCommandPath: script });
    if (extra.ok) {
      result = { ...result, ...extra, ok: true };
    }
  }

  clearActiveStreamingLaunch();
  console.log(
    `[streaming/stop] local game kill ok=${result.ok} gameId=${gameId} scripts=${JSON.stringify(scripts)} pids=${JSON.stringify(result.byScript?.killedPids || [])}`,
  );
  return {
    ...result,
    gameId,
    executableName,
    fullCommandPath: scripts[0] || session?.fullCommandPath || "",
  };
}

function resolveMoonlightWebPort(env = process.env) {
  const port = Number(env.MOONLIGHT_WEB_PORT || 8080);
  return Number.isFinite(port) && port > 0 ? port : 8080;
}

/**
 * Origin-only Moonlight Web API base (strip /stream.html etc.).
 */
function moonlightApiBaseFromUrl(urlString) {
  const trimmed = String(urlString || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/**
 * Prefer local Moonlight for control APIs on the home PC; fall back to settings URL.
 */
function resolveMoonlightControlBase(settingsMoonlightWebUrl, env = process.env) {
  const managed = defaultManagedMoonlightWebUrl(resolveMoonlightWebPort(env));
  const fromSettings = moonlightApiBaseFromUrl(settingsMoonlightWebUrl);
  return managed || fromSettings;
}

/**
 * Ask Moonlight Web to cancel the active stream / quit the Sunshine app on the host.
 * @see Moonlight Web POST /api/host/cancel
 */
async function cancelMoonlightHostStream({ baseUrl, cookie, hostId } = {}) {
  const normalized = moonlightApiBaseFromUrl(baseUrl);
  if (!normalized) throw new Error("Moonlight Web URL is required");
  if (hostId == null) throw new Error("hostId is required");

  const response = await postJson(
    `${normalized}/api/host/cancel`,
    { host_id: Number(hostId) },
    30_000,
    { headers: cookie ? { Cookie: cookie } : {} },
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Moonlight POST /api/host/cancel failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
    );
  }
  return { ok: true, hostId: Number(hostId) };
}

/**
 * Best-effort Sunshine "close currently running application".
 * @see https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2api.html
 */
async function closeSunshineStreamingApp(env = process.env) {
  const host = String(env.SUNSHINE_HOST || DEFAULT_SUNSHINE_HOST).trim() || DEFAULT_SUNSHINE_HOST;
  const port = Number(env.SUNSHINE_HTTPS_PORT || DEFAULT_SUNSHINE_HTTPS_PORT) || DEFAULT_SUNSHINE_HTTPS_PORT;
  const username =
    (env.SUNSHINE_USERNAME || DEFAULT_SUNSHINE_USERNAME).trim() || DEFAULT_SUNSHINE_USERNAME;
  const password =
    (env.SUNSHINE_PASSWORD || DEFAULT_SUNSHINE_PASSWORD).trim() || DEFAULT_SUNSHINE_PASSWORD;

  const response = await postJson(
    `https://${host}:${port}/api/apps/close`,
    {},
    15_000,
    { auth: { username, password } },
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Sunshine POST /api/apps/close failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
    );
  }
  return { ok: true };
}

/**
 * Stop remote play: cancel Moonlight/Sunshine stream and kill the locally launched game.
 */
async function stopRemoteStreamingSession({
  moonlightWebUrl,
  hostId = null,
  gameId = null,
  executableName = "",
  allGames = null,
  metadataPath = "",
  env = process.env,
} = {}) {
  const controlBase = resolveMoonlightControlBase(moonlightWebUrl, env);
  const results = {
    moonlightCancel: null,
    sunshineClose: null,
    localGame: null,
    hostId: hostId != null ? Number(hostId) : null,
  };

  let cookie = "";
  try {
    const auth = await ensureMoonlightWebAdminCredentials(controlBase, env);
    cookie = auth.cookie || "";
  } catch {
    // default_user_id may allow unauthenticated cancel
  }

  let resolvedHostId = results.hostId;
  if (resolvedHostId == null) {
    try {
      const hosts = await listMoonlightHosts(controlBase, cookie);
      const host = hosts.find((item) => hostLooksPaired(item)) || hosts[0] || null;
      if (host?.host_id != null) {
        resolvedHostId = Number(host.host_id);
        results.hostId = resolvedHostId;
      }
    } catch (error) {
      results.moonlightCancel = {
        ok: false,
        detail: error?.message || String(error),
      };
    }
  }

  if (resolvedHostId != null) {
    try {
      results.moonlightCancel = await cancelMoonlightHostStream({
        baseUrl: controlBase,
        cookie,
        hostId: resolvedHostId,
      });
    } catch (error) {
      results.moonlightCancel = {
        ok: false,
        detail: error?.message || String(error),
      };
    }
  } else if (!results.moonlightCancel) {
    results.moonlightCancel = { ok: false, reason: "no-host" };
  }

  try {
    results.sunshineClose = await closeSunshineStreamingApp(env);
  } catch (error) {
    results.sunshineClose = {
      ok: false,
      detail: error?.message || String(error),
    };
  }

  results.localGame = killActiveStreamingGame({
    gameId,
    executableName,
    allGames,
    metadataPath,
  });

  return results;
}

module.exports = {
  moonlightApiBaseFromUrl,
  resolveMoonlightControlBase,
  cancelMoonlightHostStream,
  closeSunshineStreamingApp,
  stopRemoteStreamingSession,
  rememberStreamingLaunch,
  getActiveStreamingLaunch,
  clearActiveStreamingLaunch,
  killActiveStreamingGame,
};
