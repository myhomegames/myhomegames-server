"use strict";

const https = require("https");
const http = require("http");
const { isCloudflareTunnelEnabled } = require("./cloudflareTunnel");
const { moonlightWebPublicUrlFromApiBase } = require("./tunnelHostname");

const DEFAULT_SUNSHINE_HOST = "127.0.0.1";
const DEFAULT_SUNSHINE_HTTPS_PORT = 47990;
const DEFAULT_SUNSHINE_HTTP_PORT = 47989;
const DEFAULT_MOONLIGHT_WEB_PORT = 8080;

function normalizeMoonlightWebUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function defaultManagedMoonlightWebUrl(port = DEFAULT_MOONLIGHT_WEB_PORT) {
  const safePort = Number(port) > 0 ? Number(port) : DEFAULT_MOONLIGHT_WEB_PORT;
  return `http://127.0.0.1:${safePort}`;
}

/**
 * Map API_BASE to the Moonlight Web base URL for settings.json.
 * Per-user tunnel API host → public Moonlight host; otherwise managed local Moonlight.
 */
function resolveMoonlightWebUrlFromApiBase(apiBase, env = process.env) {
  const publicMoonlight = moonlightWebPublicUrlFromApiBase(String(apiBase || "").trim());
  if (publicMoonlight) {
    return normalizeMoonlightWebUrl(publicMoonlight);
  }
  const moonlightPort = Number(env.MOONLIGHT_WEB_PORT || DEFAULT_MOONLIGHT_WEB_PORT);
  return defaultManagedMoonlightWebUrl(moonlightPort);
}

/** When Cloudflare Tunnel is off, settings.moonlightWebUrl follows API_BASE (local dev / tests). */
function shouldSyncMoonlightWebUrlFromApiBase(env = process.env) {
  return !isCloudflareTunnelEnabled(env);
}

/**
 * @returns {boolean} true if settings were written
 */
function syncMoonlightWebUrlFromApiBase({
  readSettings,
  writeSettings,
  apiBase,
  env = process.env,
  hostId = undefined,
} = {}) {
  if (!shouldSyncMoonlightWebUrlFromApiBase(env)) {
    return false;
  }
  if (typeof readSettings !== "function" || typeof writeSettings !== "function") {
    return false;
  }
  const resolvedApiBase = String(apiBase ?? env.API_BASE ?? "").trim();
  const nextUrl = resolveMoonlightWebUrlFromApiBase(resolvedApiBase, env);
  if (!nextUrl) return false;

  const settings = readSettings() || {};
  const next = {
    ...settings,
    moonlightWebUrl: nextUrl,
    remoteStreamingEnabled: true,
  };
  if (hostId !== undefined) {
    if (hostId != null && Number.isFinite(Number(hostId))) {
      next.moonlightDesktopHostId = Number(hostId);
      next.moonlightDesktopAppId = null;
    }
  }
  const changed =
    next.moonlightWebUrl !== settings.moonlightWebUrl ||
    next.remoteStreamingEnabled !== settings.remoteStreamingEnabled ||
    (hostId !== undefined &&
      (next.moonlightDesktopHostId !== settings.moonlightDesktopHostId ||
        next.moonlightDesktopAppId !== settings.moonlightDesktopAppId));
  if (!changed) return false;

  writeSettings(next);
  console.log(`Moonlight Web URL synced from API_BASE (${nextUrl})`);
  return true;
}

function readStreamingSettings(settings) {
  const fromEnv = normalizeMoonlightWebUrl(process.env.MOONLIGHT_WEB_URL || "");
  const fromSettings = normalizeMoonlightWebUrl(settings?.moonlightWebUrl || "");
  // Default URL so remote streaming can be on before the user fills settings.
  const moonlightWebUrl =
    fromSettings || fromEnv || defaultManagedMoonlightWebUrl();
  // Default on unless explicitly disabled in settings.
  const flagEnabled = settings?.remoteStreamingEnabled !== false;
  const remoteStreamingEnabled = flagEnabled && moonlightWebUrl.length > 0;

  const sunshineHost = String(process.env.SUNSHINE_HOST || DEFAULT_SUNSHINE_HOST).trim() || DEFAULT_SUNSHINE_HOST;
  const sunshineHttpsPort = Number(process.env.SUNSHINE_HTTPS_PORT || DEFAULT_SUNSHINE_HTTPS_PORT);
  const sunshineHttpPort = Number(process.env.SUNSHINE_HTTP_PORT || DEFAULT_SUNSHINE_HTTP_PORT);

  return {
    remoteStreamingEnabled,
    moonlightWebUrl,
    moonlightDesktopHostId:
      settings?.moonlightDesktopHostId != null ? Number(settings.moonlightDesktopHostId) : null,
    moonlightDesktopAppId:
      settings?.moonlightDesktopAppId != null ? Number(settings.moonlightDesktopAppId) : null,
    sunshineHost,
    sunshineHttpsPort,
    sunshineHttpPort,
  };
}

function probeHttpEndpoint({ protocol, host, port, path: reqPath, timeoutMs = 3000 }) {
  return new Promise((resolve) => {
    const lib = protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: host,
        port,
        path: reqPath,
        method: "GET",
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function probeSunshineReachable(streamingSettings) {
  const { sunshineHost, sunshineHttpsPort, sunshineHttpPort } = streamingSettings;
  const httpsOk = await probeHttpEndpoint({
    protocol: "https:",
    host: sunshineHost,
    port: sunshineHttpsPort,
    path: "/serverinfo",
  });
  if (httpsOk) return true;
  return probeHttpEndpoint({
    protocol: "http:",
    host: sunshineHost,
    port: sunshineHttpPort,
    path: "/serverinfo",
  });
}

async function probeMoonlightWebReachable(urlOrSettings) {
  const raw =
    typeof urlOrSettings === "string"
      ? urlOrSettings
      : urlOrSettings?.moonlightWebUrl || defaultManagedMoonlightWebUrl();
  const normalized = normalizeMoonlightWebUrl(raw);
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return probeHttpEndpoint({
      protocol: url.protocol,
      host: url.hostname,
      port,
      path: url.pathname && url.pathname !== "/" ? url.pathname : "/",
    });
  } catch {
    return false;
  }
}

function validateStreamingSettingsPatch(patch) {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, "remoteStreamingEnabled")) {
    next.remoteStreamingEnabled = patch.remoteStreamingEnabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "moonlightWebUrl")) {
    const normalized = normalizeMoonlightWebUrl(patch.moonlightWebUrl);
    if (String(patch.moonlightWebUrl || "").trim() && !normalized) {
      return { ok: false, error: "moonlightWebUrl must be a valid http(s) URL" };
    }
    next.moonlightWebUrl = normalized;
  }
  return { ok: true, value: next };
}

module.exports = {
  readStreamingSettings,
  probeSunshineReachable,
  probeMoonlightWebReachable,
  normalizeMoonlightWebUrl,
  validateStreamingSettingsPatch,
  defaultManagedMoonlightWebUrl,
  resolveMoonlightWebUrlFromApiBase,
  shouldSyncMoonlightWebUrlFromApiBase,
  syncMoonlightWebUrlFromApiBase,
  DEFAULT_MOONLIGHT_WEB_PORT,
};
