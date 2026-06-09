"use strict";

const path = require("path");
const {
  TWITCH_OAUTH_SESSIONS_FILE,
  TWITCH_APP_CREDENTIALS_FILE,
  CLOUDFLARE_TUNNEL_RUN_FILE,
  twitchOAuthSessionsPath,
  twitchAppCredentialsPath,
  cloudflareTunnelRunPath,
} = require("../../utils/metadataTokenPaths");

describe("metadataTokenPaths", () => {
  const metadataPath = "/tmp/mhg-metadata";

  it("resolves twitch oauth sessions under tokens/", () => {
    expect(twitchOAuthSessionsPath(metadataPath)).toBe(
      path.join(metadataPath, TWITCH_OAUTH_SESSIONS_FILE),
    );
  });

  it("resolves twitch app credentials under tokens/", () => {
    expect(twitchAppCredentialsPath(metadataPath)).toBe(
      path.join(metadataPath, TWITCH_APP_CREDENTIALS_FILE),
    );
  });

  it("resolves cloudflare tunnel run token under tokens/", () => {
    expect(cloudflareTunnelRunPath(metadataPath)).toBe(
      path.join(metadataPath, CLOUDFLARE_TUNNEL_RUN_FILE),
    );
  });
});
