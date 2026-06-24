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
  loadItemById,
  saveItem,
  deleteItem,
  findById,
  findIndexById,
  normalizeId,
  removeGameFromAll,
  computeFinalGameIdsForOrder,
  addChildToItem,
  removeChildFromItem,
} = require("../utils/collectionsShared");
const { ensureDirectoryExists } = require("../utils/fileUtils");
const { coerceToGameTypeId } = require("../utils/igdbGameType");
const { mergeCompanyProfile, normalizeStoredCompanyProfile, syncIgdbParentCompanyChildLinkWithIgdb } = require("../utils/igdbCompany");
const { resolveTwitchAppCredentials } = require("../utils/twitchAppCredentials");
const {
  appendCompanyProfileFields,
  applyNormalizedCompanyProfileFields,
  extractCompanyProfileFieldsFromBody,
  hasAnyCompanyProfileFieldInBody,
  pickCompanyProfileFields,
} = require("../utils/companyProfileFields");
const {
  isCompanyRoleFolder,
  loadRoleItems,
  loadRoleItemById,
  saveRoleItem,
  deleteRoleItem,
  ensureCompanyRoleEntry,
  hasLocalCompanyCover,
  getCompanyContentDir,
  removeGameFromAllRoleItems,
  addChildToRoleItem,
  removeChildFromRoleItem,
  syncIgdbParentCompanyChildLink,
} = require("../utils/companyStorage");

