"use strict";

const { isCloudflareTunnelEnabled } = require("./cloudflareTunnel");
const { loadStoredTwitchAppCredentials } = require("./twitchAppCredentialsStore");

const IGDB_CREDENTIALS_ERROR_GATEWAY =
  "IGDB API credentials are not available. Configure them on the API gateway (e.g. Cloudflare Worker).";

const IGDB_CREDENTIALS_ERROR_LOCAL =
  "IGDB API credentials are not available. Configure Client ID and Client Secret in Settings, or set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the server .env file.";

let metadataPath = null;

function setTwitchCredentialsMetadataPath(nextPath) {
  metadataPath = typeof nextPath === "string" && nextPath.trim() ? nextPath.trim() : null;
}

function igdbCredentialsError() {
  return isCloudflareTunnelEnabled()
    ? IGDB_CREDENTIALS_ERROR_GATEWAY
    : IGDB_CREDENTIALS_ERROR_LOCAL;
}

/**
 * Resolve Twitch app credentials for IGDB (client_credentials).
 * Tunnel enabled: only X-Twitch-Client-* headers (API gateway).
 * Tunnel disabled: headers, then tokens/twitch-app-credentials.json, then TWITCH_CLIENT_* env vars.
 */
function resolveTwitchAppCredentials(req) {
  const headerClientId = String(req.header("X-Twitch-Client-Id") || "").trim();
  const headerClientSecret = String(req.header("X-Twitch-Client-Secret") || "").trim();

  if (isCloudflareTunnelEnabled()) {
    return { clientId: headerClientId, clientSecret: headerClientSecret };
  }

  if (headerClientId || headerClientSecret) {
    return { clientId: headerClientId, clientSecret: headerClientSecret };
  }

  if (metadataPath) {
    const stored = loadStoredTwitchAppCredentials(metadataPath);
    if (stored && (stored.clientId || stored.clientSecret)) {
      return { clientId: stored.clientId, clientSecret: stored.clientSecret };
    }
  }

  return {
    clientId: String(process.env.TWITCH_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.TWITCH_CLIENT_SECRET || "").trim(),
  };
}

/**
 * @returns {{ clientId: string, clientSecret: string } | null} null if response already sent (400)
 */
function requireTwitchAppCredentials(req, res, options = {}) {
  const { contentType = "application/json" } = options;
  const creds = resolveTwitchAppCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    res.setHeader("Content-Type", contentType);
    res.status(400).json({ error: igdbCredentialsError() });
    return null;
  }
  return creds;
}

/**
 * Twitch credentials for server-initiated IGDB calls (metadata reload, backfill).
 * Uses request headers when present; otherwise stored credentials and env even in tunnel mode.
 */
function resolveTwitchAppCredentialsForServerIgdb(req) {
  const headerClientId = String(req?.header?.("X-Twitch-Client-Id") || "").trim();
  const headerClientSecret = String(req?.header?.("X-Twitch-Client-Secret") || "").trim();
  if (headerClientId && headerClientSecret) {
    return { clientId: headerClientId, clientSecret: headerClientSecret, source: "headers" };
  }

  if (!isCloudflareTunnelEnabled()) {
    const fromReq = resolveTwitchAppCredentials(req);
    if (fromReq.clientId && fromReq.clientSecret) {
      return { ...fromReq, source: "resolveTwitchAppCredentials" };
    }
  }

  if (metadataPath) {
    const stored = loadStoredTwitchAppCredentials(metadataPath);
    if (stored?.clientId && stored?.clientSecret) {
      return { clientId: stored.clientId, clientSecret: stored.clientSecret, source: "stored-settings" };
    }
  }

  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (clientId && clientSecret) {
    return { clientId, clientSecret, source: "env" };
  }

  return { clientId: "", clientSecret: "", source: "none" };
}

module.exports = {
  IGDB_CREDENTIALS_ERROR: IGDB_CREDENTIALS_ERROR_GATEWAY,
  IGDB_CREDENTIALS_ERROR_GATEWAY,
  IGDB_CREDENTIALS_ERROR_LOCAL,
  igdbCredentialsError,
  setTwitchCredentialsMetadataPath,
  resolveTwitchAppCredentials,
  resolveTwitchAppCredentialsForServerIgdb,
  requireTwitchAppCredentials,
};
