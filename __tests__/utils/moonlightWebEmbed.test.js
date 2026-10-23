const fs = require("fs");
const os = require("os");
const path = require("path");

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
  ensureMoonlightWebDefaultUser,
  patchMoonlightStaticFullscreenAssets,
  repairMoonlightWebV3Config,
  shouldUseMoonlightTvProfile,
  MOONLIGHT_TV_STREAM_SETTINGS,
  MOONLIGHT_STREAM_HTML_PATH,
  MOONLIGHT_MODULE_ALIAS,
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

  it("sets the v3 default user through the API and drops the legacy config field", async () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-user-"));
    fs.mkdirSync(path.join(packageRoot, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "server", "config.json"),
      `${JSON.stringify({ web_server: { default_user_id: 1 }, webrtc: { ice_servers: [] } }, null, 2)}\n`,
    );
    requestMoonlightWebJson
      .mockResolvedValueOnce({
        body: JSON.stringify({ users: [{ id: 7, name: "sunshine", role: "Admin" }] }),
      })
      .mockResolvedValueOnce({ body: JSON.stringify({ id: null }) })
      .mockResolvedValueOnce({ body: "" });

    const result = await ensureMoonlightWebDefaultUser({
      baseUrl: "http://127.0.0.1:8080",
      cookie: "mlSession=x",
      username: "sunshine",
      packageRoot,
    });

    expect(result).toEqual({ applied: true, userId: 7, restarted: false });
    const put = requestMoonlightWebJson.mock.calls.find((call) => call[0].method === "PUT");
    expect(put[0].urlString).toBe("http://127.0.0.1:8080/api/user/default");
    expect(put[0].body).toEqual({ id: 7 });
    const config = JSON.parse(fs.readFileSync(path.join(packageRoot, "server", "config.json"), "utf8"));
    expect(config.web_server).toBeUndefined();
    expect(config.webrtc).toEqual({ ice_servers: [] });
  });

  it("keeps the v2 config.json default user when the v3 route is missing", async () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-user-"));
    fs.mkdirSync(path.join(packageRoot, "server"), { recursive: true });
    requestMoonlightWebJson
      .mockResolvedValueOnce({
        body: JSON.stringify({ users: [{ id: 7, name: "sunshine", role: "Admin" }] }),
      })
      .mockRejectedValueOnce(new Error("GET /api/user/default failed (404): not found"));

    const result = await ensureMoonlightWebDefaultUser({
      baseUrl: "http://127.0.0.1:8080/",
      cookie: "mlSession=x",
      packageRoot,
    });

    expect(result.restarted).toBe(true);
    expect(result.userId).toBe(7);
    const config = JSON.parse(fs.readFileSync(path.join(packageRoot, "server", "config.json"), "utf8"));
    expect(config.web_server.default_user_id).toBe(7);
    expect(requestMoonlightWebJson.mock.calls.some((call) => call[0].method === "PUT")).toBe(false);
  });

  it("patches the v3 webpack bundle without loading the old module graph", () => {
    const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-static-"));
    const bundle = [
      "// MHG entry mhg33",
      '(()=>{"use strict";',
      "this.autoEnterFullscreenOnStart=s.enterFullscreenOnStreamStart;",
      'this.exitStreamButton.addEventListener("click",()=>pu(this,void 0,void 0,function*(){const e=this.app.getStream();e&&((yield e.stop())||console.debug("Failed to close stream correctly")),yu()}));',
      '"/host/stream/web_socket"',
      "})();",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(staticRoot, "stream.js"), bundle);
    fs.writeFileSync(path.join(staticRoot, "mhg-boot.mhg33.js"), "import { Stream } from '/stream/index.mhg33.js';\n");
    fs.writeFileSync(path.join(staticRoot, "stream.mhg33.js"), bundle);
    fs.writeFileSync(
      path.join(staticRoot, "stream.html"),
      '<!doctype html><html><head><base href="/" /><script src=./config.js></script>' +
        '<script type="module" src="/mhg-boot.mhg33.js"></script>' +
        '<script type="module" src="/stream.mhg33.js"></script>' +
        '</head><body><script src=stream.js></script></body></html>',
    );

    const first = patchMoonlightStaticFullscreenAssets(staticRoot);
    const second = patchMoonlightStaticFullscreenAssets(staticRoot);
    expect(first.applied).toBeGreaterThan(0);
    expect(second.applied).toBe(0);

    const js = fs.readFileSync(path.join(staticRoot, "stream.js"), "utf8");
    expect(js.startsWith("(()=>")).toBe(true);
    expect(js).toContain("this.autoEnterFullscreenOnStart=true");
    expect(js).toContain('get("mhgStop")');
    expect(js).not.toContain("import { Stream }");
    expect(fs.existsSync(path.join(staticRoot, "stream", "index.js"))).toBe(false);
    expect(fs.existsSync(path.join(staticRoot, "mhg-boot.mhg33.js"))).toBe(false);
    expect(fs.existsSync(path.join(staticRoot, "stream.mhg33.js"))).toBe(false);

    const html = fs.readFileSync(path.join(staticRoot, "stream.html"), "utf8");
    expect(html).not.toContain("type=\"module\"");
    expect(html.match(/<script src="\/stream\.js\?mhg=33"><\/script>/g)).toHaveLength(1);
    expect(html).toContain('id="mhg-v3-boot"');
    expect(html).toContain("mlSettings");
    const versioned = fs.readFileSync(
      path.join(staticRoot, MOONLIGHT_MODULE_ALIAS, "stream.html"),
      "utf8",
    );
    expect(versioned).toBe(html);
  });

  it("removes a v3 web_server section that only stored the legacy default user", () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-cfg-"));
    fs.mkdirSync(path.join(packageRoot, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "server", "config.json"),
      `${JSON.stringify({ web_server: { default_user_id: 7 }, webrtc: { ice_servers: [] } }, null, 2)}\n`,
    );

    expect(repairMoonlightWebV3Config(packageRoot, "3.0.0")).toBe(true);
    expect(repairMoonlightWebV3Config(packageRoot, "3.0.0")).toBe(false);
    const config = JSON.parse(fs.readFileSync(path.join(packageRoot, "server", "config.json"), "utf8"));
    expect(config.web_server).toBeUndefined();
    expect(config.webrtc).toEqual({ ice_servers: [] });
  });

  it("keeps other v3 web_server settings and fills the required fields", () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-cfg-"));
    fs.mkdirSync(path.join(packageRoot, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "server", "config.json"),
      `${JSON.stringify({ web_server: { url_path_prefix: "/ml", default_user_id: 1 } }, null, 2)}\n`,
    );

    expect(repairMoonlightWebV3Config(packageRoot, "3.0.0")).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(packageRoot, "server", "config.json"), "utf8"));
    expect(config.web_server).toEqual({
      url_path_prefix: "/ml",
      certificate: null,
      forwarded_header: null,
      first_login_create_admin: true,
      first_login_assign_global_hosts: true,
    });
  });

  it("leaves a v2 config.json default user in place", () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-cfg-"));
    fs.mkdirSync(path.join(packageRoot, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "server", "config.json"),
      `${JSON.stringify({ web_server: { default_user_id: 4 } }, null, 2)}\n`,
    );

    expect(repairMoonlightWebV3Config(packageRoot, "2.9.0")).toBe(false);
    const config = JSON.parse(fs.readFileSync(path.join(packageRoot, "server", "config.json"), "utf8"));
    expect(config.web_server.default_user_id).toBe(4);
  });
});
