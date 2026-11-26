"use strict";

const {
  resolveIgdbCatalogHttpBase,
  resolveLoopbackApiBase,
  catalogRequestHeaders,
  readTwitchApiEnabledSetting,
} = require("../../utils/igdbCatalogHttp");

describe("igdbCatalogHttp", () => {
  test("resolveLoopbackApiBase uses HTTP_PORT", () => {
    expect(resolveLoopbackApiBase({ HTTP_PORT: "4123" })).toBe("http://127.0.0.1:4123");
  });

  test("resolveIgdbCatalogHttpBase uses user tunnel host from request", () => {
    const base = resolveIgdbCatalogHttpBase({
      headers: { host: "luca-myhomegames-server.vige.it" },
    });
    expect(base).toBe("https://luca-myhomegames-server.vige.it");
  });

  test("resolveIgdbCatalogHttpBase falls back to loopback for localhost", () => {
    const base = resolveIgdbCatalogHttpBase(
      { headers: { host: "127.0.0.1:4000" } },
      { HTTP_PORT: "4000" }
    );
    expect(base).toBe("http://127.0.0.1:4000");
  });

  test("catalogRequestHeaders forwards X-Auth-Token", () => {
    const headers = catalogRequestHeaders({
      header: (name) => (name === "X-Auth-Token" ? "tok" : ""),
      query: {},
    });
    expect(headers["X-Auth-Token"]).toBe("tok");
    expect(headers.Accept).toBe("application/json");
  });

  test("readTwitchApiEnabledSetting returns false for missing file", () => {
    expect(readTwitchApiEnabledSetting("/tmp/mhg-no-such-settings-dir")).toBe(false);
  });
});
