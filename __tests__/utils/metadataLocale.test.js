const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveSummary,
  resolveKeyword,
  resolveKeywords,
  resolveRequestLocale,
  applySummaryEdit,
} = require("../../utils/metadataLocale");
const { writeJsonFile } = require("../../utils/fileUtils");

describe("metadataLocale", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-locale-"));
    writeJsonFile(path.join(tempDir, "settings.json"), { language: "it" });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves summary from locale map with english fallback", () => {
    const summary = {
      en: "Hello",
      it: "Ciao",
      pt: "",
      es: "",
      fr: "",
      de: "",
      zh: "",
      ja: "",
    };
    expect(resolveSummary(summary, "it")).toBe("Ciao");
    expect(resolveSummary(summary, "pt")).toBe("Hello");
  });

  it("resolves keywords via dictionary", () => {
    writeJsonFile(path.join(tempDir, "keyword-translations.json"), {
      version: 1,
      entries: {
        thief: {
          translations: {
            en: "Thief",
            it: "Ladro",
            pt: "Ladrão",
            es: "Ladrón",
            fr: "Voleur",
            de: "Dieb",
            zh: "贼",
            ja: "泥棒",
          },
        },
      },
    });

    expect(resolveKeyword("thief", "it", tempDir)).toBe("Ladro");
    expect(resolveKeywords(["thief", "unknown"], "it", tempDir)).toEqual(["Ladro", "unknown"]);
  });

  it("prefers Accept-Language over settings", () => {
    const locale = resolveRequestLocale({
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
      query: {},
    }, tempDir);
    expect(locale).toBe("fr");
  });

  it("merges summary edits into locale map without overwriting other locales", () => {
    const existing = { en: "Hello", it: "Ciao" };
    expect(applySummaryEdit(existing, "it", "Salve")).toEqual({ en: "Hello", it: "Salve" });
    expect(applySummaryEdit("Plain text", "it", "Testo")).toEqual({ en: "Plain text", it: "Testo" });
  });
});