function storedExternalCoverUrl(entry) {
  const u = entry && entry.externalCoverUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function storedExternalBackgroundUrl(entry) {
  const u = entry && entry.externalBackgroundUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function appendCompanyProfileToPayload(data, entry) {
  appendCompanyProfileFields(data, entry);
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
  const useCompanyStorage = isCompanyRoleFolder(contentFolder);

  function storageLoadItems(metadataPathArg) {
    return useCompanyStorage
      ? loadRoleItems(metadataPathArg, contentFolder)
      : loadItems(metadataPathArg, contentFolder);
  }

  function storageLoadItemById(metadataPathArg, id) {
    return useCompanyStorage
      ? loadRoleItemById(metadataPathArg, contentFolder, id)
      : loadItemById(metadataPathArg, contentFolder, id);
  }

  function storageSaveItem(metadataPathArg, entry) {
    if (useCompanyStorage) {
      saveRoleItem(metadataPathArg, contentFolder, entry);
      return;
    }
    saveItem(metadataPathArg, contentFolder, entry);
  }

  function storageDeleteItem(metadataPathArg, itemId) {
    if (useCompanyStorage) {
      deleteRoleItem(metadataPathArg, contentFolder, itemId);
      return;
    }
    deleteItem(metadataPathArg, contentFolder, itemId);
  }

  function getItemContentDir(metadataPathArg, itemId) {
    if (useCompanyStorage) {
      return getCompanyContentDir(metadataPathArg, itemId);
    }
    return path.join(metadataPathArg, "content", contentFolder, String(itemId));
  }

  function getMediaResourceType() {
    return useCompanyStorage ? "companies" : contentFolder;
  }

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
    const list = storageLoadItems(metadataPath);
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
      const companyProfileFields = pickCompanyProfileFields(item);

      let entry = byId.get(numId);
      if (!entry) {
        entry = {
          id: numId,
          title: name.trim(),
          games: [],
          childs: [],
          summary: description || "",
          externalCoverUrl: logo || null,
          ...companyProfileFields,
        };
        storageSaveItem(metadataPath, entry);
        byId.set(numId, entry);
      }
      if (gameId && (!entry.games || !entry.games.includes(gameId))) {
        entry.games = entry.games || [];
        entry.games.push(gameId);
        storageSaveItem(metadataPath, entry);
      }
      if (useCompanyStorage && pickCompanyProfileFields(entry).parentCompany) {
        syncIgdbParentCompanyChildLink(metadataPath, contentFolder, entry);
      }
    }
  }

  async function syncParentCompanyChildLinkFromRequest(req, childEntry) {
    if (!useCompanyStorage || !pickCompanyProfileFields(childEntry).parentCompany) {
      return false;
    }

    const creds = resolveTwitchAppCredentials(req);
    if (!creds.clientId || !creds.clientSecret) {
      return syncIgdbParentCompanyChildLink(metadataPath, contentFolder, childEntry);
    }

    try {
      const { getIGDBAccessToken } = require("./igdb");
      const accessToken = await getIGDBAccessToken(creds.clientId, creds.clientSecret);
      return await syncIgdbParentCompanyChildLinkWithIgdb(
        metadataPath,
        contentFolder,
        childEntry,
        accessToken,
        creds.clientId,
      );
    } catch (err) {
      console.error(`Failed to enrich parent company for ${contentFolder}/${childEntry.id}:`, err.message);
      return syncIgdbParentCompanyChildLink(metadataPath, contentFolder, childEntry);
    }
  }

  function removeGameFrom(metadataPath, resourceId, gameId) {
    const list = storageLoadItems(metadataPath);
    const entry = list.find((d) => Number(d.id) === Number(resourceId));
    if (!entry || !entry.games) return;
    const idx = entry.games.findIndex((g) => Number(g) === Number(gameId));
    if (idx !== -1) {
      entry.games.splice(idx, 1);
      storageSaveItem(metadataPath, entry);
    }
  }

  function removeGameFromAllFunc(metadataPath, gameId, updateCacheCallback, cache) {
    if (useCompanyStorage) {
      return removeGameFromAllRoleItems(metadataPath, contentFolder, gameId, updateCacheCallback, cache);
    }
    return removeGameFromAll(metadataPath, contentFolder, gameId, updateCacheCallback, cache);
  }

  /** Delete item if it has no games left and no local cover (so orphaned and no custom cover). */
  function deleteItemIfUnused(metadataPath, itemId) {
    const list = storageLoadItems(metadataPath);
    const entry = findById(list, itemId);
    if (!entry) return;
    const games = entry.games || [];
    if (games.length > 0) return;
    if (useCompanyStorage) {
      if (hasLocalCompanyCover(metadataPath, itemId)) return;
      deleteRoleItem(metadataPath, contentFolder, itemId);
      return;
    }
    const coverPath = path.join(metadataPath, "content", contentFolder, String(itemId), "cover.webp");
    if (fs.existsSync(coverPath)) return;
    storageDeleteItem(metadataPath, itemId);
  }

  function registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removeFromAllGamesFn) {
    let cache = storageLoadItems(metadataPath);
    const updateCache = () => {
      cache = storageLoadItems(metadataPath);
    };

    function buildDetailPayload(entry) {
      const data = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary || "",
        showTitle: entry.showTitle !== false,
        gameCount: (entry.games || []).filter((g) => allGames[g]).length,
        childs: Array.isArray(entry.childs) ? entry.childs : [],
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
      appendCompanyProfileToPayload(data, entry);
      return data;
    }

    function upsertCacheEntry(entry) {
      const idx = findIndexById(cache, entry.id);
      if (idx !== -1) {
        cache[idx] = entry;
      } else {
        cache.push(entry);
      }
    }

    const upload = multer({ storage: multer.memoryStorage() });

    function resolveMediaFilePath(itemId, mediaType) {
      if (useCompanyStorage) {
        const companyPath = path.join(getCompanyContentDir(metadataPath, itemId), `${mediaType}.webp`);
        if (fs.existsSync(companyPath)) return companyPath;
      }
      return path.join(metadataPath, "content", contentFolder, String(itemId), `${mediaType}.webp`);
    }

    app.get(`/${coverPrefix}/:resourceId`, (req, res) => {
      const id = req.params.resourceId;
      const coverPath = resolveMediaFilePath(id, "cover");
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
      const backgroundPath = resolveMediaFilePath(id, "background");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");
      if (!fs.existsSync(backgroundPath)) {
        res.setHeader("Content-Type", "image/webp");
        return res.status(404).end();
      }
      res.type("image/webp");
      res.sendFile(backgroundPath);
    });

    app.post(normalizedRouteBase, requireToken, async (req, res) => {
      const { title, summary, id: requestedId } = req.body || {};
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Title is required" });
      }
      const trimmedTitle = title.trim();
      updateCache();
      const list = cache.length ? cache : storageLoadItems(metadataPath);
      const existing = list.find((c) => String(c.title).toLowerCase() === trimmedTitle.toLowerCase());
      if (existing) {
        return res.status(409).json({
          error: `${humanName} with this title already exists`,
          [singleResponseKey]: { id: existing.id, title: existing.title },
        });
      }
      const parsedRequestedId =
        requestedId != null && /^\d+$/.test(String(requestedId)) ? Number(requestedId) : null;
      let newId;
      if (parsedRequestedId != null && parsedRequestedId >= 1) {
        if (list.some((c) => String(c.id) === String(parsedRequestedId))) {
          return res.status(409).json({
            error: `${humanName} with this id already exists`,
            [singleResponseKey]: { id: parsedRequestedId, title: trimmedTitle },
          });
        }
        newId = parsedRequestedId;
      } else {
        newId = getIdFromTitle(trimmedTitle);
        while (list.some((c) => String(c.id) === String(newId))) {
          newId++;
        }
      }
      const newItem = {
        id: newId,
        title: trimmedTitle,
        summary: (summary && typeof summary === "string") ? summary.trim() : "",
        showTitle: true,
        games: [],
        childs: [],
      };
      try {
        storageSaveItem(metadataPath, newItem);
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
      appendCompanyProfileToPayload(data, newItem);
      res.status(201).json({ status: "success", [singleResponseKey]: data });
    });

    app.get(normalizedRouteBase, requireToken, (req, res) => {
      updateCache();
      const list = cache.length ? cache : storageLoadItems(metadataPath);
      res.json({
        [listResponseKey]: list.map((d) => {
          const gameIds = d.games || [];
          const actualCount = gameIds.filter((g) => allGames[g]).length;
          const data = {
            id: d.id,
            title: d.title,
            gameCount: actualCount,
            showTitle: d.showTitle !== false,
            childs: Array.isArray(d.childs) ? d.childs : [],
          };
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
      let entry;
      if (useCompanyStorage) {
        entry = storageLoadItemById(metadataPath, id);
        if (entry) {
          upsertCacheEntry(entry);
        }
      } else {
        let list = cache.length ? cache : storageLoadItems(metadataPath);
        entry = findById(list, id);
        if (!entry) {
          updateCache();
          list = cache;
          entry = findById(list, id);
        }
      }
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      res.json(buildDetailPayload(entry));
    });

    app.post(`${normalizedRouteBase}/:id/reload`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      try {
        const entry = storageLoadItemById(metadataPath, id);
        if (!entry) {
          const idx = findIndexById(cache, id);
          if (idx !== -1) cache.splice(idx, 1);
          return res.status(404).json({ error: `${humanName} not found` });
        }
        upsertCacheEntry(entry);
        res.json({ status: "reloaded", [singleResponseKey]: buildDetailPayload(entry) });
      } catch (e) {
        console.error(`Failed to reload ${humanName.toLowerCase()} ${id}:`, e.message);
        res.status(500).json({ error: `Failed to reload ${humanName.toLowerCase()} metadata` });
      }
    });

    if (contentFolder === "developers" || contentFolder === "publishers") {
      const handleMergeCompanyProfile = async (req, res) => {
        const id = normalizeId(req.params.id);
        const remote = extractCompanyProfileFieldsFromBody(req.body);
        if (remote === undefined || remote === null || typeof remote !== "object") {
          return res.status(400).json({ error: "Missing company profile fields in request body" });
        }

        try {
          const entry = storageLoadItemById(metadataPath, id);
          if (!entry) {
            return res.status(404).json({ error: `${humanName} not found` });
          }

          const localFields = pickCompanyProfileFields(entry);
          const { info, changed } = mergeCompanyProfile(localFields, remote);
          if (changed) {
            applyNormalizedCompanyProfileFields(entry, info);
            storageSaveItem(metadataPath, entry);
            upsertCacheEntry(entry);
          }
          if (pickCompanyProfileFields(entry).parentCompany) {
            await syncParentCompanyChildLinkFromRequest(req, entry);
            updateCache();
          }

          res.json({
            status: changed ? "merged" : "unchanged",
            [singleResponseKey]: buildDetailPayload(entry),
          });
        } catch (e) {
          console.error(`Failed to merge company profile for ${contentFolder}/${id}:`, e.message);
          res.status(500).json({ error: "Failed to merge company profile" });
        }
      };

      app.post(`${normalizedRouteBase}/:id/merge-company-profile`, requireToken, handleMergeCompanyProfile);
    }

    app.get(`${normalizedRouteBase}/:id/games`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      let list = cache.length ? cache : storageLoadItems(metadataPath);
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
      const list = cache.length ? cache : storageLoadItems(metadataPath);
      const entry = findById(list, id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const currentGameIds = entry.games || [];
      const finalGameIds = computeFinalGameIdsForOrder(currentGameIds, gameIds, allGames);
      entry.games = finalGameIds;
      try {
        storageSaveItem(metadataPath, entry);
        updateCache();
        res.json({ status: "success" });
      } catch (e) {
        console.error(`Failed to save ${humanName} games order:`, e.message);
        res.status(500).json({ error: "Failed to save games order" });
      }
    });

    app.put(`${normalizedRouteBase}/:id`, requireToken, async (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : storageLoadItems(metadataPath), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const { title, summary, showTitle, externalCoverUrl, externalBackgroundUrl, childs } = req.body;
      if (title && typeof title === "string" && title.trim()) {
        entry.title = title.trim();
        storageSaveItem(metadataPath, entry);
        updateCache();
      }
      if (summary !== undefined) {
        entry.summary = typeof summary === "string" ? summary.trim() : "";
        storageSaveItem(metadataPath, entry);
        updateCache();
      }
      if (showTitle !== undefined) {
        entry.showTitle = showTitle !== false;
        storageSaveItem(metadataPath, entry);
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
        storageSaveItem(metadataPath, entry);
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
        storageSaveItem(metadataPath, entry);
        updateCache();
      }
      if (childs !== undefined) {
        if (!Array.isArray(childs)) {
          return res.status(400).json({ error: "childs must be an array of ids" });
        }
        const normalizedChilds = [];
        const seen = new Set();
        for (const raw of childs) {
          const id = normalizeId(raw);
          if (id == null) continue;
          if (String(id) === String(entry.id)) continue;
          const key = String(id);
          if (seen.has(key)) continue;
          seen.add(key);
          normalizedChilds.push(id);
        }
        entry.childs = normalizedChilds;
        storageSaveItem(metadataPath, entry);
        updateCache();
      }
      if (
        (contentFolder === "developers" || contentFolder === "publishers") &&
        hasAnyCompanyProfileFieldInBody(req.body)
      ) {
        const raw = extractCompanyProfileFieldsFromBody(req.body);
        if (raw === null) {
          applyNormalizedCompanyProfileFields(entry, null);
        } else {
          const normalized = normalizeStoredCompanyProfile(raw);
          applyNormalizedCompanyProfileFields(entry, normalized);
        }
        storageSaveItem(metadataPath, entry);
        updateCache();
        if (pickCompanyProfileFields(entry).parentCompany) {
          await syncParentCompanyChildLinkFromRequest(req, entry);
          updateCache();
        }
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
        childs: Array.isArray(entry.childs) ? entry.childs : [],
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
      if (contentFolder === "developers" || contentFolder === "publishers") {
        appendCompanyProfileToPayload(responsePayload, entry);
      }
      res.json({
        status: "success",
        [singleResponseKey]: responsePayload,
      });
    });

    app.delete(`${normalizedRouteBase}/:id`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const idx = findIndexById(cache.length ? cache : storageLoadItems(metadataPath), id);
      if (idx === -1) return res.status(404).json({ error: `${humanName} not found` });
      const entry = cache[idx];
      if (removeFromAllGamesFn) {
        removeFromAllGamesFn(metadataPath, metadataGamesDir, id, allGames);
      }
      storageDeleteItem(metadataPath, id);
      cache.splice(idx, 1);
      res.json({ status: "success" });
    });

    app.post(`${normalizedRouteBase}/:id/childs/:childId`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const childId = normalizeId(req.params.childId);
      const added = useCompanyStorage
        ? addChildToRoleItem(metadataPath, contentFolder, id, childId)
        : addChildToItem(metadataPath, contentFolder, id, childId);
      if (!added) {
        return res.status(404).json({ error: `${humanName} parent or child not found, or child already linked` });
      }
      updateCache();
      return res.json({ status: "success" });
    });

    app.delete(`${normalizedRouteBase}/:id/childs/:childId`, requireToken, (req, res) => {
      const id = normalizeId(req.params.id);
      const childId = normalizeId(req.params.childId);
      const removed = useCompanyStorage
        ? removeChildFromRoleItem(metadataPath, contentFolder, id, childId)
        : removeChildFromItem(metadataPath, contentFolder, id, childId);
      if (!removed) {
        return res.status(404).json({ error: `${humanName} parent or child link not found` });
      }
      updateCache();
      return res.json({ status: "success" });
    });

    app.post(`${normalizedRouteBase}/:id/upload-cover`, requireToken, upload.single("file"), (req, res) => {
      const id = normalizeId(req.params.id);
      const entry = findById(cache.length ? cache : storageLoadItems(metadataPath), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const file = req.file;
      if (!file || !file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "No image file provided" });
      }
      const dir = getItemContentDir(metadataPath, id);
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
      const entry = findById(cache.length ? cache : storageLoadItems(metadataPath), id);
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
      const entry = findById(cache.length ? cache : storageLoadItems(metadataPath), id);
      if (!entry) return res.status(404).json({ error: `${humanName} not found` });
      const file = req.file;
      if (!file || !file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "No image file provided" });
      }
      const dir = getItemContentDir(metadataPath, id);
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
      const entry = findById(cache.length ? cache : storageLoadItems(metadataPath), id);
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
        cache = storageLoadItems(metadataPath);
        return cache;
      },
      getCache: () => cache,
      removeGameFromAll: (gameId, cb) => removeGameFromAllFunc(metadataPath, gameId, cb, cache),
    };
  }

  return {
    loadItems: (p) => storageLoadItems(p),
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
