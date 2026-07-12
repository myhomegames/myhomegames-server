jest.mock("../../utils/googleTranslate", () => ({
  googleTranslateText: jest.fn(async (text, targetLang) => `[${targetLang}] ${text}`),
  normalizeLangCode: jest.requireActual("../../utils/googleTranslate").normalizeLangCode,
}));

const { googleTranslateText } = require("../../utils/googleTranslate");
const {
  applyTranslatedSummariesToGames,
  translateIgdbSummary,
  translateUniqueTexts,
} = require("../../utils/translateIgdbSummaries");

describe("translateIgdbSummaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns games unchanged for English locale", async () => {
    const games = [{ id: 1, summary: "English summary" }];
    const result = await applyTranslatedSummariesToGames(games, "en");
    expect(result).toEqual([{ id: 1, summary: "English summary", summaryEn: "English summary" }]);
    expect(googleTranslateText).not.toHaveBeenCalled();
  });

  it("batch-translates search summaries in one call when possible", async () => {
    googleTranslateText.mockImplementationOnce(async (text, targetLang) => {
      const parts = String(text).split("\u001e");
      return parts.map((part) => `[${targetLang}] ${part}`).join("\u001e");
    });

    const games = [
      { id: 1, summary: "First summary" },
      { id: 2, summary: "Second summary" },
    ];
    const result = await applyTranslatedSummariesToGames(games, "it");
    expect(googleTranslateText).toHaveBeenCalledTimes(1);
    expect(result[0].summaryEn).toBe("First summary");
    expect(result[0].summary).toBe("[it] First summary");
    expect(result[1].summaryEn).toBe("Second summary");
    expect(result[1].summary).toBe("[it] Second summary");
  });

  it("splits batch output when delimiter is preserved", async () => {
    googleTranslateText.mockImplementationOnce(async (text, targetLang) => {
      const parts = String(text).split("\u001e");
      return parts.map((part) => `[${targetLang}] ${part}`).join("\u001e");
    });

    const result = await applyTranslatedSummariesToGames(
      [
        { id: 1, summary: "Line one.\n\nLine two." },
        { id: 2, summary: "Another summary." },
      ],
      "it",
    );

    expect(result[0].summary).toBe("[it] Line one.\n\nLine two.");
    expect(result[1].summary).toBe("[it] Another summary.");
  });

  it("translates a single summary", async () => {
    const summary = await translateIgdbSummary("Hello world", "it");
    expect(summary).toBe("[it] Hello world");
  });

  it("falls back to per-text translation when batch split fails", async () => {
    googleTranslateText
      .mockResolvedValueOnce("broken batch output")
      .mockResolvedValueOnce("[it] First")
      .mockResolvedValueOnce("[it] Second");

    const translated = await translateUniqueTexts(["First", "Second"], "it");
    expect(googleTranslateText).toHaveBeenCalledTimes(3);
    expect(translated).toEqual(["[it] First", "[it] Second"]);
  });
});
