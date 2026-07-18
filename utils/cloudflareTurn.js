"use strict";

const DEFAULT_TURN_TTL_SECONDS = 86_400; // 24h — refreshed per stream via ice_server_script

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function isCloudflareTurnConfigured(env = process.env) {
  return Boolean(env.CLOUDFLARE_TURN_KEY_ID?.trim() && env.CLOUDFLARE_TURN_API_TOKEN?.trim());
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
 * Generate short-lived Cloudflare Realtime TURN ICE servers for Moonlight Web.
 * @see https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */
async function generateCloudflareTurnIceServers(env = process.env) {
  const keyId = env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN are required for Cloudflare TURN",
    );
  }

  const ttl = Math.min(
    Number(env.CLOUDFLARE_TURN_TTL_SECONDS || DEFAULT_TURN_TTL_SECONDS) || DEFAULT_TURN_TTL_SECONDS,
    172_800,
  );

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    },
  );

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      `Cloudflare TURN credential request failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const iceServers = toMoonlightIceServers(payload);
  if (iceServers.length === 0) {
    throw new Error("Cloudflare TURN returned no usable ICE servers");
  }
  return { iceServers, ttl, raw: payload };
}

module.exports = {
  DEFAULT_TURN_TTL_SECONDS,
  isCloudflareTurnConfigured,
  filterBrowserSafeTurnUrls,
  toMoonlightIceServers,
  generateCloudflareTurnIceServers,
};
