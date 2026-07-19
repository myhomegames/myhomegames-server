"use strict";

const DEFAULT_TURN_TTL_SECONDS = 86_400; // 24h — refreshed per stream via ice_server_script
const DEFAULT_TUNNEL_MANAGER_URL = "https://myhomegames-server.vige.it";

/**
 * Tunnel manager (Cloudflare Worker) that holds the long-term TURN key as secrets.
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveTunnelManagerUrl(env = process.env) {
  const fromEnv =
    env.CLOUDFLARE_TUNNEL_MANAGER_URL?.trim() ||
    env.TUNNEL_MANAGER_URL?.trim() ||
    "";
  return (fromEnv || DEFAULT_TUNNEL_MANAGER_URL).replace(/\/$/, "");
}

/**
 * TURN long-term secrets live on the Cloudflare Worker — not in server .env / releases.
 * Local installs always use the tunnel manager unless explicitly disabled.
 * @param {NodeJS.ProcessEnv} [env]
 */
function isCloudflareTurnConfigured(env = process.env) {
  return env.CLOUDFLARE_TURN_ENABLED !== "false";
}

/**
 * Filter browser-blocked TURN URLs (port 53).
 * @param {string[]} urls
 */
function filterBrowserSafeTurnUrls(urls) {
  return (Array.isArray(urls) ? urls : []).filter((url) => {
    const value = String(url || "");
    return value.length > 0 && !/:53(?:\?|$)/.test(value);
  });
}

/**
 * Normalize Cloudflare generate-ice-servers payload to Moonlight Web ice_servers list.
 * @param {unknown} payload
 */
function toMoonlightIceServers(payload) {
  const list = Array.isArray(payload?.iceServers)
    ? payload.iceServers
    : Array.isArray(payload)
      ? payload
      : [];

  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const urls = filterBrowserSafeTurnUrls(
        Array.isArray(entry.urls) ? entry.urls : entry.urls != null ? [entry.urls] : [],
      );
      if (urls.length === 0) return null;
      /** @type {{ urls: string[], username?: string, credential?: string }} */
      const out = { urls };
      if (typeof entry.username === "string" && entry.username) out.username = entry.username;
      if (typeof entry.credential === "string" && entry.credential) out.credential = entry.credential;
      return out;
    })
    .filter(Boolean);
}

/**
 * Fetch short-lived Cloudflare Realtime TURN ICE servers from the tunnel manager Worker.
 * The Worker holds CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN as secrets.
 */
async function generateCloudflareTurnIceServers(env = process.env) {
  if (!isCloudflareTurnConfigured(env)) {
    throw new Error("Cloudflare TURN is disabled (CLOUDFLARE_TURN_ENABLED=false)");
  }

  const ttl = Math.min(
    Number(env.CLOUDFLARE_TURN_TTL_SECONDS || DEFAULT_TURN_TTL_SECONDS) || DEFAULT_TURN_TTL_SECONDS,
    172_800,
  );

  const manager = resolveTunnelManagerUrl(env);
  const response = await fetch(`${manager}/api/turn-ice-servers`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      (payload && typeof payload.detail === "string" && payload.detail) ||
      (payload && typeof payload.error === "string" && payload.error) ||
      text.slice(0, 200);
    throw new Error(`Tunnel manager TURN request failed (${response.status}): ${detail}`);
  }

  const iceServers = toMoonlightIceServers(payload);
  if (iceServers.length === 0) {
    throw new Error("Tunnel manager returned no usable ICE servers");
  }
  return { iceServers, ttl, raw: payload };
}

module.exports = {
  DEFAULT_TURN_TTL_SECONDS,
  DEFAULT_TUNNEL_MANAGER_URL,
  resolveTunnelManagerUrl,
  isCloudflareTurnConfigured,
  filterBrowserSafeTurnUrls,
  toMoonlightIceServers,
  generateCloudflareTurnIceServers,
};
