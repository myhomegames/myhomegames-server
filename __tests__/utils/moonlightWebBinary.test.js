const { detectInstallStrategy } = require("../../utils/moonlightWebBinary");
const { defaultManagedMoonlightWebUrl } = require("../../utils/streaming");
const { commandExists, resolveBrewBinary } = require("../../utils/dockerRuntime");

describe("moonlightWebBinary", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  });

  it("downloads the macOS arm64 tar.gz", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "arm64" });
    const strategy = detectInstallStrategy();
    expect(strategy.kind).toBe("tar.gz");
    expect(strategy.assetPattern.test("moonlight-web-aarch64-apple-darwin.tar.gz")).toBe(true);
  });

  it("downloads the macOS x64 tar.gz", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const strategy = detectInstallStrategy();
    expect(strategy.kind).toBe("tar.gz");
    expect(strategy.assetPattern.test("moonlight-web-x86_64-apple-darwin.tar.gz")).toBe(true);
  });

  it("downloads the official zip on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const strategy = detectInstallStrategy();
    expect(strategy.kind).toBe("zip");
    expect(strategy.assetPattern.test("moonlight-web-x86_64-pc-windows-gnu.zip")).toBe(true);
  });

  it("downloads the official tar.gz on Linux x64", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
    const strategy = detectInstallStrategy();
    expect(strategy.kind).toBe("tar.gz");
    expect(strategy.assetPattern.test("moonlight-web-x86_64-unknown-linux-gnu.tar.gz")).toBe(true);
  });

  it("downloads the official arm64 tar.gz on Linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "arm64" });
    const strategy = detectInstallStrategy();
    expect(strategy.kind).toBe("tar.gz");
    expect(strategy.assetPattern.test("moonlight-web-aarch64-unknown-linux-gnu.tar.gz")).toBe(true);
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
