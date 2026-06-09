"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadStoredTwitchAppCredentials,
  saveStoredTwitchAppCredentials,
} = require("../../utils/twitchAppCredentialsStore");
const { twitchAppCredentialsPath } = require("../../utils/metadataTokenPaths");

describe("twitchAppCredentialsStore", () => {
  let metadataPath;

  beforeEach(() => {
    metadataPath = path.join(os.tmpdir(), `mhg-twitch-store-${Date.now()}`);
    fs.mkdirSync(metadataPath, { recursive: true });
  });

  afterEach(() => {
    if (metadataPath && fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath, { recursive: true, force: true });
    }
  });

  it("saves and loads credentials under tokens/", () => {
    saveStoredTwitchAppCredentials(metadataPath, {
      clientId: "app-id",
      clientSecret: "app-secret",
    });

    const filePath = twitchAppCredentialsPath(metadataPath);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadStoredTwitchAppCredentials(metadataPath);
    expect(loaded).toEqual(
      expect.objectContaining({
        clientId: "app-id",
        clientSecret: "app-secret",
      })
    );
    expect(typeof loaded.updatedAt).toBe("string");
  });

  it("returns null when file is missing", () => {
    expect(loadStoredTwitchAppCredentials(metadataPath)).toBeNull();
  });
});
