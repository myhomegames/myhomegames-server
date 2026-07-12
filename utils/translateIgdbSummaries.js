const { googleTranslateText, normalizeLangCode } = require("./googleTranslate");
const { normalizeLocale } = require("./metadataLocale");

/** Summaries may contain `\n`; do not use it as a batch delimiter. */
const BATCH_SEP = "\u001e";

async function translateText(text, targetLang, sourceLang = "en") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;
  const target = normalizeLangCode(targetLang);
  const source = normalizeLangCode(sourceLang) || "en";
  if (!target || target === source) return trimmed;
  const translated = await googleTranslateText(trimmed, target, source);
  return translated ? String(translated).trim() : trimmed;
}

async function translateUniqueTexts(uniqueTexts, targetLang) {
  if (uniqueTexts.length === 0) return [];
  if (uniqueTexts.length === 1) {
    return [await translateText(uniqueTexts[0], targetLang)];
  }

  const combined = uniqueTexts.join(BATCH_SEP);
  const translated = await translateText(combined, targetLang);
  if (translated) {
    const parts = translated.split(BATCH_SEP).map((part) => part.trim());
    if (parts.length === uniqueTexts.length) return parts;
  }

  return Promise.all(uniqueTexts.map((text) => translateText(text, targetLang)));
}

/**
 * Batch-translate IGDB game summaries for the requested locale.
 * @param {Array<{ id: number, summary?: string }>} games
 * @param {string} locale
 * @returns {Promise<Array<{ id: number, summary?: string }>>}
 */
async function applyTranslatedSummariesToGames(games, locale) {
  if (!Array.isArray(games) || games.length === 0) return games;

  const targetLang = normalizeLocale(locale);
  if (targetLang === "en") return games;

  const textToIds = new Map();
  for (const game of games) {
    const summary = String(game.summary || "").trim();
    if (!summary) continue;
    if (!textToIds.has(summary)) textToIds.set(summary, []);
    textToIds.get(summary).push(game.id);
  }

  if (textToIds.size === 0) return games;

  const uniqueTexts = [...textToIds.keys()];
  const translatedTexts = await translateUniqueTexts(uniqueTexts, targetLang);
  const translatedById = new Map();

  uniqueTexts.forEach((sourceText, index) => {
    const translated = translatedTexts[index] ?? sourceText;
    for (const id of textToIds.get(sourceText) || []) {
      translatedById.set(id, translated);
    }
  });

  return games.map((game) => {
    const translated = translatedById.get(game.id);
    if (!translated) return game;
    return { ...game, summary: translated };
  });
}

/**
 * @param {string} summary
 * @param {string} locale
 * @returns {Promise<string>}
 */
async function translateIgdbSummary(summary, locale) {
  const trimmed = String(summary || "").trim();
  if (!trimmed) return trimmed;
  const targetLang = normalizeLocale(locale);
  if (targetLang === "en") return trimmed;
  return translateText(trimmed, targetLang);
}

module.exports = {
  applyTranslatedSummariesToGames,
  translateIgdbSummary,
  translateUniqueTexts,
};
