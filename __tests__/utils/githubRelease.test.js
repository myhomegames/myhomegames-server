const { releaseAssetName, tagFromReleaseLocation } = require("../../utils/githubRelease");

describe("githubRelease", () => {
  it("reads an exact asset filename from a release pattern", () => {
    expect(releaseAssetName(/^Sunshine-macOS-arm64\.dmg$/i)).toBe("Sunshine-macOS-arm64.dmg");
    expect(releaseAssetName(/^moonlight-web-aarch64-apple-darwin\.tar\.gz$/i)).toBe(
      "moonlight-web-aarch64-apple-darwin.tar.gz",
    );
  });

  it("reads the release tag from the public latest redirect", () => {
    expect(
      tagFromReleaseLocation(
        "https://github.com/LizardByte/Sunshine/releases/tag/v2026.914.233613",
        "LizardByte/Sunshine",
      ),
    ).toBe("v2026.914.233613");
    expect(
      tagFromReleaseLocation("/MrCreativ3001/moonlight-web-stream/releases/tag/v3.0.0", "MrCreativ3001/moonlight-web-stream"),
    ).toBe("v3.0.0");
    expect(tagFromReleaseLocation("https://github.com/LizardByte/Sunshine", "LizardByte/Sunshine")).toBeNull();
  });
});
