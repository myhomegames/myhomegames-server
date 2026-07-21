const { detectInstallStrategy, isDockerAvailable } = require("../../utils/moonlightWebBinary");
const { defaultManagedMoonlightWebUrl } = require("../../utils/streaming");
const { commandExists, resolveBrewBinary, isDockerDaemonReady } = require("../../utils/dockerRuntime");

describe("moonlightWebBinary", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  });

  it("defaults to docker strategy", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(detectInstallStrategy({}).kind).toBe("docker");
  });

  it("falls back to native zip on Windows when forced", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const strategy = detectInstallStrategy({ MOONLIGHT_WEB_FORCE_NATIVE: "true" });
    expect(strategy.kind).toBe("zip");
    expect(strategy.assetPattern.test("moonlight-web-x86_64-pc-windows-gnu.zip")).toBe(true);
  });

  it("falls back to native tar.gz on Linux when forced", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const strategy = detectInstallStrategy({ MOONLIGHT_WEB_FORCE_NATIVE: "true" });
    expect(strategy.kind).toBe("tar.gz");
    expect(strategy.assetPattern.test("moonlight-web-x86_64-unknown-linux-gnu.tar.gz")).toBe(true);
  });

  it("exposes docker availability helper", () => {
    expect(typeof isDockerAvailable()).toBe("boolean");
    expect(typeof isDockerDaemonReady()).toBe("boolean");
  });
});

describe("dockerRuntime helpers", () => {
  it("checks command existence", () => {
    expect(commandExists("node")).toBe(true);
    expect(commandExists("definitely-not-a-real-bin-xyz")).toBe(false);
  });

  it("resolves brew path when present or returns null", () => {
    const brew = resolveBrewBinary();
    expect(brew === null || typeof brew === "string").toBe(true);
  });
});

describe("defaultManagedMoonlightWebUrl", () => {
  it("defaults to localhost:8080", () => {
    expect(defaultManagedMoonlightWebUrl()).toBe("http://127.0.0.1:8080");
    expect(defaultManagedMoonlightWebUrl(9090)).toBe("http://127.0.0.1:9090");
  });
});
