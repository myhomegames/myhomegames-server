const fs = require("fs");
const os = require("os");
const path = require("path");
const { detectPlatformAsset, validateDownloadedArchive, MIN_DMG_BYTES } = require("../../utils/sunshineBinary");

describe("sunshineBinary", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  });

  it("selects Windows portable asset", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    expect(detectPlatformAsset()).toEqual({
      kind: "zip",
      assetPattern: /^Sunshine-Windows-AMD64-portable\.zip$/i,
    });
  });

  it("selects macOS dmg asset", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "arm64" });
    expect(detectPlatformAsset()).toEqual({
      kind: "dmg",
      assetPattern: /^Sunshine-macOS-arm64\.dmg$/i,
    });
  });

  it("selects Linux appimage asset", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });
    expect(detectPlatformAsset()).toEqual({
      kind: "appimage",
      assetPattern: /^sunshine\.AppImage$/i,
    });
  });

  describe("validateDownloadedArchive", () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sunshine-binary-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("rejects dmg files that are too small", () => {
      const archivePath = path.join(tempDir, "Sunshine-macOS-arm64.dmg");
      fs.writeFileSync(archivePath, Buffer.alloc(1024));

      expect(() => validateDownloadedArchive(archivePath, "dmg", null)).toThrow(/too small/);
      expect(fs.existsSync(archivePath)).toBe(false);
    });

    it("rejects dmg files that look like text", () => {
      const archivePath = path.join(tempDir, "Sunshine-macOS-arm64.dmg");
      const payload = Buffer.alloc(MIN_DMG_BYTES, 0x20);
      payload.write("GNU GENERAL PUBLIC LICENSE", 0, "utf8");
      fs.writeFileSync(archivePath, payload);

      expect(() => validateDownloadedArchive(archivePath, "dmg", null)).toThrow(/text\/HTML/);
      expect(fs.existsSync(archivePath)).toBe(false);
    });

    it("accepts dmg files with binary headers", () => {
      const archivePath = path.join(tempDir, "Sunshine-macOS-arm64.dmg");
      const payload = Buffer.alloc(MIN_DMG_BYTES);
      payload[0] = 0x78;
      payload[1] = 0xda;
      fs.writeFileSync(archivePath, payload);

      expect(() => validateDownloadedArchive(archivePath, "dmg", null)).not.toThrow();
    });
  });
});
