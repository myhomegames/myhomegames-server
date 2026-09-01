const {
  normalizeMoonlightWebUrl,
  readStreamingSettings,
  validateStreamingSettingsPatch,
  resolveMoonlightWebUrlFromApiBase,
  syncMoonlightWebUrlFromApiBase,
  shouldSyncMoonlightWebUrlFromApiBase,
} = require("../../utils/streaming");

describe("streaming settings", () => {
  it("normalizes moonlight web URLs", () => {
    expect(normalizeMoonlightWebUrl("https://stream.example.com:8080/")).toBe(
      "https://stream.example.com:8080",
    );
    expect(normalizeMoonlightWebUrl("ftp://bad")).toBe("");
  });

  it("defaults remote streaming on with managed Moonlight URL", () => {
    const settings = readStreamingSettings({
      moonlightWebUrl: "",
    });
    expect(settings.remoteStreamingEnabled).toBe(true);
    expect(settings.moonlightWebUrl).toBe("http://127.0.0.1:8080");
    const disabled = readStreamingSettings({
      remoteStreamingEnabled: false,
      moonlightWebUrl: "https://stream.example.com",
    });
    expect(disabled.remoteStreamingEnabled).toBe(false);
    const ready = readStreamingSettings({
      remoteStreamingEnabled: true,
      moonlightWebUrl: "https://stream.example.com",
    });
    expect(ready.remoteStreamingEnabled).toBe(true);
    expect(ready.moonlightWebUrl).toBe("https://stream.example.com");
  });

  it("validates settings patch", () => {
    expect(validateStreamingSettingsPatch({ remoteStreamingEnabled: true }).ok).toBe(true);
    const invalid = validateStreamingSettingsPatch({ moonlightWebUrl: "not-a-url" });
    expect(invalid.ok).toBe(false);
  });

  it("resolves Moonlight Web URL from per-user API_BASE or local managed URL", () => {
    expect(
      resolveMoonlightWebUrlFromApiBase("https://luca-myhomegames-server.vige.it", {}),
    ).toBe("https://luca-moonlight-web.vige.it");
    expect(resolveMoonlightWebUrlFromApiBase("http://localhost:4000", {})).toBe(
      "http://127.0.0.1:8080",
    );
    expect(
      resolveMoonlightWebUrlFromApiBase("https://myhomegames-server.vige.it", {}),
    ).toBe("http://127.0.0.1:8080");
  });

  it("syncs moonlightWebUrl from API_BASE when Cloudflare Tunnel is disabled", () => {
    const writes = [];
    const readSettings = () => ({ moonlightWebUrl: "https://stale-tunnel.example" });
    const writeSettings = (next) => {
      writes.push(next);
      return true;
    };

    expect(
      shouldSyncMoonlightWebUrlFromApiBase({ CLOUDFLARE_TUNNEL_ENABLED: "true" }),
    ).toBe(false);
    expect(
      syncMoonlightWebUrlFromApiBase({
        readSettings,
        writeSettings,
        apiBase: "http://localhost:4000",
        env: { CLOUDFLARE_TUNNEL_ENABLED: "true" },
      }),
    ).toBe(false);
    expect(writes).toHaveLength(0);

    expect(
      shouldSyncMoonlightWebUrlFromApiBase({ CLOUDFLARE_TUNNEL_ENABLED: "false" }),
    ).toBe(true);
    expect(
      syncMoonlightWebUrlFromApiBase({
        readSettings,
        writeSettings,
        apiBase: "http://localhost:4000",
        env: { CLOUDFLARE_TUNNEL_ENABLED: "false" },
      }),
    ).toBe(true);
    expect(writes[0].moonlightWebUrl).toBe("http://127.0.0.1:8080");
  });
});
