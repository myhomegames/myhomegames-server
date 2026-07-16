/**
 * Google Translate (unofficial public endpoint) — server-side proxy.
 */

function parseGoogleTranslateResponse(data) {
  if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0])) return null;
  const parts = data[0].map((part) => part && part[0]).filter(Boolean);
  return parts.length > 0 ? parts.join("") : null;
}

function normalizeLangCode(lang) {
  if (!lang || typeof lang !== "string") return "";
  return lang.trim().split("-")[0].toLowerCase();
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

module.exports = {
  googleTranslateText,
  normalizeLangCode,
};
