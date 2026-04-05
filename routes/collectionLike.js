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
  computeFinalGameIdsForOrder,
} = require("../utils/collectionsShared");
const { ensureDirectoryExists } = require("../utils/fileUtils");
const { coerceToGameTypeId } = require("../utils/igdbGameType");

function storedExternalCoverUrl(entry) {
  const u = entry && entry.externalCoverUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function storedExternalBackgroundUrl(entry) {
  const u = entry && entry.externalBackgroundUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

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

  function getIdFromTitle(title) {
    let hash = 0;
    const str = String(title).toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function ensureBatch(metadataPath, items, gameId) {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    const list = loadItems(metadataPath, contentFolder);
    const byId = new Map(list.map((d) => [d.id, d]));

    for (const item of items) {
      const id = typeof item === "object" && item && item.id != null ? item.id : item;
      const name = typeof item === "object" && item && (item.name ?? item.title) ? (item.name ?? item.title) : String(item);
      if (!id || !name) continue;
      const numId = Number(id);
      if (isNaN(numId) || numId < 0) continue;

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
          externalCoverUrl: logo || null,
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

  /** Delete item if it has no games left and no local cover (so orphaned and no custom cover). */
  function deleteItemIfUnused(metadataPath, itemId) {
    const list = loadItems(metadataPath, contentFolder);
    const entry = findById(list, itemId);
    if (!entry) return;
    const games = entry.games || [];
    if (games.length > 0) return;
    const coverPath = path.join(metadataPath, "content", contentFolder, String(itemId), "cover.webp");
    if (fs.existsSync(coverPath)) return;
    deleteItem(metadataPath, contentFolder, itemId);
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

    app.post(normalizedRouteBase, requireToken, (req, res) => {
      const { title, summary } = req.body || {};
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Title is required" });
      }
      const trimmedTitle = title.trim();
      updateCache();
      const list = cache.length ? cache : loadItems(metadataPath, contentFolder);
      const existing = list.find((c) => String(c.title).toLowerCase() === trimmedTitle.toLowerCase());
      if (existing) {
        return res.status(409).json({
          error: `${humanName} with this title already exists`,
          [singleResponseKey]: { id: existing.id, title: existing.title },
        });
      }
      let newId = getIdFromTitle(trimmedTitle);
      while (list.some((c) => String(c.id) === String(newId))) {
        newId++;
      }
      const newItem = {
        id: newId,
        title: trimmedTitle,
        summary: (summary && typeof summary === "string") ? summary.trim() : "",
        showTitle: true,
        games: [],
      };
      try {
        saveItem(metadataPath, contentFolder, newItem);
        updateCache();
      } catch (e) {
        console.error(`Failed to save ${humanName}:`, e.message);
        return res.status(500).json({ error: `Failed to create ${humanName}` });
      }
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: newItem.id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`.replace(/\/$/, ""),
      });
      const data = {
        id: newItem.id,
        title: newItem.title,
        summary: newItem.summary || "",
        showTitle: newItem.showTitle,
        gameCount: 0,
        cover: cover || null,
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: newItem.id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`.replace(/\/$/, ""),
      });
      data.background = background || null;
      data.externalBackgroundUrl = null;
      res.status(201).json({ status: "success", [singleResponseKey]: data });
    });

    app.get(normalizedRouteBase, requireToken, (req, res) => {
      updateCache();
      const list = cache.length ? cache : loadItems(metadataPath, contentFolder);
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
          data.cover = cover || storedExternalCoverUrl(d) || null;
          const background = getLocalMediaPath({
            metadataPath,
            resourceId: d.id,
            resourceType: contentFolder,
            mediaType: "background",
            urlPrefix: `/${backgroundPrefix}`.replace(/\/$/, ""),
          });
          data.background = background || storedExternalBackgroundUrl(d) || null;
          data.externalBackgroundUrl = storedExternalBackgroundUrl(d);
          if (d.summary) data.summary = d.summary;
          return data;
        }),
      });
    });

    app.get(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      let list = cache.length ? cache : loadItems(metadataPath, contentFolder);
      let entry = findById(list, id);
      if (!entry) {
        updateCache();
        list = cache;
        entry = findById(list, id);
      }
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
      data.cover = cover || storedExternalCoverUrl(entry) || null;
      data.externalCoverUrl = storedExternalCoverUrl(entry);
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      data.background = background || storedExternalBackgroundUrl(entry) || null;
      data.externalBackgroundUrl = storedExternalBackgroundUrl(entry);
      res.json(data);
    });

    app.get(`${normalizedRouteBase}/:id/games`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      let list = cache.length ? cache : loadItems(metadataPath, contentFolder);
      let entry = findById(list, id);
      if (!entry) {
        updateCache();
        list = cache;
        entry = findById(list, id);
      }
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const games = (entry.games || [])
        .map((gId) => {
          const key = normalizeId(gId);
          return allGames[key] || allGames[gId];
        })
        .filter(Boolean)
        .map((g) => {
          const executables = g.executables;
          const execArray =
            Array.isArray(executables) && executables.length > 0
              ? executables
              : executables != null
                ? [].concat(executables)
                : null;
          const typeId = coerceToGameTypeId(g.type);
          return {
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
            executables: execArray,
            ...(typeId != null ? { type: typeId } : {}),
          };
        });
      res.json({ games });
    });

    app.put(`${normalizedRouteBase}/:id/games/order`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const { gameIds } = req.body;
      if (!Array.isArray(gameIds)) {
        return res.status(400).json({ error: "gameIds must be an array" });
      }
      updateCache();
      const list = cache.length ? cache : loadItems(metadataPath, contentFolder);
      const entry = findById(list, id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const currentGameIds = entry.games || [];
      const finalGameIds = computeFinalGameIdsForOrder(currentGameIds, gameIds, allGames);
      entry.games = finalGameIds;
      try {
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
        res.json({ status: "success" });
      } catch (e) {
        console.error(`Failed to save ${humanName} games order:`, e.message);
        res.status(500).json({ error: "Failed to save games order" });
      }
    });

    app.put(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : loadItems(metadataPath, contentFolder), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const { title, summary, showTitle, externalCoverUrl, externalBackgroundUrl } = req.body;
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
      if (externalCoverUrl !== undefined) {
        if (externalCoverUrl == null || externalCoverUrl === "") {
          entry.externalCoverUrl = null;
        } else if (typeof externalCoverUrl !== "string") {
          return res.status(400).json({ error: "externalCoverUrl must be a string or null" });
        } else {
          const t = externalCoverUrl.trim();
          entry.externalCoverUrl = t.length > 0 ? t : null;
        }
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
      }
      if (externalBackgroundUrl !== undefined) {
        if (externalBackgroundUrl == null || externalBackgroundUrl === "") {
          entry.externalBackgroundUrl = null;
        } else if (typeof externalBackgroundUrl !== "string") {
          return res.status(400).json({ error: "externalBackgroundUrl must be a string or null" });
        } else {
          const t = externalBackgroundUrl.trim();
          entry.externalBackgroundUrl = t.length > 0 ? t : null;
        }
        saveItem(metadataPath, contentFolder, entry);
        updateCache();
      }
      const cover = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "cover",
        urlPrefix: `/${coverPrefix}`,
      });
      const responsePayload = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary || "",
        showTitle: entry.showTitle !== false,
        cover: cover || storedExternalCoverUrl(entry) || null,
        externalCoverUrl: storedExternalCoverUrl(entry),
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: entry.id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      responsePayload.background = background || storedExternalBackgroundUrl(entry) || null;
      responsePayload.externalBackgroundUrl = storedExternalBackgroundUrl(entry);
      res.json({
        status: "success",
        [singleResponseKey]: responsePayload,
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
      response.background = background || storedExternalBackgroundUrl(entry) || null;
      response.externalBackgroundUrl = storedExternalBackgroundUrl(entry);
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
      const response = { id: entry.id, title: entry.title, cover: cover || storedExternalCoverUrl(entry) || null };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      response.background = background || storedExternalBackgroundUrl(entry) || null;
      response.externalBackgroundUrl = storedExternalBackgroundUrl(entry);
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
        cover: cover || storedExternalCoverUrl(entry) || null,
        background: `/${backgroundPrefix}/${encodeURIComponent(entry.id)}`,
        externalBackgroundUrl: storedExternalBackgroundUrl(entry),
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
      const response = { id: entry.id, title: entry.title, cover: cover || storedExternalCoverUrl(entry) || null };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: id,
        resourceType: contentFolder,
        mediaType: "background",
        urlPrefix: `/${backgroundPrefix}`,
      });
      response.background = background || storedExternalBackgroundUrl(entry) || null;
      response.externalBackgroundUrl = storedExternalBackgroundUrl(entry);
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
    deleteItemIfUnused,
    registerRoutes,
  };
}

module.exports = {
  createCollectionLikeRoutes,
};
