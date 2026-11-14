"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureDirectoryExists } = require("./fileUtils");

const CACHE_VERSION = 1;
const CACHE_RELATIVE = path.join("cache", "ai-game-identify.json");
const CHUNK_CACHE_VERSION = 1;
const CHUNK_CACHE_RELATIVE = path.join("cache", "ai-skeleton-chunks.json");

function cacheFilePath(metadataPath) {
  return path.join(String(metadataPath || ""), CACHE_RELATIVE);
}

function chunkCacheFilePath(metadataPath) {
  return path.join(String(metadataPath || ""), CHUNK_CACHE_RELATIVE);
}

function emptyCache() {
  return { version: CACHE_VERSION, entries: {} };
}

function emptyChunkCache() {
  return { version: CHUNK_CACHE_VERSION, chunks: {} };
}

/**
 * Stable key for a skeleton AI request so retries can skip completed chunks.
 */
function hashSkeletonChunk(model, rootName, chunkText) {
  return crypto
    .createHash("sha256")
    .update(`${String(model || "")}\n${String(rootName || "")}\n${String(chunkText || "")}`)
    .digest("hex");
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

function loadSkeletonChunkCache(metadataPath) {
  const filePath = chunkCacheFilePath(metadataPath);
  try {
    if (!filePath || !fs.existsSync(filePath)) return emptyChunkCache();
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || raw.version !== CHUNK_CACHE_VERSION) {
      return emptyChunkCache();
    }
    const chunks =
      raw.chunks && typeof raw.chunks === "object" && !Array.isArray(raw.chunks)
        ? raw.chunks
        : {};
    return { version: CHUNK_CACHE_VERSION, chunks };
  } catch {
    return emptyChunkCache();
  }
}

function saveSkeletonChunkCache(metadataPath, cache) {
  const filePath = chunkCacheFilePath(metadataPath);
  if (!filePath) return null;
  ensureDirectoryExists(path.dirname(filePath));
  const payload = {
    version: CHUNK_CACHE_VERSION,
    chunks:
      cache?.chunks && typeof cache.chunks === "object" && !Array.isArray(cache.chunks)
        ? cache.chunks
        : {},
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function readSkeletonChunk(cache, hash) {
  const key = String(hash || "").trim();
  if (!key || !cache?.chunks) return null;
  const row = cache.chunks[key];
  if (!row || typeof row !== "object" || !Array.isArray(row.games)) return null;
  return {
    games: row.games
      .filter((g) => g && typeof g === "object" && g.path && g.title)
      .map((g) => ({
        path: String(g.path),
        title: String(g.title),
        year: g.year ?? null,
        platform: g.platform ?? null,
        confidence: Math.max(0, Math.min(1, Number(g.confidence) || 0)),
        isGame: true,
      })),
    model: row.model || null,
    updatedAt: row.updatedAt || null,
    fromCache: true,
  };
}

function writeSkeletonChunk(cache, hash, games, meta = {}) {
  const key = String(hash || "").trim();
  if (!key || !cache) return;
  if (!cache.chunks || typeof cache.chunks !== "object") cache.chunks = {};
  const list = Array.isArray(games) ? games : [];
  cache.chunks[key] = {
    games: list
      .filter((g) => g && g.path && g.title)
      .map((g) => ({
        path: String(g.path),
        title: String(g.title),
        year: g.year ?? null,
        platform: g.platform ?? null,
        confidence: g.confidence ?? 0,
      })),
    model: meta.model || null,
    label: meta.label || null,
    updatedAt: Date.now(),
  };
}

module.exports = {
  CACHE_VERSION,
  CACHE_RELATIVE,
  CHUNK_CACHE_VERSION,
  CHUNK_CACHE_RELATIVE,
  cacheFilePath,
  chunkCacheFilePath,
  hashSkeletonChunk,
  loadAiIdentifyCache,
  saveAiIdentifyCache,
  readCacheEntry,
  writeCacheEntry,
  loadSkeletonChunkCache,
  saveSkeletonChunkCache,
  readSkeletonChunk,
  writeSkeletonChunk,
};
