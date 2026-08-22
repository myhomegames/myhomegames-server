jest.mock("../../utils/moonlightWebCredentials", () => ({
  requestMoonlightWebJson: jest.fn(),
}));

const { requestMoonlightWebJson } = require("../../utils/moonlightWebCredentials");
const {
  pickDesktopApp,
  pickMoonlightApp,
  attachMoonlightStopHook,
  buildMoonlightDesktopStreamUrl,
  ensureMoonlightEnterFullscreenDefault,
  shouldUseMoonlightTvProfile,
  MOONLIGHT_TV_STREAM_SETTINGS,
  MOONLIGHT_STREAM_HTML_PATH,
} = require("../../utils/moonlightWebEmbed");

describe("moonlightWebEmbed", () => {
  beforeEach(() => {
    requestMoonlightWebJson.mockReset();
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

  it("pickMoonlightApp ignores Desktop and prefers MHG entries", () => {
    expect(
      pickMoonlightApp(
        [
          { app_id: 0, title: "Desktop" },
          { app_id: 2, title: "MHG: Hollow Knight" },
        ],
        { appTitle: "MHG: Hollow Knight" },
      ),
    ).toEqual({ app_id: 2, title: "MHG: Hollow Knight" });
    expect(
      pickMoonlightApp([{ app_id: 0, title: "Desktop" }], { appTitle: "MHG: Game" }),
    ).toBeNull();
  });

  it("detects TV profile from mhgProfile or Tizen UA", () => {
    expect(shouldUseMoonlightTvProfile("?mhgProfile=tv", "")).toBe(true);
    expect(
      shouldUseMoonlightTvProfile("", "Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0)"),
    ).toBe(true);
    expect(
      shouldUseMoonlightTvProfile("", "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL)"),
    ).toBe(false);
    expect(MOONLIGHT_TV_STREAM_SETTINGS).toMatchObject({
      bitrate: 5000,
      fps: 30,
      videoSize: "720p",
      dataTransport: "webrtc",
      canvasRenderer: false,
      forceVideoElementRenderer: true,
    });
  });

  it("includes ty when patching Moonlight role fullscreen default", async () => {
    requestMoonlightWebJson
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

    const patchCall = requestMoonlightWebJson.mock.calls.find((call) => call[0].method === "PATCH");
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
    expect(parsed.pathname).toBe(`/${MOONLIGHT_STREAM_HTML_PATH}`);
    expect(parsed.searchParams.get("mhgReturn")).toBe("https://app.example/app/game/42");
    const stop = new URL(parsed.searchParams.get("mhgStop"));
    expect(stop.origin).toBe("https://home.example");
    expect(stop.pathname).toBe("/streaming/stop");
    expect(stop.searchParams.get("gameId")).toBe("42");
    expect(stop.searchParams.get("hostId")).toBe("7");
  });

  it("builds Desktop stream URL under versioned folder ending with stream.html", () => {
    const url = buildMoonlightDesktopStreamUrl("https://ml.example", 9, 1);
    expect(url).toBe(`https://ml.example/${MOONLIGHT_STREAM_HTML_PATH}?hostId=9&appId=1`);
    expect(new URL(url).pathname.endsWith("stream.html")).toBe(true);
  });
});
