const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  applyCloudflareTunnelEnv,
  buildCloudflareTunnelArgs,
  isCloudflareTunnelEnabled,
} = require("../../utils/cloudflareTunnel");

describe("cloudflareTunnel", () => {
  test("isCloudflareTunnelEnabled respects flag", () => {
    expect(isCloudflareTunnelEnabled({ CLOUDFLARE_TUNNEL_ENABLED: "true" })).toBe(true);
    expect(isCloudflareTunnelEnabled({ CLOUDFLARE_TUNNEL_ENABLED: "false" })).toBe(false);
  });

  test("applyCloudflareTunnelEnv sets API_BASE and disables local HTTPS", () => {
    const env = {
      CLOUDFLARE_TUNNEL_ENABLED: "true",
      HTTPS_ENABLED: "true",
    };
    const result = applyCloudflareTunnelEnv(env);
    expect(result.applied).toBe(true);
    expect(env.API_BASE).toBe("https://myhomegames-server.vige.it");
    expect(env.HTTPS_ENABLED).toBe("false");
    expect(result.httpsDisabled).toBe(true);
  });

  test("applyCloudflareTunnelEnv does not override existing API_BASE", () => {
    const env = {
      CLOUDFLARE_TUNNEL_ENABLED: "true",
      API_BASE: "https://custom.example.com",
    };
    applyCloudflareTunnelEnv(env);
    expect(env.API_BASE).toBe("https://custom.example.com");
  });

  test("buildCloudflareTunnelArgs uses token when set", () => {
    const built = buildCloudflareTunnelArgs(
      { CLOUDFLARE_TUNNEL_TOKEN: "sekret" },
      "http://127.0.0.1:4000",
    );
    expect(built.mode).toBe("token");
    expect(built.args).toEqual(["tunnel", "run", "--token", "sekret"]);
  });

  test("buildCloudflareTunnelArgs uses tunnel name when set", () => {
    const built = buildCloudflareTunnelArgs(
      { CLOUDFLARE_TUNNEL_NAME: "myhomegames-server" },
      "http://127.0.0.1:4000",
    );
    expect(built.mode).toBe("name");
    expect(built.args).toEqual(["tunnel", "run", "myhomegames-server"]);
  });

  test("buildCloudflareTunnelArgs uses explicit config path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-cf-"));
    const configPath = path.join(dir, "config.yml");
    fs.writeFileSync(configPath, "tunnel: test\n", "utf8");
    const built = buildCloudflareTunnelArgs(
      { CLOUDFLARE_TUNNEL_CONFIG: configPath },
      "http://127.0.0.1:4000",
    );
    expect(built.mode).toBe("config");
    expect(built.args).toEqual(["tunnel", "--config", configPath, "run"]);
  });
});
