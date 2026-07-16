"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveTwitchAppCredentials,
  resolveTwitchAppCredentialsForServerIgdb,
  requireTwitchAppCredentials,
  CATALOG_API_CREDENTIALS_ERROR_GATEWAY,
  CATALOG_API_CREDENTIALS_ERROR_LOCAL,
  setTwitchCredentialsMetadataPath,
} = require("../../utils/twitchAppCredentials");
const { saveStoredTwitchAppCredentials } = require("../../utils/twitchAppCredentialsStore");

function mockReq(headers = {}, query = {}) {
  return {
    header(name) {
      return headers[name];
    },
    query,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("twitchAppCredentials", () => {
  const originalTunnelEnabled = process.env.CLOUDFLARE_TUNNEL_ENABLED;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalClientSecret = process.env.TWITCH_CLIENT_SECRET;
  let testMetadataPath;

  beforeEach(() => {
    testMetadataPath = path.join(os.tmpdir(), `mhg-twitch-creds-${Date.now()}`);
    fs.mkdirSync(testMetadataPath, { recursive: true });
    setTwitchCredentialsMetadataPath(testMetadataPath);
  });

  afterEach(() => {
    if (originalTunnelEnabled === undefined) {
      delete process.env.CLOUDFLARE_TUNNEL_ENABLED;
    } else {
      process.env.CLOUDFLARE_TUNNEL_ENABLED = originalTunnelEnabled;
    }
    if (originalClientId === undefined) {
      delete process.env.TWITCH_CLIENT_ID;
    } else {
      process.env.TWITCH_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.TWITCH_CLIENT_SECRET;
    } else {
      process.env.TWITCH_CLIENT_SECRET = originalClientSecret;
    }
    setTwitchCredentialsMetadataPath(null);
    if (testMetadataPath && fs.existsSync(testMetadataPath)) {
      fs.rmSync(testMetadataPath, { recursive: true, force: true });
    }
  });

  test("resolveTwitchAppCredentials reads only headers when tunnel enabled", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "true";
    saveStoredTwitchAppCredentials(testMetadataPath, {
      clientId: "stored-id",
      clientSecret: "stored-secret",
    });

    const creds = resolveTwitchAppCredentials(
      mockReq(
        {
          "X-Twitch-Client-Id": "hdr-id",
          "X-Twitch-Client-Secret": "hdr-secret",
        },
        { clientId: "ignored", clientSecret: "ignored" }
      )
    );
    expect(creds).toEqual({ clientId: "hdr-id", clientSecret: "hdr-secret" });
  });

  test("resolveTwitchAppCredentials falls back to tokens file when tunnel disabled", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "false";
    saveStoredTwitchAppCredentials(testMetadataPath, {
      clientId: "stored-id",
      clientSecret: "stored-secret",
    });

    const creds = resolveTwitchAppCredentials(mockReq({}));
    expect(creds).toEqual({ clientId: "stored-id", clientSecret: "stored-secret" });
  });

  test("resolveTwitchAppCredentials falls back to env when tunnel disabled and tokens empty", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "false";
    process.env.TWITCH_CLIENT_ID = "env-id";
    process.env.TWITCH_CLIENT_SECRET = "env-secret";

    const creds = resolveTwitchAppCredentials(mockReq({}));
    expect(creds).toEqual({ clientId: "env-id", clientSecret: "env-secret" });
  });

  test("requireTwitchAppCredentials returns gateway error when tunnel enabled", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "true";
    const res = mockRes();
    const out = requireTwitchAppCredentials(mockReq({}), res);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe(CATALOG_API_CREDENTIALS_ERROR_GATEWAY);
  });

  test("requireTwitchAppCredentials returns local error when tunnel disabled", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "false";
    const res = mockRes();
    const out = requireTwitchAppCredentials(mockReq({}), res);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe(CATALOG_API_CREDENTIALS_ERROR_LOCAL);
  });

  test("resolveTwitchAppCredentialsForServerIgdb uses stored creds when tunnel enabled and headers missing", () => {
    process.env.CLOUDFLARE_TUNNEL_ENABLED = "true";
    saveStoredTwitchAppCredentials(testMetadataPath, {
      clientId: "stored-id",
      clientSecret: "stored-secret",
    });

    const creds = resolveTwitchAppCredentialsForServerIgdb(mockReq({}));
    expect(creds).toMatchObject({ clientId: "stored-id", clientSecret: "stored-secret", source: "stored-settings" });
  });

});
