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
  retranslateAllSummaryLocales,
  refreshKeywordTranslation,
} = require("../../utils/autoTranslateGameMetadata");
const {
  resolveSummary,
  resolveKeyword,
  loadKeywordTranslationsStore,
} = require("../../utils/metadataLocale");
const { writeJsonFile } = require("../../utils/fileUtils");

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

  it("auto-translates new company summary into locale map", async () => {
    const { autoTranslateNewCompanySummary } = require("../../utils/autoTranslateGameMetadata");
    const summaryMap = await autoTranslateNewCompanySummary(
      "Nintendo is a Japanese video game company.",
      "it",
    );
    expect(summaryMap.en).toBe("Nintendo is a Japanese video game company.");
    expect(summaryMap.it).toBe("[it] Nintendo is a Japanese video game company.");
  });

  it("retranslates every summary locale from edited popup text", async () => {
    const summaryMap = await retranslateAllSummaryLocales("Testo modificato", "it");

    expect(summaryMap.it).toBe("Testo modificato");
    expect(summaryMap.en).toBe("[en] Testo modificato");
    expect(summaryMap.fr).toBe("[fr] Testo modificato");
    expect(googleTranslateText).toHaveBeenCalledTimes(7);
  });

  it("refreshes every keyword locale when edited in the popup", async () => {
    writeJsonFile(path.join(tempDir, "keyword-translations.json"), {
      version: 1,
      entries: {
        stealth: {
          translations: {
            en: "Stealth",
            it: "Furtività vecchia",
          },
        },
      },
    });

    await refreshKeywordTranslation(tempDir, "Furtività", "it");

    const store = loadKeywordTranslationsStore(tempDir);
    expect(store.entries.furtività.translations.it).toBe("Furtività");
    expect(store.entries.furtività.translations.en).toBe("[en] Furtività");
    expect(store.entries.furtività.translations.fr).toBe("[fr] Furtività");
  });
});
