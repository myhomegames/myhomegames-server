"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  moonlightApiBaseFromUrl,
  resolveMoonlightControlBase,
  rememberStreamingLaunch,
  getActiveStreamingLaunch,
  killActiveStreamingGame,
  clearActiveStreamingLaunch,
} = require("../../utils/streamingSessionStop");
const {
  extractLaunchCommandPaths,
  readLaunchScriptCommandLine,
} = require("../../utils/gameLauncher");

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
    rememberStreamingLaunch({
      pid: 4242,
      gameId: 7,
      executableName: "Play",
      fullCommandPath: "/tmp/fake-game.sh",
    });
    expect(getActiveStreamingLaunch()).toMatchObject({
      pid: 4242,
      gameId: 7,
      executableName: "Play",
      fullCommandPath: "/tmp/fake-game.sh",
    });
    // Invalid pid should not throw; process may already be gone.
    const killed = killActiveStreamingGame();
    expect(killed.byPid.pid).toBe(4242);
    expect(getActiveStreamingLaunch()).toBeNull();
  });

  it("extracts absolute paths from typical emulator launch lines", () => {
    const paths = extractLaunchCommandPaths(
      '/Applications/dosbox-x.app/Contents/MacOS/dosbox-x -set "dosbox quit warning=false" -conf /Volumes/Elements/Dropbox/private/dosprograms/games/3demon/dosbox.conf',
    );
    expect(paths[0]).toContain("3demon/dosbox.conf");
    expect(paths.some((p) => p.includes("dosbox-x"))).toBe(true);
  });

  it("reads the first command line from a launch script", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-launch-"));
    const script = path.join(dir, "game.sh");
    fs.writeFileSync(
      script,
      "# comment\n\n/usr/bin/emulator /tmp/roms/unique-game.iso --fullscreen\n",
      "utf8",
    );
    expect(readLaunchScriptCommandLine(script)).toBe(
      "/usr/bin/emulator /tmp/roms/unique-game.iso --fullscreen",
    );
    expect(extractLaunchCommandPaths(readLaunchScriptCommandLine(script))[0]).toBe(
      "/tmp/roms/unique-game.iso",
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
