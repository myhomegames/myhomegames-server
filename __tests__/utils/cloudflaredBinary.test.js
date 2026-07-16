const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveWritableCloudflaredBin,
  resolveMacAppBundledCloudflared,
  findBundledCloudflaredBin,
  parseCloudflaredVersion,
  compareCloudflaredVersions,
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
});
