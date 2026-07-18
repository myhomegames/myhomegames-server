const {
  normalizeMoonlightWebUrl,
  readStreamingSettings,
  validateStreamingSettingsPatch,
} = require("../../utils/streaming");

describe("streaming settings", () => {
  it("normalizes moonlight web URLs", () => {
    expect(normalizeMoonlightWebUrl("https://stream.example.com:8080/")).toBe(
      "https://stream.example.com:8080",
    );
    expect(normalizeMoonlightWebUrl("ftp://bad")).toBe("");
  });

  it("requires URL for effective remote streaming", () => {
    const settings = readStreamingSettings({
      remoteStreamingEnabled: true,
      moonlightWebUrl: "",
    });
    expect(settings.remoteStreamingEnabled).toBe(false);
    const ready = readStreamingSettings({
      remoteStreamingEnabled: true,
      moonlightWebUrl: "https://stream.example.com",
    });
    expect(ready.remoteStreamingEnabled).toBe(true);
    expect(ready.moonlightWebUrl).toBe("https://stream.example.com");
  });

  it("validates settings patch", () => {
    expect(validateStreamingSettingsPatch({ remoteStreamingEnabled: true }).ok).toBe(true);
    const invalid = validateStreamingSettingsPatch({ moonlightWebUrl: "not-a-url" });
    expect(invalid.ok).toBe(false);
  });
});
