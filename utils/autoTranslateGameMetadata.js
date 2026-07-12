const { googleTranslateText } = require("./googleTranslate");
const { SUPPORTED_LANGUAGES } = require("./supportedLanguages");
const {
  CANONICAL_LANG,
  isSummaryLocaleMap,
  normalizeLocale,
  buildKeywordKey,
  loadKeywordTranslationsStore,
  saveKeywordTranslationsStore,
} = require("./metadataLocale");

async function buildImportSummaryLocaleMap({ summaryEn, summaryLocalized, locale }) {
  if (isSummaryLocaleMap(summaryEn)) return summaryEn;

  const english = String(summaryEn || "").trim();
  if (!english) return "";

  const lang = normalizeLocale(locale);
  /** @type {Record<string, string>} */
  const localeMap = { [CANONICAL_LANG]: english };

  const localized = String(summaryLocalized || "").trim();
  if (lang !== CANONICAL_LANG && localized && localized !== english) {
    localeMap[lang] = localized;
  }

  await Promise.all(
    SUPPORTED_LANGUAGES.filter((l) => l !== CANONICAL_LANG && !String(localeMap[l] || "").trim()).map(async (l) => {
      const translated = await googleTranslateText(english, l, CANONICAL_LANG);
      localeMap[l] = translated ? String(translated).trim() : "";
    }),
  );
  return localeMap;
}

async function upsertKeywordTranslation(metadataPath, keyword, sourceLang = CANONICAL_LANG) {
  const source = String(keyword || "").trim();
  if (!source) return;

  const store = loadKeywordTranslationsStore(metadataPath);
  if (!store.entries || typeof store.entries !== "object") {
    store.entries = {};
  }

  const key = buildKeywordKey(source);
  const existing = store.entries[key]?.translations && typeof store.entries[key].translations === "object"
    ? store.entries[key].translations
    : {};
  /** @type {Record<string, string>} */
  const translations = { ...existing, [sourceLang]: source };

  await Promise.all(
    SUPPORTED_LANGUAGES.filter((lang) => lang !== sourceLang).map(async (lang) => {
      if (String(translations[lang] || "").trim()) return;
      const translated = await googleTranslateText(source, lang, sourceLang);
      if (translated) translations[lang] = String(translated).trim();
    }),
  );

  store.entries[key] = { translations };
  saveKeywordTranslationsStore(metadataPath, store);
}

async function autoTranslateKeywordsForImport(metadataPath, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return;
  const unique = [...new Set(keywords.map((item) => String(item || "").trim()).filter(Boolean))];
  for (const keyword of unique) {
    await upsertKeywordTranslation(metadataPath, keyword);
  }
}

async function autoTranslateNewCompanySummary(summary, locale = CANONICAL_LANG) {
  if (isSummaryLocaleMap(summary)) return summary;
  const english = typeof summary === "string" ? summary.trim() : "";
  if (!english) return "";
  return buildImportSummaryLocaleMap({
    summaryEn: english,
    locale,
  });
}

async function autoTranslateSummaryForImport(summary, options = {}) {
  if (isSummaryLocaleMap(summary)) return summary;
  return buildImportSummaryLocaleMap({
    summaryEn: summary,
    summaryLocalized: options.summaryLocalized,
    locale: options.locale || CANONICAL_LANG,
  });
}

/**
 * Persist multilingual summary map and shared keyword translations on IGDB import.
 * @param {{ summaryEn?: string, summaryLocalized?: string, summary?: string, keywords?: string[] | null }} fields
 * @param {string} metadataPath
 * @param {string} [locale]
 */
async function autoTranslateImportedGameFields(fields, metadataPath, locale = CANONICAL_LANG) {
  const englishSummary = fields?.summaryEn ?? fields?.summary;
  const summary = await buildImportSummaryLocaleMap({
    summaryEn: englishSummary,
    summaryLocalized: fields?.summaryLocalized,
    locale,
  });
  await autoTranslateKeywordsForImport(metadataPath, fields?.keywords || []);
  return { summary };
}

module.exports = {
  autoTranslateImportedGameFields,
  autoTranslateSummaryForImport,
  autoTranslateNewCompanySummary,
  autoTranslateKeywordsForImport,
  buildImportSummaryLocaleMap,
  upsertKeywordTranslation,
};
