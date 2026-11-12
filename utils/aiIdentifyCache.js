"use strict";

const fs = require("fs");
const path = require("path");
const { ensureDirectoryExists } = require("./fileUtils");

const CACHE_VERSION = 1;
const CACHE_RELATIVE = path.join("cache", "ai-game-identify.json");

function cacheFilePath(metadataPath) {
  return path.join(String(metadataPath || ""), CACHE_RELATIVE);
}

function emptyCache() {
  return { version: CACHE_VERSION, entries: {} };
}

/**
 * Load persisted AI identify results (keyed by normalizeTitleKey of folder/file basename).
 * Cache stores AI answers only — never heuristic titles.
 */
function loadAiIdentifyCache(metadataPath) {
  const filePath = cacheFilePath(metadataPath);
  try {
    if (!filePath || !fs.existsSync(filePath)) return emptyCache();
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || raw.version !== CACHE_VERSION) return emptyCache();
    const entries =
      raw.entries && typeof raw.entries === "object" && !Array.isArray(raw.entries)
        ? raw.entries
        : {};
    return { version: CACHE_VERSION, entries };
  } catch {
    return emptyCache();
  }
}

function saveAiIdentifyCache(metadataPath, cache) {
  const filePath = cacheFilePath(metadataPath);
  if (!filePath) return null;
  ensureDirectoryExists(path.dirname(filePath));
  const payload = {
    version: CACHE_VERSION,
    entries:
      cache?.entries && typeof cache.entries === "object" && !Array.isArray(cache.entries)
        ? cache.entries
        : {},
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function readCacheEntry(cache, key) {
  const k = String(key || "").trim();
  if (!k || !cache?.entries) return null;
  const row = cache.entries[k];
  if (!row || typeof row !== "object") return null;
  const title = row.title != null ? String(row.title).trim() : null;
  const isGame = row.isGame !== false && Boolean(title);
  const yearNum = Number(row.year);
  return {
    isGame,
    title: isGame ? title : null,
    year: Number.isFinite(yearNum) && yearNum >= 1970 && yearNum <= 2100 ? Math.floor(yearNum) : null,
    platform: row.platform != null ? String(row.platform).trim() || null : null,
    confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
    fromCache: true,
  };
}

function writeCacheEntry(cache, key, row, meta = {}) {
  const k = String(key || "").trim();
  if (!k || !cache) return;
  if (!cache.entries || typeof cache.entries !== "object") cache.entries = {};
  if (!row) return;
  cache.entries[k] = {
    isGame: row.isGame !== false && Boolean(row.title),
    title: row.title || null,
    year: row.year ?? null,
    platform: row.platform ?? null,
    confidence: row.confidence ?? 0,
    model: meta.model || null,
    updatedAt: Date.now(),
  };
}

module.exports = {
  CACHE_VERSION,
  CACHE_RELATIVE,
  cacheFilePath,
  loadAiIdentifyCache,
  saveAiIdentifyCache,
  readCacheEntry,
  writeCacheEntry,
};
