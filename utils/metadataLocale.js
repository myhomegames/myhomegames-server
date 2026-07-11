const path = require("path");
const fs = require("fs");
const { SUPPORTED_LANGUAGES } = require("./supportedLanguages");
const { readJsonFile } = require("./fileUtils");

const KEYWORD_TRANSLATIONS_FILENAME = "keyword-translations.json";
const CANONICAL_LANG = "en";

function normalizeLocale(lang) {
  const base = String(lang || "").trim().split("-")[0].toLowerCase();
  if (!base) return CANONICAL_LANG;
  if (SUPPORTED_LANGUAGES.includes(base)) return base;
  if (String(lang || "").toLowerCase().startsWith("zh")) return "zh";
  return CANONICAL_LANG;
}

function readSettingsLanguage(metadataPath) {
  const settings = readJsonFile(path.join(metadataPath, "settings.json"), {});
  return normalizeLocale(settings?.language);
}

function resolveRequestLocale(req, metadataPath) {
  const header = req?.headers?.["accept-language"];
  if (typeof header === "string" && header.trim()) {
    const first = header.split(",")[0].trim();
    const fromHeader = normalizeLocale(first);
    if (SUPPORTED_LANGUAGES.includes(fromHeader)) return fromHeader;
  }

  const queryLang = req?.query?.lang;
  if (queryLang) return normalizeLocale(queryLang);

  return readSettingsLanguage(metadataPath);
}

function isSummaryLocaleMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return SUPPORTED_LANGUAGES.some((lang) => typeof value[lang] === "string");
}

function resolveSummary(summary, locale) {
  if (typeof summary === "string") return summary.trim();
  if (!isSummaryLocaleMap(summary)) return "";
  const lang = normalizeLocale(locale);
  const localized = String(summary[lang] || "").trim();
  if (localized) return localized;
  return String(summary[CANONICAL_LANG] || "").trim();
}

function buildKeywordKey(keyword) {
  return String(keyword || "").trim().toLowerCase();
}

/** @type {{ filePath: string|null, mtimeMs: number, store: object|null }} */
const keywordStoreCache = {
  filePath: null,
  mtimeMs: 0,
  store: null,
};

function loadKeywordTranslationsStore(metadataPath) {
  const filePath = path.join(metadataPath, KEYWORD_TRANSLATIONS_FILENAME);
  if (!fs.existsSync(filePath)) {
    keywordStoreCache.filePath = filePath;
    keywordStoreCache.mtimeMs = 0;
    keywordStoreCache.store = { entries: {} };
    return keywordStoreCache.store;
  }

  const stat = fs.statSync(filePath);
  if (
    keywordStoreCache.store
    && keywordStoreCache.filePath === filePath
    && keywordStoreCache.mtimeMs === stat.mtimeMs
  ) {
    return keywordStoreCache.store;
  }

  const raw = readJsonFile(filePath, null);
  const store = raw?.entries && typeof raw.entries === "object"
    ? raw
    : { entries: {} };
  keywordStoreCache.filePath = filePath;
  keywordStoreCache.mtimeMs = stat.mtimeMs;
  keywordStoreCache.store = store;
  return store;
}

function resolveKeyword(keyword, locale, metadataPath) {
  const source = String(keyword || "").trim();
  if (!source) return source;
  const lang = normalizeLocale(locale);
  const store = loadKeywordTranslationsStore(metadataPath);
  const entry = store.entries?.[buildKeywordKey(source)];
  const translated = String(entry?.translations?.[lang] || "").trim();
  if (translated) return translated;
  return source;
}

function applySummaryEdit(existingSummary, locale, newText) {
  const lang = normalizeLocale(locale);
  const trimmed = String(newText ?? "").trim();

  if (isSummaryLocaleMap(existingSummary)) {
    const next = { ...existingSummary };
    if (trimmed) {
      next[lang] = trimmed;
    } else {
      delete next[lang];
    }
    return next;
  }

  const existingText = typeof existingSummary === "string" ? existingSummary.trim() : "";
  if (!trimmed && !existingText) return "";
  if (!trimmed) {
    return lang === CANONICAL_LANG ? "" : existingSummary;
  }

  const next = {};
  if (existingText) next[CANONICAL_LANG] = existingText;
  next[lang] = trimmed;
  return next;
}

function resolveKeywords(keywords, locale, metadataPath) {
  if (!Array.isArray(keywords)) return keywords;
  return keywords.map((keyword) => resolveKeyword(keyword, locale, metadataPath));
}

module.exports = {
  CANONICAL_LANG,
  SUPPORTED_LANGUAGES,
  normalizeLocale,
  readSettingsLanguage,
  resolveRequestLocale,
  isSummaryLocaleMap,
  resolveSummary,
  applySummaryEdit,
  resolveKeyword,
  resolveKeywords,
  loadKeywordTranslationsStore,
};
