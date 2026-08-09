jest.mock("../../utils/moonlightWebPairing", () => ({
  ensureMoonlightWebSunshinePairing: jest.fn().mockResolvedValue({ paired: true }),
  listMoonlightHosts: jest.fn(),
  hostLooksPaired: (host) => host?.paired === "Paired",
}));

jest.mock("../../utils/moonlightWebEmbed", () => ({
  resolveMoonlightDesktopStreamUrl: jest.fn(),
  buildMoonlightDesktopStreamUrl: jest.fn(
    (baseUrl, hostId, appId) => `${baseUrl}/stream.html?hostId=${hostId}&appId=${appId}`,
  ),
  listMoonlightApps: jest.fn(),
  pickDesktopApp: jest.fn(),
}));

const { listMoonlightHosts } = require("../../utils/moonlightWebPairing");
const {
  resolveMoonlightDesktopStreamUrl,
  buildMoonlightDesktopStreamUrl,
} = require("../../utils/moonlightWebEmbed");
const { ensureMoonlightDesktopStreamReady } = require("../../utils/moonlightWebLaunch");

describe("moonlightWebLaunch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves Desktop stream from paired host", async () => {
    listMoonlightHosts.mockResolvedValue([
      { host_id: 9, paired: "Paired", name: "Home" },
    ]);
    resolveMoonlightDesktopStreamUrl.mockResolvedValue({
      url: "http://127.0.0.1:8080/stream.html?hostId=9&appId=1",
      hostId: 9,
      appId: 1,
      appTitle: "Desktop",
    });

    const result = await ensureMoonlightDesktopStreamReady({
      baseUrl: "http://127.0.0.1:8080",
      kind: "docker",
      env: {},
    });

    expect(result.url).toContain("/stream.html");
    expect(result.hostId).toBe(9);
    expect(result.appId).toBe(1);
  });

  it("falls back to cached host/app ids when live lookup fails", async () => {
    listMoonlightHosts.mockRejectedValue(new Error("busy"));
    resolveMoonlightDesktopStreamUrl.mockRejectedValue(new Error("busy"));

    const result = await ensureMoonlightDesktopStreamReady({
      baseUrl: "http://127.0.0.1:8080",
      kind: "docker",
      env: {},
      cachedHostId: 9,
      cachedAppId: 1,
      maxAttempts: 1,
    });

    expect(buildMoonlightDesktopStreamUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:8080",
      9,
      1,
    );
    expect(result.url).toBe("http://127.0.0.1:8080/stream.html?hostId=9&appId=1");
  });
});
