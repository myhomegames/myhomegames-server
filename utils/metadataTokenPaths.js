"use strict";

const path = require("path");

const TOKENS_DIR = "tokens";
const TWITCH_OAUTH_SESSIONS_FILE = path.join(TOKENS_DIR, "twitch-oauth-sessions.json");
const TWITCH_APP_CREDENTIALS_FILE = path.join(TOKENS_DIR, "twitch-app-credentials.json");
const CLOUDFLARE_TUNNEL_RUN_FILE = path.join(TOKENS_DIR, "cloudflare-tunnel-run.json");

function tokensDirectory(metadataPath) {
  return path.join(metadataPath, TOKENS_DIR);
}

function twitchOAuthSessionsPath(metadataPath) {
  return path.join(metadataPath, TWITCH_OAUTH_SESSIONS_FILE);
}

function twitchAppCredentialsPath(metadataPath) {
  return path.join(metadataPath, TWITCH_APP_CREDENTIALS_FILE);
}

function cloudflareTunnelRunPath(metadataPath) {
  return path.join(metadataPath, CLOUDFLARE_TUNNEL_RUN_FILE);
}

module.exports = {
  TOKENS_DIR,
  TWITCH_OAUTH_SESSIONS_FILE,
  TWITCH_APP_CREDENTIALS_FILE,
  CLOUDFLARE_TUNNEL_RUN_FILE,
  tokensDirectory,
  twitchOAuthSessionsPath,
  twitchAppCredentialsPath,
  cloudflareTunnelRunPath,
};
