const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { getCoverUrl, getBackgroundUrl, getLocalMediaPath, deleteMediaFile } = require("../utils/gameMediaUtils");
const { ensureDirectoryExists } = require("../utils/fileUtils");
const { getTitleForSort } = require("../utils/sortUtils");
const {
  loadItems,
  saveItem,
  deleteItem,
  findById,
  findIndexById,
  normalizeId,
  removeGameFromAll,
  addGameToItem,
  getResourceToGameIdsMap,
  computeFinalGameIdsForOrder,
} = require("../utils/collectionsShared");
const { coerceToGameTypeId } = require("../utils/igdbGameType");

const CONTENT_FOLDER = "collections";

function externalCoverUrlFromCollectionEntry(c) {
  const u = c && c.externalCoverUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function externalBackgroundUrlFromCollectionEntry(c) {
  const u = c && c.externalBackgroundUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/**
 * Collections routes module
 * Handles collections endpoints
 * Uses collectionsShared for load/save/delete (same as developers, publishers)
 */

// Generate numeric collection ID from title hash (deterministic, same title = same ID)
function getCollectionIdFromTitle(title) {
  let hash = 0;
  const str = String(title).toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function loadCollections(metadataPath) {
  return loadItems(metadataPath, CONTENT_FOLDER);
}

/** Add game to a collection's games array (for migration / linking). Collections are stored only in blocks. */
function addGameToCollection(metadataPath, collectionId, gameId) {
  return addGameToItem(metadataPath, CONTENT_FOLDER, collectionId, gameId);
}

/** Map(collectionId -> gameIds[]) for building game.collection from blocks. */
function getCollectionToGameIdsMap(metadataPath) {
  return getResourceToGameIdsMap(metadataPath, CONTENT_FOLDER);
}

// Helper function to remove a game from all collections
// collectionsCache: optional in-memory array; when provided, use it instead of loading from disk
function removeGameFromAllCollections(metadataPath, gameId, updateCacheCallback = null, collectionsCache = null) {
  const callback = updateCacheCallback
    ? (item) => updateCacheCallback([item])
    : null;
  return removeGameFromAll(metadataPath, CONTENT_FOLDER, gameId, callback, collectionsCache);
}

/** Delete collection if it has no games left and no local cover (orphan, no custom cover). */
function deleteCollectionIfUnused(metadataPath, collectionId) {
  const list = loadItems(metadataPath, CONTENT_FOLDER);
  const entry = findById(list, collectionId);
  if (!entry) return;
  const games = entry.games || [];
  if (games.length > 0) return;
  const coverPath = path.join(metadataPath, "content", CONTENT_FOLDER, String(collectionId), "cover.webp");
  if (fs.existsSync(coverPath)) return;
  deleteItem(metadataPath, CONTENT_FOLDER, collectionId);
}

// Helper function to create cache updater
function createCacheUpdater(collectionsCache) {
  return (updatedCollections) => {
    for (const updatedCollection of updatedCollections) {
      const cacheIndex = findIndexById(collectionsCache, updatedCollection.id);
      if (cacheIndex !== -1) {
        collectionsCache[cacheIndex] = updatedCollection;
      }
    }
  };
}

function registerCollectionsRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  let collectionsCache = loadCollections(metadataPath);

  // Configure multer for file uploads (memory storage, we'll save manually)
  const upload = multer({ storage: multer.memoryStorage() });

  // Endpoint: list collections
  app.get("/collections", requireToken, (req, res) => {
    res.json({
      collections: collectionsCache.map((c) => {
        // Ensure ID is converted to string for URL encoding
        const collectionId = String(c.id);
        // Calculate gameCount by counting only games that exist in allGames
        const gameIds = c.games || [];
        const actualGameCount = gameIds.filter((gameId) => allGames[gameId]).length;
        const collectionData = {
          id: c.id,
          title: c.title,
          summary: c.summary || "",
          showTitle: c.showTitle,
          gameCount: actualGameCount,
        };
        // Check if cover exists locally
        const localCover = getLocalMediaPath({
          metadataPath,
          resourceId: c.id,
          resourceType: 'collections',
          mediaType: 'cover',
          urlPrefix: '/collection-covers'
        });
        const extCover = externalCoverUrlFromCollectionEntry(c);
        collectionData.cover = localCover || extCover || undefined;
        collectionData.externalCoverUrl = extCover;
        const background = getLocalMediaPath({
          metadataPath,
          resourceId: c.id,
          resourceType: 'collections',
          mediaType: 'background',
          urlPrefix: '/collection-backgrounds'
        });
        if (background) {
          collectionData.background = background;
        }
        return collectionData;
      }),
    });
  });

  // Endpoint: create new collection
  app.post("/collections", requireToken, (req, res) => {
    const { title, summary } = req.body;
    
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Check if collection with same title already exists
    const trimmedTitle = title.trim();
    const existingCollection = collectionsCache.find(
      (c) => c.title.toLowerCase() === trimmedTitle.toLowerCase()
    );
    
    if (existingCollection) {
      return res.status(409).json({ 
        error: "Collection with this title already exists",
        collection: {
          id: existingCollection.id,
          title: existingCollection.title,
        }
      });
    }

    // Generate numeric collection ID from title hash (deterministic, same title = same ID)
    // On rare hash collision, increment until we get an ID not already used
    let collectionId = getCollectionIdFromTitle(trimmedTitle);
    while (collectionsCache.some((c) => c.id === collectionId)) {
      collectionId++;
    }
    
    // Create new collection
    const newCollection = {
      id: collectionId,
      title: trimmedTitle,
      summary: (summary && typeof summary === "string") ? summary.trim() : "",
      showTitle: true,
      games: [],
    };

    // Save collection to its own folder
    try {
      saveItem(metadataPath, CONTENT_FOLDER, newCollection);
      // Add to cache and keep sorted by title (ignore leading The/A)
      collectionsCache.push(newCollection);
      collectionsCache.sort((a, b) =>
        getTitleForSort(a.title).localeCompare(getTitleForSort(b.title))
      );
      
      // Note: Collection content directory is not created during collection creation.
      // It will be created only when uploading cover/background via edit endpoints.
      // Cover and background images will be displayed from IGDB URLs if local files don't exist.
      
      // Return created collection data
      const collectionData = {
        id: newCollection.id,
        title: newCollection.title,
        summary: newCollection.summary || "",
        showTitle: newCollection.showTitle,
        cover: `/collection-covers/${encodeURIComponent(newCollection.id)}`,
        gameCount: 0,
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: newCollection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
      collectionData.background = background || undefined;
      collectionData.externalBackgroundUrl = null;
      
      res.json({ status: "success", collection: collectionData });
    } catch (e) {
      console.error(`Failed to save ${fileName}:`, e.message);
      res.status(500).json({ error: "Failed to create collection" });
    }
  });

  // Endpoint: get single collection by ID
  app.get("/collections/:id", requireToken, (req, res) => {
    const collectionId = req.params.id;
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    const collectionData = {
      id: collection.id,
      title: collection.title,
      summary: collection.summary || "",
      showTitle: collection.showTitle,
      gameCount: (collection.games || []).length,
    };
    const localCover = getLocalMediaPath({
      metadataPath,
      resourceId: collection.id,
      resourceType: 'collections',
      mediaType: 'cover',
      urlPrefix: '/collection-covers'
    });
    const extCover = externalCoverUrlFromCollectionEntry(collection);
    collectionData.cover = localCover || extCover || undefined;
    collectionData.externalCoverUrl = extCover;
    const background = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
    const extBg = externalBackgroundUrlFromCollectionEntry(collection);
    collectionData.background = background || extBg || undefined;
    collectionData.externalBackgroundUrl = extBg;
    
    res.json(collectionData);
  });

  // Endpoint: get games for a collection (returns games by their IDs)
  app.get("/collections/:id/games", requireToken, (req, res) => {
    const collectionId = req.params.id;
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // metadataPath is already the base path

    // Get games by their IDs from the collection
    const gameIds = collection.games || [];
    const collectionGames = [];

    gameIds.forEach((gameId) => {
      const game = allGames[gameId];
      if (game) {
        const similarGamesResolved = (game.similarGames && Array.isArray(game.similarGames) && game.similarGames.length > 0)
          ? game.similarGames.map((id) => ({ id: Number(id), name: (allGames[id] && allGames[id].title) ? String(allGames[id].title) : String(id) }))
          : null;
        const websitesResolved = (game.websites && Array.isArray(game.websites) && game.websites.length > 0)
          ? game.websites.map((u) => (typeof u === "string" ? { url: u } : (u && u.url ? { url: String(u.url) } : null))).filter(Boolean)
          : null;
        const typeId = coerceToGameTypeId(game.type);
        const row = {
          id: game.id,
          title: game.title,
          summary: game.summary || "",
          cover: getCoverUrl(game, metadataPath),
          day: game.day || null,
          month: game.month || null,
          year: game.year || null,
          stars: game.stars || null,
          executables: game.executables || null,
          themes: game.themes || null,
          platforms: game.platforms || null,
          gameModes: game.gameModes || null,
          playerPerspectives: game.playerPerspectives || null,
          websites: websitesResolved,
          ageRatings: game.ageRatings || null,
          developers: game.developers || null,
          publishers: game.publishers || null,
          franchise: game.franchise || null,
          collection: game.collection || null,
          screenshots: game.screenshots || null,
          videos: game.videos || null,
          gameEngines: game.gameEngines || null,
          keywords: game.keywords || null,
          alternativeNames: game.alternativeNames || null,
          similarGames: similarGamesResolved,
        };
        if (typeId != null) row.type = typeId;
        collectionGames.push(row);
        const background = getBackgroundUrl(game, metadataPath);
        if (background) {
          collectionGames[collectionGames.length - 1].background = background;
        }
      }
    });

    res.json({ games: collectionGames });
  });

  // Endpoint: update games order for a collection
  app.put("/collections/:id/games/order", requireToken, (req, res) => {
    const collectionId = req.params.id;
    const { gameIds } = req.body;
    
    if (!Array.isArray(gameIds)) {
      return res.status(400).json({ error: "gameIds must be an array" });
    }

    const collectionIndex = findIndexById(collectionsCache, collectionId);
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Remove duplicate game IDs while preserving order (first occurrence kept)
    const seen = new Set();
    const uniqueGameIds = [];
    for (const gameId of gameIds) {
      const n = normalizeId(gameId);
      if (!seen.has(n)) {
        seen.add(n);
        uniqueGameIds.push(n);
      }
    }
    
    // Log if duplicates were removed
    if (uniqueGameIds.length !== gameIds.length) {
      const duplicateCount = gameIds.length - uniqueGameIds.length;
      console.log(`Removed ${duplicateCount} duplicate game ID(s) from collection ${collectionId}`);
    }

    const collection = collectionsCache[collectionIndex];
    const currentGameIds = collection.games || [];
    const finalGameIds = computeFinalGameIdsForOrder(currentGameIds, uniqueGameIds, allGames);

    // Update the games array
    collection.games = finalGameIds;

    // Save updated collection
    try {
      saveItem(metadataPath, CONTENT_FOLDER, collection);
      res.json({ status: "success" });
    } catch (e) {
      console.error(`Failed to save collection order:`, e.message);
      res.status(500).json({ error: "Failed to save collection order" });
    }
  });

  // Endpoint: update collection fields
  app.put("/collections/:id", requireToken, (req, res) => {
    const collectionId = req.params.id;
    const updates = req.body;
    
    const collectionIndex = findIndexById(collectionsCache, collectionId);
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    // Define allowed fields that can be updated
    const allowedFields = ['title', 'summary', 'showTitle', 'externalCoverUrl', 'externalBackgroundUrl'];
    
    // Filter updates to only include allowed fields
    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {});
    
    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    
    // Load current collection and update it
    const collection = collectionsCache[collectionIndex];
    if ("externalCoverUrl" in filteredUpdates) {
      const v = filteredUpdates.externalCoverUrl;
      if (v == null || v === "") {
        filteredUpdates.externalCoverUrl = null;
      } else if (typeof v !== "string") {
        return res.status(400).json({ error: "externalCoverUrl must be a string or null" });
      } else {
        const t = v.trim();
        filteredUpdates.externalCoverUrl = t.length > 0 ? t : null;
      }
    }
    if ("externalBackgroundUrl" in filteredUpdates) {
      const v = filteredUpdates.externalBackgroundUrl;
      if (v == null || v === "") {
        filteredUpdates.externalBackgroundUrl = null;
      } else if (typeof v !== "string") {
        return res.status(400).json({ error: "externalBackgroundUrl must be a string or null" });
      } else {
        const t = v.trim();
        filteredUpdates.externalBackgroundUrl = t.length > 0 ? t : null;
      }
    }
    Object.assign(collection, filteredUpdates);
    
    // Save updated collection
    try {
      saveItem(metadataPath, CONTENT_FOLDER, collection);
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        gameCount: (collection.games || []).length,
      };
      const localCover = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'cover',
        urlPrefix: '/collection-covers'
      });
      const extCover = externalCoverUrlFromCollectionEntry(collection);
      collectionData.cover = localCover || extCover || undefined;
      collectionData.externalCoverUrl = extCover;
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      res.json({ status: "success", collection: collectionData });
    } catch (e) {
      console.error(`Failed to save ${fileName}:`, e.message);
      res.status(500).json({ error: "Failed to save collection updates" });
    }
  });

  // Endpoint: delete collection
  app.delete("/collections/:id", requireToken, (req, res) => {
    const collectionId = req.params.id;
    
    const collectionIndex = findIndexById(collectionsCache, collectionId);
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Delete collection folder and its metadata.json
    deleteItem(metadataPath, CONTENT_FOLDER, collectionId);
    
    // Remove collection from cache
    collectionsCache.splice(collectionIndex, 1);
    
    // Note: Collection content directory (cover, background, etc.) is also deleted with the folder
    
    res.json({ status: "success" });
  });

  // Endpoint: serve collection cover image (public, no auth required for images)
  app.get("/collection-covers/:collectionId", (req, res) => {
    const collectionId = decodeURIComponent(req.params.collectionId);
    const coverPath = path.join(metadataPath, "content", "collections", String(collectionId), "cover.webp");

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Check if file exists
    if (!fs.existsSync(coverPath)) {
      // Return 404 with image content type to avoid CORB issues
      res.setHeader('Content-Type', 'image/webp');
      return res.status(404).end();
    }

    // Set appropriate content type for webp
    res.type("image/webp");
    res.sendFile(coverPath);
  });

  // Endpoint: upload cover image for a collection
  app.post("/collections/:id/upload-cover", requireToken, upload.single('file'), (req, res) => {
    const collectionId = req.params.id;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }
    
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    try {
      // Create collection content directory if it doesn't exist
      const collectionContentDir = path.join(metadataPath, "content", "collections", String(collectionId));
      ensureDirectoryExists(collectionContentDir);
      
      // Save as cover.webp
      const coverPath = path.join(collectionContentDir, "cover.webp");
      fs.writeFileSync(coverPath, file.buffer);
      
      // Return updated collection data
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        cover: `/collection-covers/${encodeURIComponent(collection.id)}`,
        gameCount: (collection.games || []).length,
      };
      const background = getLocalMediaPath({
      metadataPath,
      resourceId: collection.id,
      resourceType: 'collections',
      mediaType: 'background',
      urlPrefix: '/collection-backgrounds'
    });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      res.json({ 
        status: "success",
        collection: collectionData,
      });
    } catch (error) {
      console.error(`Failed to save cover for collection ${collectionId}:`, error);
      res.status(500).json({ error: "Failed to save cover image" });
    }
  });

  // Endpoint: upload background image for a collection
  app.post("/collections/:id/upload-background", requireToken, upload.single('file'), (req, res) => {
    const collectionId = req.params.id;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }
    
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    try {
      // Create collection content directory if it doesn't exist
      const collectionContentDir = path.join(metadataPath, "content", "collections", String(collectionId));
      ensureDirectoryExists(collectionContentDir);
      
      // Save as background.webp
      const backgroundPath = path.join(collectionContentDir, "background.webp");
      fs.writeFileSync(backgroundPath, file.buffer);
      
      // Return updated collection data
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        cover: `/collection-covers/${encodeURIComponent(collection.id)}`,
        gameCount: (collection.games || []).length,
      };
      const background = getLocalMediaPath({
      metadataPath,
      resourceId: collection.id,
      resourceType: 'collections',
      mediaType: 'background',
      urlPrefix: '/collection-backgrounds'
    });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      res.json({ 
        status: "success",
        collection: collectionData,
      });
    } catch (error) {
      console.error(`Failed to save background for collection ${collectionId}:`, error);
      res.status(500).json({ error: "Failed to save background image" });
    }
  });

  // Endpoint: delete cover image for a collection
  app.delete("/collections/:id/delete-cover", requireToken, (req, res) => {
    const collectionId = req.params.id;
    
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    try {
      // Delete the cover file
      deleteMediaFile({
        metadataPath,
        resourceId: collectionId,
        resourceType: 'collections',
        mediaType: 'cover'
      });
      
      // Return updated collection data
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        cover: getLocalMediaPath({
          metadataPath,
          resourceId: collection.id,
          resourceType: 'collections',
          mediaType: 'cover',
          urlPrefix: '/collection-covers'
        }) || undefined,
        gameCount: (collection.games || []).length,
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      res.json({ 
        status: "success",
        collection: collectionData,
      });
    } catch (error) {
      console.error(`Failed to delete cover for collection ${collectionId}:`, error);
      res.status(500).json({ error: "Failed to delete cover image" });
    }
  });

  // Endpoint: delete background image for a collection
  app.delete("/collections/:id/delete-background", requireToken, (req, res) => {
    const collectionId = req.params.id;
    
    const collection = findById(collectionsCache, collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    try {
      // Delete the background file
      deleteMediaFile({
        metadataPath,
        resourceId: collectionId,
        resourceType: 'collections',
        mediaType: 'background'
      });
      
      // Return updated collection data
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        cover: getLocalMediaPath({
          metadataPath,
          resourceId: collection.id,
          resourceType: 'collections',
          mediaType: 'cover',
          urlPrefix: '/collection-covers'
        }) || undefined,
        gameCount: (collection.games || []).length,
      };
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      res.json({ 
        status: "success",
        collection: collectionData,
      });
    } catch (error) {
      console.error(`Failed to delete background for collection ${collectionId}:`, error);
      res.status(500).json({ error: "Failed to delete background image" });
    }
  });

  // Endpoint: reload metadata for a single collection
  app.post("/collections/:id/reload", requireToken, (req, res) => {
    const collectionId = req.params.id;
    
    try {
      // Reload collections to refresh metadata
      collectionsCache = loadCollections(metadataPath);
      
      const collection = findById(collectionsCache, collectionId);
      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }
      
      // Format collection data like other endpoints
      const collectionData = {
        id: collection.id,
        title: collection.title,
        summary: collection.summary || "",
        showTitle: collection.showTitle,
        cover: `/collection-covers/${encodeURIComponent(String(collection.id))}`,
        gameCount: (collection.games || []).length,
      };
      // Check if cover exists locally
      const localCover = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'cover',
        urlPrefix: '/collection-covers'
      });
      if (localCover) {
        collectionData.cover = localCover;
      }
      const background = getLocalMediaPath({
        metadataPath,
        resourceId: collection.id,
        resourceType: 'collections',
        mediaType: 'background',
        urlPrefix: '/collection-backgrounds'
      });
      const extBg = externalBackgroundUrlFromCollectionEntry(collection);
      collectionData.background = background || extBg || undefined;
      collectionData.externalBackgroundUrl = extBg;
      
      // Return updated collection data
      res.json({ status: "reloaded", collection: collectionData });
    } catch (e) {
      console.error(`Failed to reload collection ${collectionId}:`, e.message);
      res.status(500).json({ error: "Failed to reload collection metadata" });
    }
  });

  // Return reload function
  return {
    reload: () => {
      collectionsCache = loadCollections(metadataPath);
      return collectionsCache;
    },
    getCache: () => collectionsCache,
  };
}

module.exports = {
  loadCollections,
  addGameToCollection,
  getCollectionToGameIdsMap,
  registerCollectionsRoutes,
  removeGameFromAllCollections,
  createCacheUpdater,
  deleteCollectionIfUnused,
};

