"use strict";

const { resolveMoonlightWebApiCookie } = require("./moonlightWebCredentials");
const {
  ensureMoonlightWebSunshinePairing,
  listMoonlightHosts,
  hostLooksPaired,
} = require("./moonlightWebPairing");
const {
  resolveMoonlightDesktopStreamUrl,
  buildMoonlightDesktopStreamUrl,
  listMoonlightApps,
  pickDesktopApp,
} = require("./moonlightWebEmbed");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure Sunshine is paired in Moonlight Web and resolve the Desktop stream URL.
 * Retries while Sunshine is still starting; falls back to cached host/app ids.
 */
async function ensureMoonlightDesktopStreamReady({
  baseUrl,
  kind = null,
  env = process.env,
  lanIp = null,
  cachedHostId = null,
  cachedAppId = null,
  maxAttempts = 4,
  skipPairing = false,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");

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
        hosts.find((item) => hostLooksPaired(item)) ||
        hosts[0] ||
        null;
      if (host?.host_id != null) {
        return await resolveMoonlightDesktopStreamUrl({
          baseUrl: normalized,
          cookie: apiCookie,
          hostId: host.host_id,
        });
      }
      lastError = new Error("No Moonlight host available for Desktop stream");
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) {
      await sleep(400 * attempt);
    }
  }

  const hostId = cachedHostId != null ? Number(cachedHostId) : null;
  const appId = cachedAppId != null ? Number(cachedAppId) : null;
  if (Number.isFinite(hostId) && Number.isFinite(appId)) {
    try {
      const apps = await listMoonlightApps(normalized, apiCookie, hostId);
      const desktop = pickDesktopApp(apps);
      if (desktop?.app_id != null) {
        return {
          url: buildMoonlightDesktopStreamUrl(normalized, hostId, desktop.app_id),
          hostId,
          appId: Number(desktop.app_id),
          appTitle: desktop.title || "Desktop",
        };
      }
    } catch {
      // use cached app id below
    }
    return {
      url: buildMoonlightDesktopStreamUrl(normalized, hostId, appId),
      hostId,
      appId,
      appTitle: "Desktop",
    };
  }

  throw lastError || new Error("Moonlight Desktop stream URL could not be resolved");
}

module.exports = {
  ensureMoonlightDesktopStreamReady,
};
