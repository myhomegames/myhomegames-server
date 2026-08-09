"use strict";

const {
  isAllowedSkinReleaseDownloadUrl,
} = require("../../utils/skinDownload");

describe("skinDownload", () => {
  const env = { NODE_ENV: "production", MHG_SKINS_GITHUB_REPO: "myhomegames/myhomegames-skins" };

  test("allows GitHub release zip for configured repo", () => {
    expect(
      isAllowedSkinReleaseDownloadUrl(
        "https://github.com/myhomegames/myhomegames-skins/releases/download/1.1.2/ps3-1.0.2.mhg-skin.zip",
        env
      )
    ).toBe(true);
  });

  test("rejects other hosts and repos", () => {
    expect(isAllowedSkinReleaseDownloadUrl("https://evil.example/a.zip", env)).toBe(false);
    expect(
      isAllowedSkinReleaseDownloadUrl(
        "https://github.com/other/repo/releases/download/1.0.0/ps3-1.0.0.mhg-skin.zip",
        env
      )
    ).toBe(false);
    expect(
      isAllowedSkinReleaseDownloadUrl(
        "https://github.com/myhomegames/myhomegames-skins/archive/refs/heads/main.zip",
        env
      )
    ).toBe(false);
  });

  test("allows localhost zip only in test env", () => {
    expect(
      isAllowedSkinReleaseDownloadUrl("http://127.0.0.1:9/x.mhg-skin.zip", {
        NODE_ENV: "test",
      })
    ).toBe(true);
    expect(
      isAllowedSkinReleaseDownloadUrl("http://127.0.0.1:9/x.mhg-skin.zip", env)
    ).toBe(false);
  });
});
