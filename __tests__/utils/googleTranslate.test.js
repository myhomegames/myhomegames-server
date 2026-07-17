const {
  googleTranslateText,
  normalizeLangCode,
  normalizeTranslatedText,
} = require("../../utils/googleTranslate");

describe("googleTranslate", () => {
  it("normalizes language codes", () => {
    expect(normalizeLangCode("it-IT")).toBe("it");
    expect(normalizeLangCode("EN")).toBe("en");
  });

  it("inserts a space after sentence punctuation before a letter", () => {
    expect(
      normalizeTranslatedText(
        "sotto di loro.Il sergente Marcus Fenix guida la Squadra Delta.",
      ),
    ).toBe("sotto di loro. Il sergente Marcus Fenix guida la Squadra Delta.");
  });

  it("strips zero-width spaces and preserves decimals", () => {
    expect(normalizeTranslatedText("Fenix\u200b\u200b guida")).toBe("Fenix guida");
    expect(normalizeTranslatedText("Version 3.14 is fine")).toBe("Version 3.14 is fine");
  });

  it("translates English to Italian", async () => {
    const translated = await googleTranslateText("Hello world", "it", "en");
    expect(translated).toBeTruthy();
    expect(translated.toLowerCase()).toContain("ciao");
  }, 15000);
});
