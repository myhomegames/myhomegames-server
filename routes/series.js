/**
 * Series routes: list derived from games + optional metadata/cover per id.
 */

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  getItemDir,
  getMetadataPath,
  loadStoredMetadata,
  aggregateFromGames,
  getFolderToGameIdsMap,
  mergeWithStored,
  resolveIdsToObjects,
  deleteIfUnused,
  ensureExistBatch,
} = require("../utils/derivedItemsShared");
const { ensureDirectoryExists, writeJsonFile } = require("../utils/fileUtils");

const FOLDER = "series";
const FIELD = "collection";
const ROUTE_BASE = "/series";
const RESPONSE_KEY = "series";

/** Add gameId to a series' gameIds. */
function addGameToSeries(metadataPath, seriesId, gameId) {
  const metaPath = getMetadataPath(metadataPath, FOLDER, seriesId);
  const meta = loadStoredMetadata(metadataPath, FOLDER, seriesId) || { title: String(seriesId), showTitle: true, gameIds: [] };
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  if (gameIds.includes(gameId)) return false;
  meta.gameIds = [...gameIds, gameId];
  ensureDirectoryExists(getItemDir(metadataPath, FOLDER, seriesId));
  writeJsonFile(metaPath, meta);
  return true;
}

/** Remove gameId from a series' gameIds. */
function removeGameFromSeries(metadataPath, seriesId, gameId) {
  const metaPath = getMetadataPath(metadataPath, FOLDER, seriesId);
  const meta = loadStoredMetadata(metadataPath, FOLDER, seriesId);
  if (!meta) return false;
  const gameIds = Array.isArray(meta.gameIds) ? meta.gameIds : [];
  const next = gameIds.filter((g) => Number(g) !== Number(gameId));
  if (next.length === gameIds.length) return false;
  writeJsonFile(metaPath, { ...meta, gameIds: next });
  return true;
}

function getSeriesToGameIdsMap(metadataPath) {
  return getFolderToGameIdsMap(metadataPath, FOLDER);
}

function resolveSeriesIdsToObjects(metadataPath, idsOrObjects) {
  return resolveIdsToObjects(metadataPath, FOLDER, idsOrObjects);
}

function ensureSeriesExistBatch(metadataPath, items, gameId) {
  return ensureExistBatch(metadataPath, items, FOLDER, gameId);
}

function deleteSeriesIfUnused(metadataPath, seriesId, allGames) {
  return deleteIfUnused(metadataPath, FOLDER, seriesId, allGames);
}

function registerSeriesRoutes(app, requireToken, allGames, metadataPath) {
  const upload = multer({ storage: multer.memoryStorage() });

  // GET /series – list from games + stored metadata/cover
  app.get(ROUTE_BASE, requireToken, (req, res) => {
    const items = aggregateFromGames(allGames, FIELD);
    const merged = mergeWithStored(metadataPath, FOLDER, items, ROUTE_BASE);
    res.json({ series: merged });
  });

  // PUT /series/:id
  app.put(`${ROUTE_BASE}/:id`, requireToken, (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const baseList = aggregateFromGames(allGames, FIELD);
    const item = baseList.find((x) => x.id === id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const meta = loadStoredMetadata(metadataPath, FOLDER, id) || { title: item.title, showTitle: true, gameIds: [] };
    if (typeof req.body.showTitle === "boolean") meta.showTitle = req.body.showTitle;
    if (!Array.isArray(meta.gameIds)) meta.gameIds = [];
    const dir = getItemDir(metadataPath, FOLDER, id);
    ensureDirectoryExists(dir);
    writeJsonFile(getMetadataPath(metadataPath, FOLDER, id), meta);
    const coverPath = path.join(dir, "cover.webp");
    const out = { id, title: item.title, showTitle: meta.showTitle };
    if (fs.existsSync(coverPath)) out.cover = `${ROUTE_BASE}/${id}/cover.webp`;
    res.json({ [RESPONSE_KEY]: out });
  });

  // POST /series/:id/upload-cover
  app.post(`${ROUTE_BASE}/:id/upload-cover`, requireToken, upload.single("file"), (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const baseList = aggregateFromGames(allGames, FIELD);
    const item = baseList.find((x) => x.id === id);
    if (!item) return res.status(404).json({ error: "Not found" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });
    if (!file.mimetype.startsWith("image/")) return res.status(400).json({ error: "File must be an image" });
    try {
      const dir = getItemDir(metadataPath, FOLDER, id);
      ensureDirectoryExists(dir);
      const meta = loadStoredMetadata(metadataPath, FOLDER, id) || { title: item.title, showTitle: true, gameIds: [] };
      if (!Array.isArray(meta.gameIds)) meta.gameIds = [];
      writeJsonFile(getMetadataPath(metadataPath, FOLDER, id), meta);
      const coverPath = path.join(dir, "cover.webp");
      fs.writeFileSync(coverPath, file.buffer);
      res.json({ [RESPONSE_KEY]: { id, title: item.title, cover: `${ROUTE_BASE}/${id}/cover.webp` } });
    } catch (err) {
      console.error(`Failed to save cover for ${RESPONSE_KEY} ${id}:`, err.message);
      res.status(500).json({ error: "Failed to save cover" });
    }
  });

  // DELETE /series/:id/delete-cover
  app.delete(`${ROUTE_BASE}/:id/delete-cover`, requireToken, (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const baseList = aggregateFromGames(allGames, FIELD);
    const item = baseList.find((x) => x.id === id);
    if (!item) return res.status(404).json({ error: "Not found" });
    try {
      const coverPath = path.join(getItemDir(metadataPath, FOLDER, id), "cover.webp");
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
      res.json({ [RESPONSE_KEY]: { id, title: item.title } });
    } catch (err) {
      console.error(`Failed to delete cover for ${RESPONSE_KEY} ${id}:`, err.message);
      res.status(500).json({ error: "Failed to delete cover" });
    }
  });

  // GET /series/:id/cover.webp
  app.get(`${ROUTE_BASE}/:id/cover.webp`, (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const coverPath = path.join(getItemDir(metadataPath, FOLDER, id), "cover.webp");
    if (!fs.existsSync(coverPath)) return res.status(404).end();
    res.type("image/webp");
    res.sendFile(path.resolve(coverPath));
  });
}

module.exports = {
  registerSeriesRoutes,
  ensureSeriesExistBatch,
  addGameToSeries,
  removeGameFromSeries,
  getSeriesToGameIdsMap,
  deleteSeriesIfUnused,
  resolveSeriesIdsToObjects,
};
