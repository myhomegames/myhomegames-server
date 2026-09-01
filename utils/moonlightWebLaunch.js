"use strict";

const { resolveMoonlightWebApiCookie } = require("./moonlightWebCredentials");
const {
  ensureMoonlightWebSunshinePairing,
  listMoonlightHosts,
  hostLooksPaired,
} = require("./moonlightWebPairing");
const {
  resolveMoonlightAppStreamUrl,
  buildMoonlightAppStreamUrl,
  listMoonlightApps,
  pickMoonlightApp,
} = require("./moonlightWebEmbed");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure Sunshine is paired in Moonlight Web and resolve the application stream URL.
 * Never falls back to Desktop — MyHomeGames streams a single Sunshine app per game.
 */
async function ensureMoonlightAppStreamReady({
  baseUrl,
  kind = null,
  env = process.env,
  lanIp = null,
  cachedHostId = null,
  appTitle,
  appId = null,
  maxAttempts = 4,
  skipPairing = false,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");
  if (!String(appTitle || "").trim() && appId == null) {
    throw new Error("Moonlight app title or appId is required");
  }

  const effectiveKind = kind === "docker" ? "docker" : null;
  const apiCookie = resolveMoonlightWebApiCookie({
    kind: effectiveKind,
    sessionCookie: "",
  });

  if (!skipPairing) {
    await ensureMoonlightWebSunshinePairing({
      baseUrl: normalized,
      cookie: apiCookie,
      kind: effectiveKind,
      env,
      lanIp,
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const hosts = await listMoonlightHosts(normalized, apiCookie);
      const host =
        (cachedHostId != null
          ? hosts.find((item) => Number(item.host_id) === Number(cachedHostId))
          : null) ||
        hosts.find((item) => hostLooksPaired(item)) ||
        hosts[0] ||
        null;
      if (host?.host_id != null) {
        return await resolveMoonlightAppStreamUrl({
          baseUrl: normalized,
          cookie: apiCookie,
          hostId: host.host_id,
          appTitle,
          appId,
        });
      }
      lastError = new Error("No Moonlight host available for application stream");
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) {
      await sleep(400 * attempt);
    }
  }

  const hostId = cachedHostId != null ? Number(cachedHostId) : null;
  const resolvedAppId = appId != null ? Number(appId) : null;
  if (Number.isFinite(hostId) && Number.isFinite(resolvedAppId) && resolvedAppId > 0) {
    try {
      const apps = await listMoonlightApps(normalized, apiCookie, hostId);
      const app = pickMoonlightApp(apps, { appTitle, appId: resolvedAppId });
      if (app?.app_id != null && Number(app.app_id) !== 0) {
        return {
          url: buildMoonlightAppStreamUrl(normalized, hostId, app.app_id),
          hostId,
          appId: Number(app.app_id),
          appTitle: app.title || appTitle || "Game",
        };
      }
    } catch {
      // fall through
    }
  }

  throw lastError || new Error("Moonlight application stream URL could not be resolved");
}

module.exports = {
  ensureMoonlightAppStreamReady,
};
