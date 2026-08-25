/**
 * Google Translate — server-side proxy.
 *
 * Prefer translate-pa (Translate Element / te_lib gateway). The legacy
 * translate_a/single?client=gtx endpoint is rate-limited / abuse-walled (429)
 * for many IPs since mid-2026.
 */

/** Public key embedded in Google's te_lib loader (same free-tier semantics as client=gtx). */
const TRANSLATE_PA_API_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const TRANSLATE_PA_ENDPOINT = "https://translate-pa.googleapis.com/v1/translateHtml";

function parseGoogleTranslateResponse(data) {
  if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0])) return null;
  const parts = data[0].map((part) => part && part[0]).filter(Boolean);
  if (parts.length === 0) return null;
  return normalizeTranslatedText(parts.join(""));
}

/**
 * Clean MT output: drop zero-width chars and ensure a space after sentence
 * punctuation when Google returns adjacent segments like "…loro.Il sergente…".
 * Requires a lowercase letter before the punctuation so abbreviations like
 * "J.R.R." / "D.C." stay intact. Decimals (digit after ".") are untouched.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeTranslatedText(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/(?<=\p{Ll})([.!?…])(?=\p{L})/gu, "$1 ")
    .replace(/[ \t]{2,}/g, " ");
}

function normalizeLangCode(lang) {
  if (!lang || typeof lang !== "string") return "";
  return lang.trim().split("-")[0].toLowerCase();
}

function escapeHtmlForTranslate(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtmlFromTranslate(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * translateHtml collapses newlines to spaces; send one array element per line.
 * @param {string} text
 * @param {string} source
 * @param {string} target
 * @returns {Promise<string|null>}
 */
async function translateViaTranslatePa(text, source, target) {
  const lines = String(text).split("\n");
  const sentIndices = [];
  const payload = [];
  lines.forEach((line, i) => {
    if (line.trim()) {
      sentIndices.push(i);
      payload.push(escapeHtmlForTranslate(line));
    }
  });
  if (payload.length === 0) return text;

  const response = await fetch(TRANSLATE_PA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": TRANSLATE_PA_API_KEY,
    },
    body: JSON.stringify([[payload, source, target], "te_lib"]),
  });
  if (!response.ok) return null;

  const data = await response.json();
  if (!Array.isArray(data?.[0])) return null;
  const translated = data[0];
  const out = [...lines];
  for (let j = 0; j < sentIndices.length; j++) {
    const t = translated[j];
    if (typeof t !== "string") return null;
    out[sentIndices[j]] = unescapeHtmlFromTranslate(t);
  }
  return normalizeTranslatedText(out.join("\n"));
}

/**
 * Legacy translate_a/single?client=gtx — kept as fallback when translate-pa fails.
 * @param {string} text
 * @param {string} source
 * @param {string} target
 * @returns {Promise<string|null>}
 */
async function translateViaLegacyGtx(text, source, target) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${encodeURIComponent(source)}` +
    `&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return parseGoogleTranslateResponse(data);
}

/**
 * Translate one or more strings in a single translate-pa request (one element each).
 * @param {string[]} texts
 * @param {string} targetLang
 * @param {string} [sourceLang='en']
 * @returns {Promise<string[]|null>} translated strings in the same order, or null on failure
 */
async function googleTranslateTexts(texts, targetLang, sourceLang = "en") {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const source = normalizeLangCode(sourceLang) || "en";
  const target = normalizeLangCode(targetLang);
  if (!target || target === source) {
    return texts.map((t) => String(t || ""));
  }

  const payload = texts.map((t) => escapeHtmlForTranslate(String(t || "")));
  // Empty strings 400 on translateHtml — send a placeholder and restore after.
  const placeholders = payload.map((p, i) => (p.trim() ? p : `\u0000${i}`));

  try {
    const response = await fetch(TRANSLATE_PA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json+protobuf",
        "X-Goog-API-Key": TRANSLATE_PA_API_KEY,
      },
      body: JSON.stringify([[placeholders, source, target], "te_lib"]),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data?.[0]) || data[0].length !== texts.length) return null;
    return data[0].map((t, i) => {
      if (typeof t !== "string") return String(texts[i] || "");
      if (!String(texts[i] || "").trim()) return String(texts[i] || "");
      return normalizeTranslatedText(unescapeHtmlFromTranslate(t));
    });
  } catch (err) {
    console.warn(
      "Google Translate batch (translate-pa) failed:",
      err?.message || err,
    );
    return null;
  }
}

/**
 * @param {string} text
 * @param {string} targetLang
 * @param {string} [sourceLang='en']
 * @returns {Promise<string|null>}
 */
async function googleTranslateText(text, targetLang, sourceLang = "en") {
  const source = normalizeLangCode(sourceLang) || "en";
  const target = normalizeLangCode(targetLang);
  if (!text || !target || target === source) return text || null;

  try {
    const viaPa = await translateViaTranslatePa(text, source, target);
    if (viaPa != null && viaPa !== "") return viaPa;
  } catch (err) {
    console.warn(
      "Google Translate (translate-pa) failed:",
      err?.message || err,
    );
  }

  try {
    return await translateViaLegacyGtx(text, source, target);
  } catch (err) {
    console.warn(
      "Google Translate (legacy gtx) failed:",
      err?.message || err,
    );
    return null;
  }
}

module.exports = {
  googleTranslateText,
  googleTranslateTexts,
  normalizeLangCode,
  normalizeTranslatedText,
};
