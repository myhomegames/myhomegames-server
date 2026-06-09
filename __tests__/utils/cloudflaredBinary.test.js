const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveWritableCloudflaredBin,
  resolveMacAppBundledCloudflared,
  findBundledCloudflaredBin,
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
