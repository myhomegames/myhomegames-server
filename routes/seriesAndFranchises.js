/**
 * Series and franchises: list derived from games + optional metadata/cover per id.
 */

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { readJsonFile, ensureDirectoryExists, writeJsonFile } = require("../utils/fileUtils");

function toArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function normalizeItem(item) {
  if (item == null) return null;
  if (typeof item === "object" && item.id != null) {
    const name = item.name != null ? String(item.name) : String(item.id);
    return { id: Number(item.id), title: name };
  }
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

function mergeWithStored(metadataPath, folder, items, coverRouteBase) {
  if (!items || items.length === 0) return items;
  return items.map((item) => {
    const meta = loadStoredMetadata(metadataPath, folder, item.id);
    const coverPath = path.join(getItemDir(metadataPath, folder, item.id), "cover.webp");
    const result = { ...item };
    if (meta && typeof meta.showTitle === "boolean") result.showTitle = meta.showTitle;
    if (fs.existsSync(coverPath)) result.cover = `${coverRouteBase}/${item.id}/cover.webp`;
    return result;
  });
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
      const meta = loadStoredMetadata(metadataPath, folder, id) || { title: item.title, showTitle: true };
      if (typeof req.body.showTitle === "boolean") meta.showTitle = req.body.showTitle;
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
        const meta = loadStoredMetadata(metadataPath, folder, id) || { title: item.title, showTitle: true };
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
};
