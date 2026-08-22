jest.mock("../../utils/moonlightWebPairing", () => ({
  ensureMoonlightWebSunshinePairing: jest.fn().mockResolvedValue({ paired: true }),
  listMoonlightHosts: jest.fn(),
  hostLooksPaired: (host) => host?.paired === "Paired",
}));

jest.mock("../../utils/moonlightWebEmbed", () => ({
  resolveMoonlightAppStreamUrl: jest.fn(),
  buildMoonlightAppStreamUrl: jest.fn(
    (baseUrl, hostId, appId) => `${baseUrl}/stream.html?hostId=${hostId}&appId=${appId}`,
  ),
  listMoonlightApps: jest.fn(),
  pickMoonlightApp: jest.fn(),
}));

const { listMoonlightHosts } = require("../../utils/moonlightWebPairing");
const {
  resolveMoonlightAppStreamUrl,
  buildMoonlightAppStreamUrl,
} = require("../../utils/moonlightWebEmbed");
const { ensureMoonlightAppStreamReady } = require("../../utils/moonlightWebLaunch");

describe("moonlightWebLaunch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves application stream from paired host", async () => {
    listMoonlightHosts.mockResolvedValue([
      { host_id: 9, paired: "Paired", name: "Home" },
    ]);
    resolveMoonlightAppStreamUrl.mockResolvedValue({
      url: "http://127.0.0.1:8080/stream.html?hostId=9&appId=3",
      hostId: 9,
      appId: 3,
      appTitle: "MHG: Game",
    });

    const result = await ensureMoonlightAppStreamReady({
      baseUrl: "http://127.0.0.1:8080",
      kind: "docker",
      env: {},
      appTitle: "MHG: Game",
    });

    expect(result.url).toContain("/stream.html");
    expect(result.hostId).toBe(9);
    expect(result.appId).toBe(3);
  });

  it("falls back to cached host/app ids when live lookup fails", async () => {
    listMoonlightHosts.mockRejectedValue(new Error("busy"));
    resolveMoonlightAppStreamUrl.mockRejectedValue(new Error("busy"));

    const { listMoonlightApps, pickMoonlightApp } = require("../../utils/moonlightWebEmbed");
    listMoonlightApps.mockResolvedValue([
      { app_id: 3, title: "MHG: Cached" },
    ]);
    pickMoonlightApp.mockReturnValue({ app_id: 3, title: "MHG: Cached" });

    const result = await ensureMoonlightAppStreamReady({
      baseUrl: "http://127.0.0.1:8080",
      kind: "docker",
      env: {},
      appTitle: "MHG: Cached",
      cachedHostId: 9,
      appId: 3,
      maxAttempts: 1,
    });

    expect(buildMoonlightAppStreamUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:8080",
      9,
      3,
    );
    expect(result.url).toBe("http://127.0.0.1:8080/stream.html?hostId=9&appId=3");
  });
});
