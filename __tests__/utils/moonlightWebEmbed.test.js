jest.mock("../../utils/moonlightWebCredentials", () => ({
  requestJson: jest.fn(),
}));

const { requestJson } = require("../../utils/moonlightWebCredentials");
const {
  pickDesktopApp,
  attachMoonlightStopHook,
  ensureMoonlightEnterFullscreenDefault,
} = require("../../utils/moonlightWebEmbed");

describe("moonlightWebEmbed", () => {
  beforeEach(() => {
    requestJson.mockReset();
  });

  it("prefers Desktop app by title then app_id 0", () => {
    expect(
      pickDesktopApp([
        { app_id: 3, title: "Steam" },
        { app_id: 1, title: "Desktop" },
      ]),
    ).toEqual({ app_id: 1, title: "Desktop" });
    expect(pickDesktopApp([{ app_id: 0, title: "Desktop" }])).toEqual({
      app_id: 0,
      title: "Desktop",
    });
    expect(pickDesktopApp([{ app_id: 9, title: "Other" }])).toEqual({
      app_id: 9,
      title: "Other",
    });
    expect(pickDesktopApp([])).toBeNull();
  });

  it("includes ty when patching Moonlight role fullscreen default", async () => {
    requestJson
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          role: {
            id: 1,
            ty: "Admin",
            default_settings: { enterFullscreenOnStreamStart: false },
          },
        }),
      })
      .mockResolvedValueOnce({ statusCode: 200, body: "" });

    await ensureMoonlightEnterFullscreenDefault({
      baseUrl: "http://127.0.0.1:8080",
      cookie: "session=x",
      kind: "native",
    });

    const patchCall = requestJson.mock.calls.find((call) => call[0].method === "PATCH");
    expect(patchCall?.[0].body).toEqual({
      id: 1,
      ty: "Admin",
      default_settings: { enterFullscreenOnStreamStart: true },
    });
  });

  it("attaches mhgStop and optional mhgReturn on the stream URL", () => {
    const url = attachMoonlightStopHook("https://ml.example/stream.html?host_id=1&app_id=0", {
      apiBase: "https://home.example",
      gameId: 42,
      executableName: "Play",
      hostId: 7,
      returnUrl: "https://app.example/app/game/42",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("mhgReturn")).toBe("https://app.example/app/game/42");
    const stop = new URL(parsed.searchParams.get("mhgStop"));
    expect(stop.origin).toBe("https://home.example");
    expect(stop.pathname).toBe("/streaming/stop");
    expect(stop.searchParams.get("gameId")).toBe("42");
    expect(stop.searchParams.get("hostId")).toBe("7");
  });
});
