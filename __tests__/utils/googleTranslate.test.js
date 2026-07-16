const { googleTranslateText, normalizeLangCode } = require("../../utils/googleTranslate");

describe("googleTranslate", () => {
  it("normalizes language codes", () => {
    expect(normalizeLangCode("it-IT")).toBe("it");
    expect(normalizeLangCode("EN")).toBe("en");
  });

  it("translates English to Italian", async () => {
    const translated = await googleTranslateText("Hello world", "it", "en");
    expect(translated).toBeTruthy();
    expect(translated.toLowerCase()).toContain("ciao");
  }, 15000);
});
