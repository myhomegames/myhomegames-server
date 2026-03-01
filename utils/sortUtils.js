/**
 * Returns a string suitable for title sorting, ignoring leading "The " and "A " (case insensitive).
 * Use with localeCompare for consistent ordering (e.g. "The Legend of Zelda" sorts under L).
 */
function getTitleForSort(title) {
  if (title == null || typeof title !== "string") return "";
  return String(title).trim().replace(/^(The|A)\s+/i, "").trim();
}

module.exports = { getTitleForSort };
