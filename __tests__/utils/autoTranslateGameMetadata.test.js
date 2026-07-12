jest.mock("../../utils/googleTranslate", () => ({
  googleTranslateText: jest.fn(async (text, targetLang) => `[${targetLang}] ${text}`),
  normalizeLangCode: jest.requireActual("../../utils/googleTranslate").normalizeLangCode,
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { googleTranslateText } = require("../../utils/googleTranslate");
const {
  autoTranslateSummaryForImport,
  autoTranslateKeywordsForImport,
  autoTranslateImportedGameFields,
  buildImportSummaryLocaleMap,
} = require("../../utils/autoTranslateGameMetadata");
const {
  resolveSummary,
  resolveKeyword,
  loadKeywordTranslationsStore,
} = require("../../utils/metadataLocale");

describe("autoTranslateGameMetadata", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-auto-translate-"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps English canonical text in en when importing with a localized summary", async () => {
    const summaryMap = await buildImportSummaryLocaleMap({
      summaryEn: "English summary",
      summaryLocalized: "Riassunto italiano",
      locale: "it",
    });

    expect(summaryMap.en).toBe("English summary");
    expect(summaryMap.it).toBe("Riassunto italiano");
    expect(summaryMap.fr).toBe("[fr] English summary");
    expect(googleTranslateText).not.toHaveBeenCalledWith("Riassunto italiano", "it", "en");
  });

  it("auto-translates missing locales from English only", async () => {
    const summaryMap = await autoTranslateSummaryForImport("English summary", { locale: "it" });
    expect(summaryMap.en).toBe("English summary");
    expect(summaryMap.it).toBe("[it] English summary");
  });

  it("stores keyword translations in the shared dictionary", async () => {
    await autoTranslateKeywordsForImport(tempDir, ["Stealth"]);
    const store = loadKeywordTranslationsStore(tempDir);
    expect(store.entries.stealth.translations.en).toBe("Stealth");
    expect(store.entries.stealth.translations.it).toBe("[it] Stealth");
  });

  it("auto-translates summary and keywords together on import", async () => {
    const { summary } = await autoTranslateImportedGameFields(
      {
        summaryEn: "Hello",
        summaryLocalized: "Ciao",
        keywords: ["Thief"],
      },
      tempDir,
      "it",
    );

    expect(resolveSummary(summary, "en")).toBe("Hello");
    expect(resolveSummary(summary, "it")).toBe("Ciao");
    expect(resolveKeyword("Thief", "it", tempDir)).toBe("[it] Thief");
  });
});
