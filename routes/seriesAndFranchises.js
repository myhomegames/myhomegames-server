/**
 * Series and franchises: list derived from games + optional metadata/cover per id.
 */

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");

/** Ensure metadata dir + metadata.json exist. Items: number[] (ids only) or [{ id, name }] for IGDB import. Optional gameId: add to gameIds when creating or when entry exists. */
function ensureFranchiseSeriesExistBatch(metadataPath, items, folder, gameId) {
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

/** Add gameId to a franchise's gameIds. */
function addGameToFranchise(metadataPath, franchiseId, gameId) {
  const metaPath = getMetadataPath(metadataPath, "franchises", franchiseId);
  const meta = readJsonFile(metaPath, null) || { title: String(franchiseId), showTitle: true, gameIds: [] };
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  if (gameIds.includes(gameId)) return false;
  meta.gameIds = [...gameIds, gameId];
  ensureDirectoryExists(getItemDir(metadataPath, "franchises", franchiseId));
  writeJsonFile(metaPath, meta);
  return true;
}

/** Add gameId to a series' gameIds. */
function addGameToSeries(metadataPath, seriesId, gameId) {
  const metaPath = getMetadataPath(metadataPath, "series", seriesId);
  const meta = readJsonFile(metaPath, null) || { title: String(seriesId), showTitle: true, gameIds: [] };
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  if (gameIds.includes(gameId)) return false;
  meta.gameIds = [...gameIds, gameId];
  ensureDirectoryExists(getItemDir(metadataPath, "series", seriesId));
  writeJsonFile(metaPath, meta);
  return true;
}

/** Remove gameId from a franchise's gameIds. */
function removeGameFromFranchise(metadataPath, franchiseId, gameId) {
  const metaPath = getMetadataPath(metadataPath, "franchises", franchiseId);
  const meta = readJsonFile(metaPath, null);
  if (!meta) return false;
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  const next = gameIds.filter((g) => Number(g) !== Number(gameId));
  if (next.length === gameIds.length) return false;
  writeJsonFile(metaPath, { ...meta, gameIds: next });
  return true;
}

/** Remove gameId from a series' gameIds. */
function removeGameFromSeries(metadataPath, seriesId, gameId) {
  const metaPath = getMetadataPath(metadataPath, "series", seriesId);
  const meta = readJsonFile(metaPath, null);
  if (!meta) return false;
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  const next = gameIds.filter((g) => Number(g) !== Number(gameId));
  if (next.length === gameIds.length) return false;
  writeJsonFile(metaPath, { ...meta, gameIds: next });
  return true;
}

/** Load all franchise/series dirs and return Map(id -> gameIds[]). */
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

function getFranchiseToGameIdsMap(metadataPath) {
  return getFolderToGameIdsMap(metadataPath, "franchises");
}

function getSeriesToGameIdsMap(metadataPath) {
  return getFolderToGameIdsMap(metadataPath, "series");
}

/** Remove gameId from all franchise and series blocks. */
function removeGameFromAllFranchiseAndSeriesBlocks(metadataPath, gameId) {
  for (const [franchiseId, gameIds] of getFranchiseToGameIdsMap(metadataPath)) {
    if (gameIds.includes(gameId)) removeGameFromFranchise(metadataPath, franchiseId, gameId);
  }
  for (const [seriesId, gameIds] of getSeriesToGameIdsMap(metadataPath)) {
    if (gameIds.includes(gameId)) removeGameFromSeries(metadataPath, seriesId, gameId);
  }
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
    if (fs.existsSync(coverPath)) result.cover = `${coverRouteBase}/${item.id}/cover.webp`;
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
function resolveFranchiseOrSeriesIdsToObjects(metadataPath, folder, ids) {
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

function resolveFranchiseIdsToObjects(metadataPath, idsOrObjects) {
  return resolveFranchiseOrSeriesIdsToObjects(metadataPath, "franchises", idsOrObjects);
}

function resolveSeriesIdsToObjects(metadataPath, idsOrObjects) {
  return resolveFranchiseOrSeriesIdsToObjects(metadataPath, "series", idsOrObjects);
}

/**
 * Delete franchise or series from server if no game uses it and it has no cover.
 * Uses gameIds in block metadata (no longer scans allGames).
 * @param {string} metadataPath
 * @param {"franchises"|"series"} folder - "franchises" or "series"
 * @param {number} id - franchise/series id
 * @param {Object} allGames - optional; unused, kept for API compatibility
 * @returns {boolean} true if deleted
 */
function deleteFranchiseOrSeriesIfUnused(metadataPath, folder, id, allGames) {
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

function registerSeriesAndFranchisesRoutes(app, requireToken, allGames, metadataPath) {
  const upload = multer({ storage: multer.memoryStorage() });

  // GET /series – list from games + stored metadata/cover
  app.get("/series", requireToken, (req, res) => {
    const items = aggregateFromGames(allGames, "collection");
    const merged = mergeWithStored(metadataPath, "series", items, "/series");
    res.json({ series: merged });
  });

  // GET /franchises
  app.get("/franchises", requireToken, (req, res) => {
    const items = aggregateFromGames(allGames, "franchise");
    const merged = mergeWithStored(metadataPath, "franchises", items, "/franchises");
    res.json({ franchises: merged });
  });

  const putUpdate = (routeBase, folder, responseKey) => {
    app.put(`${routeBase}/:id`, requireToken, (req, res) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const baseList = routeBase === "/series"
        ? aggregateFromGames(allGames, "collection")
        : aggregateFromGames(allGames, "franchise");
      const item = baseList.find((x) => x.id === id);
      if (!item) return res.status(404).json({ error: "Not found" });
      const meta = loadStoredMetadata(metadataPath, folder, id) || { title: item.title, showTitle: true, gameIds: [] };
      if (typeof req.body.showTitle === "boolean") meta.showTitle = req.body.showTitle;
      if (!Array.isArray(meta.gameIds)) meta.gameIds = [];
      const dir = getItemDir(metadataPath, folder, id);
      ensureDirectoryExists(dir);
      writeJsonFile(getMetadataPath(metadataPath, folder, id), meta);
      const coverPath = path.join(dir, "cover.webp");
      const out = { id, title: item.title, showTitle: meta.showTitle };
      if (fs.existsSync(coverPath)) out.cover = `${routeBase}/${id}/cover.webp`;
      res.json({ [responseKey]: out });
    });
  };

  const uploadCover = (routeBase, folder, responseKey) => {
    app.post(`${routeBase}/:id/upload-cover`, requireToken, upload.single("file"), (req, res) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const baseList = routeBase === "/series"
        ? aggregateFromGames(allGames, "collection")
        : aggregateFromGames(allGames, "franchise");
      const item = baseList.find((x) => x.id === id);
      if (!item) return res.status(404).json({ error: "Not found" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });
      if (!file.mimetype.startsWith("image/")) return res.status(400).json({ error: "File must be an image" });
      try {
        const dir = getItemDir(metadataPath, folder, id);
        ensureDirectoryExists(dir);
        const meta = loadStoredMetadata(metadataPath, folder, id) || { title: item.title, showTitle: true, gameIds: [] };
        if (!Array.isArray(meta.gameIds)) meta.gameIds = [];
        writeJsonFile(getMetadataPath(metadataPath, folder, id), meta);
        const coverPath = path.join(dir, "cover.webp");
        fs.writeFileSync(coverPath, file.buffer);
        res.json({ [responseKey]: { id, title: item.title, cover: `${routeBase}/${id}/cover.webp` } });
      } catch (err) {
        console.error(`Failed to save cover for ${responseKey} ${id}:`, err.message);
        res.status(500).json({ error: "Failed to save cover" });
      }
    });
  };

  const deleteCover = (routeBase, folder, responseKey) => {
    app.delete(`${routeBase}/:id/delete-cover`, requireToken, (req, res) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const baseList = routeBase === "/series"
        ? aggregateFromGames(allGames, "collection")
        : aggregateFromGames(allGames, "franchise");
      const item = baseList.find((x) => x.id === id);
      if (!item) return res.status(404).json({ error: "Not found" });
      try {
        const coverPath = path.join(getItemDir(metadataPath, folder, id), "cover.webp");
        if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
        res.json({ [responseKey]: { id, title: item.title } });
      } catch (err) {
        console.error(`Failed to delete cover for ${responseKey} ${id}:`, err.message);
        res.status(500).json({ error: "Failed to delete cover" });
      }
    });
  };

  const serveCover = (routeBase, folder) => {
    app.get(`${routeBase}/:id/cover.webp`, (req, res) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const coverPath = path.join(getItemDir(metadataPath, folder, id), "cover.webp");
      if (!fs.existsSync(coverPath)) return res.status(404).end();
      res.type("image/webp");
      res.sendFile(path.resolve(coverPath));
    });
  };

  putUpdate("/series", "series", "series");
  uploadCover("/series", "series", "series");
  deleteCover("/series", "series", "series");
  serveCover("/series", "series");

  putUpdate("/franchises", "franchises", "franchise");
  uploadCover("/franchises", "franchises", "franchise");
  deleteCover("/franchises", "franchises", "franchise");
  serveCover("/franchises", "franchises");
}

module.exports = {
  registerSeriesAndFranchisesRoutes,
  ensureFranchiseSeriesExistBatch,
  addGameToFranchise,
  addGameToSeries,
  removeGameFromFranchise,
  removeGameFromSeries,
  removeGameFromAllFranchiseAndSeriesBlocks,
  getFranchiseToGameIdsMap,
  getSeriesToGameIdsMap,
  deleteFranchiseOrSeriesIfUnused,
  resolveFranchiseIdsToObjects,
  resolveSeriesIdsToObjects,
};
