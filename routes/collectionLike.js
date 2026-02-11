/**
 * Factory for collection-like routes: developers, publishers.
 * Same pattern as taglists.js for themes, platforms, etc.
 *
 * Config: { contentFolder, routeBase, coverPrefix, listResponseKey, singleResponseKey, humanName, gameField }
 */

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { getCoverUrl, getLocalMediaPath, deleteMediaFile } = require("../utils/gameMediaUtils");
const {
  loadItems,
  saveItem,
  deleteItem,
  findById,
  findIndexById,
  normalizeId,
  removeGameFromAll,
} = require("../utils/collectionsShared");
const { ensureDirectoryExists } = require("../utils/fileUtils");

function createCollectionLikeRoutes(config) {
  const {
    contentFolder,
    routeBase,
    coverPrefix,
    backgroundPrefix = coverPrefix.replace(/-covers$/, "-backgrounds"),
    listResponseKey,
    singleResponseKey,
    humanName,
    gameField,
  } = config;

  const normalizedRouteBase = routeBase.startsWith("/") ? routeBase : `/${routeBase}`;

  function ensureBatch(metadataPath, items, gameId) {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    const list = loadItems(metadataPath, contentFolder);
    const byId = new Map(list.map((d) => [d.id, d]));

    for (const item of items) {
      const id = typeof item === "object" && item && item.id != null ? item.id : item;
      const name = typeof item === "object" && item && item.name ? item.name : String(item);
      if (!id || !name) continue;
      const numId = Number(id);
      if (isNaN(numId)) continue;

      const logo = typeof item === "object" && item && item.logo ? item.logo : null;
      const description =
        typeof item === "object" && item && typeof item.description === "string" ? item.description : "";

      let entry = byId.get(numId);
      if (!entry) {
        entry = {
          id: numId,
          title: name.trim(),
          games: [],
          summary: description || "",
          igdbCover: logo || null,
        };
        saveItem(metadataPath, contentFolder, entry);
        byId.set(numId, entry);
      }
      if (gameId && (!entry.games || !entry.games.includes(gameId))) {
        entry.games = entry.games || [];
        entry.games.push(gameId);
        saveItem(metadataPath, contentFolder, entry);
      }
    }
  }

  function removeGameFrom(metadataPath, resourceId, gameId) {
    const list = loadItems(metadataPath, contentFolder);
    const entry = list.find((d) => Number(d.id) === Number(resourceId));
    if (!entry || !entry.games) return;
    const idx = entry.games.findIndex((g) => Number(g) === Number(gameId));
    if (idx !== -1) {
      entry.games.splice(idx, 1);
      saveItem(metadataPath, contentFolder, entry);
    }
  }

  function removeGameFromAllFunc(metadataPath, gameId, updateCacheCallback, cache) {
    return removeGameFromAll(metadataPath, contentFolder, gameId, updateCacheCallback, cache);
  }

  function registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removeFromAllGamesFn) {
    let cache = loadItems(metadataPath, contentFolder);
    const updateCache = () => {
      cache = loadItems(metadataPath, contentFolder);
    };

    const upload = multer({ storage: multer.memoryStorage() });

    app.get(`/${coverPrefix}/:resourceId`, (req, res) => {
      const id = req.params.resourceId;
      const coverPath = path.join(metadataPath, "content", contentFolder, String(id), "cover.webp");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");
      if (!fs.existsSync(coverPath)) {
        res.setHeader("Content-Type", "image/webp");
        return res.status(404).end();
      }
      res.type("image/webp");
      res.sendFile(coverPath);
    });

    app.get(`/${backgroundPrefix}/:resourceId`, (req, res) => {
      const id = req.params.resourceId;
      const backgroundPath = path.join(metadataPath, "content", contentFolder, String(id), "background.webp");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");
      if (!fs.existsSync(backgroundPath)) {
        res.setHeader("Content-Type", "image/webp");
        return res.status(404).end();
      }
      res.type("image/webp");
      res.sendFile(backgroundPath);
    });

    app.get(normalizedRouteBase, requireToken, (req, res) => {
      const list = cache.length ? cache : loadItems(metadataPath, contentFolder);
      if (!cache.length) updateCache();
      res.json({
        [listResponseKey]: list.map((d) => {
          const gameIds = d.games || [];
          const actualCount = gameIds.filter((g) => allGames[g]).length;
          const data = { id: d.id, title: d.title, gameCount: actualCount, showTitle: d.showTitle !== false };
          const cover = getLocalMediaPath({
            metadataPath,
            resourceId: d.id,
            resourceType: contentFolder,
            mediaType: "cover",
            urlPrefix: `/${coverPrefix}`.replace(/\/$/, ""),
          });
          data.cover = cover || d.igdbCover || null;
          const background = getLocalMediaPath({
            metadataPath,
            resourceId: d.id,
            resourceType: contentFolder,
            mediaType: "background",
            urlPrefix: `/${backgroundPrefix}`.replace(/\/$/, ""),
          });
          if (background) data.background = background;
          if (d.summary) data.summary = d.summary;
          return data;
        }),
      });
    });

    app.get(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const data = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary || "",
        showTitle: entry.showTitle !== false,
        gameCount: (entry.games || []).filter((g) => allGames[g]).length,
      };
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`,
      });
      data.cover = cover || entry.igdbCover || null;
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      if (background) data.background = background;
      res.json(data);
    });

    app.get(`${normalizedRouteBase}/:id/games`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const games = (entry.games || [])
        .map((gId) => allGames[gId])
        .filter(Boolean)
        .map((g) => ({
          id: g.id,
          title: g.title,
          summary: g.summary || "",
          cover: getCoverUrl(g, metadataPath),
          day: g.day,
          month: g.month,
          year: g.year,
          stars: g.stars,
          developers: g.developers || null,
          publishers: g.publishers || null,
          executables: g.executables || null,
        }));
      res.json({ games });
    });

    app.put(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const { title, summary, showTitle } = req.body;
      if (title && typeof title === "string" && title.trim()) {
        entry.title = title.trim();
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
      }
      if (summary !== undefined) {
        entry.summary = typeof summary === "string" ? summary.trim() : "";
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
      }
      if (showTitle !== undefined) {
        entry.showTitle = showTitle !== false;
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
      }
      res.json({
        status: "success",
        [singleResponseKey]: {
          id: entry.id,
          title: entry.title,
          summary: entry.summary || "",
          showTitle: entry.showTitle !== false,
        },
      });
    });

    app.delete(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const idx = findIndexById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (idx === -1) return res.status(404).json({ error: `${humanName} not found` });
      const entry = cache[idx];
      if (removeFromAllGamesFn) {
        removeFromAllGamesFn(metadataPath, metadataGamesDir, id, allGames);
      }
      deleteItem(metadataPath, contentFolder, id);
      cache.splice(idx, 1);
      res.json({ status: "success" });
    });

    app.post(`${normalizedRouteBase}/:id/upload-cover`, requireToken, upload.single("file"), (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const file = req.file;
      if (!file || !file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "No image file provided" });
      }
      const dir = path.join(metadataPath, "content", contentFolder, String(id));
      ensureDirectoryExists(dir);
      fs.writeFileSync(path.join(dir, "cover.webp"), file.buffer);
      updateCache();
      const response = {
        id: entry.id,
        title: entry.title,
        cover: `/${coverPrefix}/${encodeURIComponent(entry.id)}`,
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      if (background) response.background = background;
      res.json({ status: "success", [singleResponseKey]: response });
    });

    app.delete(`${normalizedRouteBase}/:id/delete-cover`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      try {
        deleteMediaFile({
          metadataPath,
          resourceId: id,
          resourceType: contentFolder,
          mediaType: "cover",
        });
      } catch (e) {
        console.error(`Failed to delete ${humanName.toLowerCase()} cover:`, e.message);
      }
      updateCache();
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`,
      });
      const response = { id: entry.id, title: entry.title, cover: cover || entry.igdbCover || null };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      if (background) response.background = background;
      res.json({ status: "success", [singleResponseKey]: response });
    });

    app.post(`${normalizedRouteBase}/:id/upload-background`, requireToken, upload.single("file"), (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const file = req.file;
      if (!file || !file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "No image file provided" });
      }
      const dir = path.join(metadataPath, "content", contentFolder, String(id));
      ensureDirectoryExists(dir);
      fs.writeFileSync(path.join(dir, "background.webp"), file.buffer);
      updateCache();
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`,
      });
      const response = {
        id: entry.id,
        title: entry.title,
        cover: cover || entry.igdbCover || null,
        background: `/${backgroundPrefix}/${encodeURIComponent(entry.id)}`,
      };
      res.json({ status: "success", [singleResponseKey]: response });
    });

    app.delete(`${normalizedRouteBase}/:id/delete-background`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      try {
        deleteMediaFile({
          metadataPath,
          resourceId: id,
          resourceType: contentFolder,
          mediaType: "background",
        });
      } catch (e) {
        console.error(`Failed to delete ${humanName.toLowerCase()} background:`, e.message);
      }
      updateCache();
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`,
      });
      const response = { id: entry.id, title: entry.title, cover: cover || entry.igdbCover || null };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      if (background) response.background = background;
      res.json({ status: "success", [singleResponseKey]: response });
    });

    return {
      reload: () => {
        cache = loadItems(metadataPath, contentFolder);
        return cache;
      },
      getCache: () => cache,
      removeGameFromAll: (gameId, cb) => removeGameFromAllFunc(metadataPath, gameId, cb, cache),
    };
  }

  return {
    loadItems: (p) => loadItems(p, contentFolder),
    ensureBatch,
    removeGameFrom,
    removeGameFromAll: removeGameFromAllFunc,
    registerRoutes,
  };
}

module.exports = {
  createCollectionLikeRoutes,
};
