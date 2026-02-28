/**
 * Shared utilities for game-derived items (series, franchises, etc.).
 * These items are derived from game data and use the same structure: content/{folder}/{id}/metadata.json with { title, gameIds: [], showTitle?: boolean }
 */

const path = require("path");
const fs = require("fs");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("./fileUtils");

function toArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/** Only numeric ids; title comes from metadata in mergeWithStored. */
function normalizeItem(item) {
  if (item == null) return null;
  if (typeof item === "number" && !Number.isNaN(item)) return { id: item, title: String(item) };
  return null;
}

function getItemDir(metadataPath, folder, id) {
  return path.join(metadataPath, "content", folder, String(id));
}

function getMetadataPath(metadataPath, folder, id) {
  return path.join(getItemDir(metadataPath, folder, id), "metadata.json");
}

function loadStoredMetadata(metadataPath, folder, id) {
  const filePath = getMetadataPath(metadataPath, folder, id);
  return readJsonFile(filePath, null);
}

function aggregateFromGames(allGames, field) {
  const byId = new Map();
  for (const game of Object.values(allGames)) {
    const raw = game[field];
    const arr = toArray(raw);
    for (const item of arr) {
      const normalized = normalizeItem(item);
      if (normalized && !byId.has(normalized.id)) {
        byId.set(normalized.id, { id: normalized.id, title: normalized.title });
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
}

/** Load all folder dirs and return Map(id -> gameIds[]). */
function getFolderToGameIdsMap(metadataPath, folder) {
  const dir = path.join(metadataPath, "content", folder);
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const name of folders) {
    const id = /^\d+$/.test(name) ? Number(name) : name;
    const meta = readJsonFile(getMetadataPath(metadataPath, folder, id), null);
    const gameIds = meta && Array.isArray(meta.gameIds) ? meta.gameIds : [];
    if (gameIds.length > 0) map.set(id, gameIds);
  }
  return map;
}

function mergeWithStored(metadataPath, folder, items, coverRouteBase) {
  if (!items || items.length === 0) return items;
  return items.map((item) => {
    const meta = loadStoredMetadata(metadataPath, folder, item.id);
    const coverPath = path.join(getItemDir(metadataPath, folder, item.id), "cover.webp");
    const result = { ...item };
    if (meta) {
      if (typeof meta.showTitle === "boolean") result.showTitle = meta.showTitle;
      if (meta.title != null) result.title = String(meta.title).trim();
    }
    const hasCover = fs.existsSync(coverPath);
    result.hasCover = hasCover;
    if (hasCover) result.cover = `${coverRouteBase}/${item.id}/cover.webp`;
    return result;
  });
}

/** Only numeric ids. Returns null for non-numbers. */
function toId(val) {
  if (val == null) return null;
  if (typeof val !== "number" || Number.isNaN(val)) return null;
  return val;
}

/**
 * Resolve array of numeric ids to [{ id, name }, ...].
 * Name is read from content/{folder}/{id}/metadata.json (title). Input: only numbers.
 */
function resolveIdsToObjects(metadataPath, folder, ids) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) return [];
  const seen = new Set();
  const result = [];
  for (const raw of ids) {
    const id = toId(raw);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const meta = loadStoredMetadata(metadataPath, folder, id);
    const name = (meta && meta.title != null ? String(meta.title) : String(id)).trim();
    result.push({ id, name });
  }
  return result;
}

/**
 * Delete derived item from server if no game uses it and it has no cover.
 * Uses gameIds in block metadata (no longer scans allGames).
 * @param {string} metadataPath
 * @param {string} folder - folder name (e.g., "franchises", "series")
 * @param {number} id - item id
 * @param {Object} allGames - optional; unused, kept for API compatibility
 * @returns {boolean} true if deleted
 */
function deleteIfUnused(metadataPath, folder, id, allGames) {
  const meta = readJsonFile(getMetadataPath(metadataPath, folder, id), null);
  const gameIds = meta && Array.isArray(meta.gameIds) ? meta.gameIds : [];
  if (gameIds.length > 0) return false;

  const dir = getItemDir(metadataPath, folder, id);
  const coverPath = path.join(dir, "cover.webp");
  if (fs.existsSync(coverPath)) return false;

  const metaPath = getMetadataPath(metadataPath, folder, id);
  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch (err) {
      console.error(`Failed to delete ${folder} ${id} metadata:`, err.message);
      return false;
    }
  }
  if (fs.existsSync(dir)) {
    try {
      if (typeof fs.rmSync === "function") {
        fs.rmSync(dir, { recursive: true });
      } else {
        removeDirectoryIfEmpty(dir);
      }
    } catch (err) {
      removeDirectoryIfEmpty(dir);
    }
  }
  return true;
}

/** Ensure metadata dir + metadata.json exist. Items: number[] (ids only) or [{ id, name }] for IGDB import. Optional gameId: add to gameIds when creating or when entry exists. */
function ensureExistBatch(metadataPath, items, folder, gameId) {
  if (!items || !Array.isArray(items) || items.length === 0) return;
  for (const raw of items) {
    let id = null;
    let title = null;
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      id = raw;
      title = String(raw);
    } else if (typeof raw === "object" && raw != null && raw.id != null) {
      id = Number(raw.id);
      if (Number.isNaN(id)) continue;
      title = raw.name != null ? String(raw.name).trim() : (raw.title != null ? String(raw.title).trim() : String(id));
    }
    if (id == null || !title) continue;
    const dir = getItemDir(metadataPath, folder, id);
    const metaPath = getMetadataPath(metadataPath, folder, id);
    const existing = readJsonFile(metaPath, null);
    if (existing && existing.title != null) {
      if (gameId != null && typeof gameId === "number") {
        const gameIds = Array.isArray(existing.gameIds) ? existing.gameIds : [];
        if (!gameIds.includes(gameId)) {
          gameIds.push(gameId);
          writeJsonFile(metaPath, { ...existing, gameIds });
        }
      }
      continue;
    }
    ensureDirectoryExists(dir);
    const gameIds = gameId != null && typeof gameId === "number" ? [gameId] : [];
    writeJsonFile(metaPath, { title, showTitle: true, gameIds });
  }
}

module.exports = {
  toArray,
  normalizeItem,
  getItemDir,
  getMetadataPath,
  loadStoredMetadata,
  aggregateFromGames,
  getFolderToGameIdsMap,
  mergeWithStored,
  toId,
  resolveIdsToObjects,
  deleteIfUnused,
  ensureExistBatch,
};
