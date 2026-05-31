"use strict";

const IGDB_CREDENTIALS_ERROR =
  "IGDB API credentials are not available. Configure them on the API gateway (e.g. Cloudflare Worker).";

/**
 * Resolve Twitch app credentials for IGDB (client_credentials).
 * Only X-Twitch-Client-* headers (injected by the API gateway Worker).
 */
function resolveTwitchAppCredentials(req) {
  const clientId = String(req.header("X-Twitch-Client-Id") || "").trim();
  const clientSecret = String(req.header("X-Twitch-Client-Secret") || "").trim();
  return { clientId, clientSecret };
}

/**
 * @returns {{ clientId: string, clientSecret: string } | null} null if response already sent (400)
 */
function requireTwitchAppCredentials(req, res, options = {}) {
  const { contentType = "application/json" } = options;
  const creds = resolveTwitchAppCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    res.setHeader("Content-Type", contentType);
    res.status(400).json({ error: IGDB_CREDENTIALS_ERROR });
    return null;
  }
  return creds;
}

module.exports = {
  IGDB_CREDENTIALS_ERROR,
  resolveTwitchAppCredentials,
  requireTwitchAppCredentials,
};
