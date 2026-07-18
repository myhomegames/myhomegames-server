"use strict";

const https = require("https");
const http = require("http");

const DEFAULT_SUNSHINE_HOST = "127.0.0.1";
const DEFAULT_SUNSHINE_HTTPS_PORT = 47990;
const DEFAULT_SUNSHINE_HTTP_PORT = 47989;

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

function readStreamingSettings(settings) {
  const fromEnv = normalizeMoonlightWebUrl(process.env.MOONLIGHT_WEB_URL || "");
  const fromSettings = normalizeMoonlightWebUrl(settings?.moonlightWebUrl || "");
  const moonlightWebUrl = fromSettings || fromEnv;
  const remoteStreamingEnabled =
    settings?.remoteStreamingEnabled === true && moonlightWebUrl.length > 0;

  const sunshineHost = String(process.env.SUNSHINE_HOST || DEFAULT_SUNSHINE_HOST).trim() || DEFAULT_SUNSHINE_HOST;
  const sunshineHttpsPort = Number(process.env.SUNSHINE_HTTPS_PORT || DEFAULT_SUNSHINE_HTTPS_PORT);
  const sunshineHttpPort = Number(process.env.SUNSHINE_HTTP_PORT || DEFAULT_SUNSHINE_HTTP_PORT);

  return {
    remoteStreamingEnabled,
    moonlightWebUrl,
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
  normalizeMoonlightWebUrl,
  validateStreamingSettingsPatch,
};
