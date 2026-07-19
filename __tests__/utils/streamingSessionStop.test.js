"use strict";

const {
  moonlightApiBaseFromUrl,
  resolveMoonlightControlBase,
  rememberStreamingLaunch,
  getActiveStreamingLaunch,
  killActiveStreamingGame,
  clearActiveStreamingLaunch,
} = require("../../utils/streamingSessionStop");

describe("streamingSessionStop", () => {
  afterEach(() => {
    clearActiveStreamingLaunch();
  });

  it("strips stream.html paths to Moonlight API origin", () => {
    expect(
      moonlightApiBaseFromUrl("http://127.0.0.1:8080/stream.html?hostId=1&appId=0"),
    ).toBe("http://127.0.0.1:8080");
    expect(moonlightApiBaseFromUrl("https://user-moonlight-web.vige.it/")).toBe(
      "https://user-moonlight-web.vige.it",
    );
  });

  it("prefers managed local Moonlight control base", () => {
    expect(resolveMoonlightControlBase("https://user-moonlight-web.vige.it", {})).toBe(
      "http://127.0.0.1:8080",
    );
    expect(
      resolveMoonlightControlBase("https://user-moonlight-web.vige.it", {
        MOONLIGHT_WEB_PORT: "9090",
      }),
    ).toBe("http://127.0.0.1:9090");
  });

  it("tracks and clears the active streaming game launch", () => {
    expect(getActiveStreamingLaunch()).toBeNull();
    rememberStreamingLaunch({ pid: 4242, gameId: 7, executableName: "Play" });
    expect(getActiveStreamingLaunch()).toMatchObject({
      pid: 4242,
      gameId: 7,
      executableName: "Play",
    });
    // Invalid pid should not throw; process may already be gone.
    const killed = killActiveStreamingGame();
    expect(killed.pid).toBe(4242);
    expect(getActiveStreamingLaunch()).toBeNull();
  });
});
