const { pickDesktopApp, attachMoonlightStopHook } = require("../../utils/moonlightWebEmbed");

describe("moonlightWebEmbed", () => {
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
