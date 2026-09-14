const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveWritableCloudflaredBin,
  resolveMacAppBundledCloudflared,
  findBundledCloudflaredBin,
  parseCloudflaredVersion,
  compareCloudflaredVersions,
  cloudflaredBinaryLooksCompatible,
  isUsableCloudflaredBinary,
  cloudflaredReleaseAssetName,
  resolveCloudflaredInstallVersion,
} = require("../../utils/cloudflaredBinary");

describe("cloudflaredBinary", () => {
  test("resolveWritableCloudflaredBin uses metadata bin directory", () => {
    const metadataPath = "/data/MyHomeGames";
    const binPath = resolveWritableCloudflaredBin(metadataPath);
    expect(binPath).toBe(path.join(metadataPath, "bin", "cloudflared"));
  });

  test("resolveMacAppBundledCloudflared detects Resources bin path", () => {
    const execPath =
      "/Applications/MyHomeGames.app/Contents/MacOS/MyHomeGames";
    const expected = path.join(
      "/Applications/MyHomeGames.app/Contents/Resources/bin/cloudflared",
    );
    const dir = path.dirname(expected);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(expected, "");
    try {
      expect(resolveMacAppBundledCloudflared(execPath)).toBe(expected);
    } finally {
      fs.unlinkSync(expected);
      fs.rmdirSync(dir);
    }
  });

  test("parseCloudflaredVersion reads semver from --version output", () => {
    expect(
      parseCloudflaredVersion("cloudflared version 2026.6.1 (built 2026-05-25T09:32:09Z)"),
    ).toBe("2026.6.1");
    expect(parseCloudflaredVersion("unexpected output")).toBeNull();
  });

  test("compareCloudflaredVersions orders dated releases", () => {
    expect(compareCloudflaredVersions("2026.5.2", "2026.6.1")).toBeLessThan(0);
    expect(compareCloudflaredVersions("2026.6.1", "2026.6.1")).toBe(0);
    expect(compareCloudflaredVersions("2026.6.1", "2026.5.2")).toBeGreaterThan(0);
  });

  test("findBundledCloudflaredBin prefers CLOUDFLARED_BIN when set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-cf-bin-"));
    const customBin = path.join(dir, "cloudflared");
    fs.writeFileSync(customBin, "");
    try {
      expect(findBundledCloudflaredBin({ CLOUDFLARED_BIN: customBin })).toBe(customBin);
    } finally {
      fs.unlinkSync(customBin);
      fs.rmdirSync(dir);
    }
  });

  test("cloudflaredBinaryLooksCompatible detects ELF vs Mach-O", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-cf-magic-"));
    const elfPath = path.join(dir, "elf");
    const machoPath = path.join(dir, "macho");
    fs.writeFileSync(elfPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]));
    fs.writeFileSync(machoPath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]));
    try {
      expect(cloudflaredBinaryLooksCompatible(elfPath, "linux")).toBe(true);
      expect(cloudflaredBinaryLooksCompatible(elfPath, "darwin")).toBe(false);
      expect(cloudflaredBinaryLooksCompatible(machoPath, "darwin")).toBe(true);
      expect(cloudflaredBinaryLooksCompatible(machoPath, "linux")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("isUsableCloudflaredBinary rejects wrong-OS format without executing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-cf-usable-"));
    const machoOnLinuxCheck = path.join(dir, "macho");
    fs.writeFileSync(machoOnLinuxCheck, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    try {
      expect(isUsableCloudflaredBinary(machoOnLinuxCheck, "linux")).toBe(false);
      // Cross-check: linux ELF claimed for packaging host is format-only when platforms differ
      const elf = path.join(dir, "elf");
      fs.writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      if (process.platform !== "linux") {
        expect(isUsableCloudflaredBinary(elf, "linux")).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cloudflaredReleaseAssetName maps linux x64 to amd64 asset", () => {
    expect(cloudflaredReleaseAssetName("linux", "x64")).toBe("cloudflared-linux-amd64");
    expect(cloudflaredReleaseAssetName("darwin", "arm64")).toBe(
      "cloudflared-darwin-arm64.tgz",
    );
    expect(cloudflaredReleaseAssetName("win32", "x64")).toBe(
      "cloudflared-windows-amd64.exe",
    );
  });

  test("resolveCloudflaredInstallVersion redownloads unusable binary even with SKIP_UPDATE", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-cf-skip-"));
    const bad = path.join(dir, "cloudflared");
    fs.writeFileSync(bad, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    try {
      const version = await resolveCloudflaredInstallVersion(bad, {
        CLOUDFLARED_SKIP_UPDATE: "true",
      });
      if (process.platform === "linux") {
        expect(version).toBe("latest");
      } else if (process.platform === "darwin") {
        // Mach-O stub without real binary still fails --version → latest
        expect(version).toBe("latest");
      } else {
        expect(version).toBe("latest");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
