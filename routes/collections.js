const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { getCoverUrl, getBackgroundUrl, getLocalMediaPath, deleteMediaFile } = require("../utils/gameMediaUtils");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");

/**
 * Collections routes module
 * Handles collections endpoints
 */

// Helper function to get collection metadata file path
function getCollectionMetadataPath(metadataPath, collectionId) {
  return path.join(metadataPath, "content", "collections", String(collectionId), "metadata.json");
}

// Helper function to save a single collection
function saveCollection(metadataPath, collection) {
  const collectionDir = path.join(metadataPath, "content", "collections", String(collection.id));
  ensureDirectoryExists(collectionDir);
  const filePath = getCollectionMetadataPath(metadataPath, collection.id);
  // Remove id from saved data (it's in the folder name)
  const collectionToSave = { ...collection };
  delete collectionToSave.id;
  writeJsonFile(filePath, collectionToSave);
}

// Helper function to load a single collection
function loadCollection(metadataPath, collectionId) {
  const filePath = getCollectionMetadataPath(metadataPath, collectionId);
  return readJsonFile(filePath, null);
}

// Helper function to delete a collection
function deleteCollection(metadataPath, collectionId) {
  const collectionDir = path.join(metadataPath, "content", "collections", String(collectionId));
  const metadataFile = getCollectionMetadataPath(metadataPath, collectionId);
  
  // Delete only metadata.json
  if (fs.existsSync(metadataFile)) {
    try {
      fs.unlinkSync(metadataFile);
    } catch (err) {
      console.error(`Failed to delete metadata.json for collection ${collectionId}:`, err.message);
      throw err;
    }
  }
  
  // Remove directory only if it's empty after deleting metadata.json
  if (fs.existsSync(collectionDir)) {
    removeDirectoryIfEmpty(collectionDir);
  }
}

function loadCollections(metadataPath) {
  const collectionsDir = path.join(metadataPath, "content", "collections");
  const collections = [];
  
  if (!fs.existsSync(collectionsDir)) {
    return collections;
  }
  
  // Read all subdirectories (each collection has its own folder)
  const collectionFolders = fs.readdirSync(collectionsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  // Load each collection's metadata.json
  collectionFolders.forEach((normalizedId) => {
    const collectionMetadataPath = path.join(collectionsDir, normalizedId, "metadata.json");
    if (fs.existsSync(collectionMetadataPath)) {
      const collection = readJsonFile(collectionMetadataPath, null);
      if (collection) {
        // Use folder name as ID (the folder name is the normalized collection ID)
        // Convert to number if it's numeric, otherwise keep as string
        collection.id = /^\d+$/.test(normalizedId) ? Number(normalizedId) : normalizedId;
        collections.push(collection);
      }
    }
  });
  
  return collections;
}

// Helper function to remove a game from all collections
// collectionsCache: optional in-memory array; when provided, use it instead of loading from disk
function removeGameFromAllCollections(metadataPath, gameId, updateCacheCallback = null, collectionsCache = null) {
  try {
    const collections =
      collectionsCache && Array.isArray(collectionsCache) ? collectionsCache : loadCollections(metadataPath);
    const updatedCollections = [];
    let updatedCount = 0;
    
    for (const collection of collections) {
      if (collection.games && Array.isArray(collection.games)) {
        // Check if gameId is in the collection's games array
        const gameIndex = collection.games.findIndex(id => {
          // Handle both number and string IDs
          const collectionGameId = typeof id === 'number' ? id : Number(id);
          const targetGameId = typeof gameId === 'number' ? gameId : Number(gameId);
          return !isNaN(collectionGameId) && !isNaN(targetGameId) && collectionGameId === targetGameId;
        });
        
        if (gameIndex !== -1) {
          // Remove gameId from the array
          collection.games.splice(gameIndex, 1);
          // Save updated collection
          saveCollection(metadataPath, collection);
          updatedCollections.push(collection);
          updatedCount++;
        }
      }
    }
    
    if (updatedCount > 0) {
      console.log(`Removed game ${gameId} from ${updatedCount} collection(s)`);
      
      // Update cache only for modified collections if callback provided
      if (updateCacheCallback && typeof updateCacheCallback === 'function') {
        updateCacheCallback(updatedCollections);
      }
    }
    
    return updatedCount;
  } catch (error) {
    console.error(`Failed to remove game ${gameId} from collections:`, error);
    return 0;
  }
}

// Helper function to create cache updater
function createCacheUpdater(collectionsCache) {
  return (updatedCollections) => {
    for (const updatedCollection of updatedCollections) {
      // Find and update the collection in cache
      const cacheIndex = collectionsCache.findIndex(c => {
        if (typeof c.id === 'number' && typeof updatedCollection.id === 'number') {
          return c.id === updatedCollection.id;
        }
        return String(c.id) === String(updatedCollection.id);
      });
      
      if (cacheIndex !== -1) {
        collectionsCache[cacheIndex] = updatedCollection;
      }
    }
  };
}

// Helper function to compare two games by a specific field
function compareGamesByField(gameA, gameB, field = 'releaseDate', ascending = true) {
  let compareResult = 0;

  switch (field) {
    case 'releaseDate':
      // Games not found or without release date go to the end
      if (!gameA || (!gameA.year && !gameA.month && !gameA.day)) return 1;
      if (!gameB || (!gameB.year && !gameB.month && !gameB.day)) return -1;

      // Compare by year
      if (gameA.year !== gameB.year) {
        compareResult = (gameA.year || 0) - (gameB.year || 0);
      } else if (gameA.month !== gameB.month) {
        // If years are equal, compare by month
        compareResult = (gameA.month || 0) - (gameB.month || 0);
      } else {
        // If months are equal, compare by day
        compareResult = (gameA.day || 0) - (gameB.day || 0);
      }
      break;
    case 'year':
      const yearA = gameA?.year ?? 0;
      const yearB = gameB?.year ?? 0;
      if (yearA === 0 && yearB === 0) compareResult = 0;
      else if (yearA === 0) compareResult = 1;
      else if (yearB === 0) compareResult = -1;
      else compareResult = yearA - yearB;
      break;
    case 'title':
      const titleA = (gameA?.title || '').toLowerCase();
      const titleB = (gameB?.title || '').toLowerCase();
      compareResult = titleA.localeCompare(titleB);
      break;
    case 'stars':
      const starsA = gameA?.stars ?? 0;
      const starsB = gameB?.stars ?? 0;
      compareResult = starsA - starsB;
      break;
    case 'criticRating':
      const criticA = gameA?.criticratings ?? 0;
      const criticB = gameB?.criticratings ?? 0;
      compareResult = criticA - criticB;
      break;
    case 'userRating':
      const userA = gameA?.userratings ?? 0;
      const userB = gameB?.userratings ?? 0;
      compareResult = userA - userB;
      break;
    default:
      compareResult = 0;
  }

  return ascending ? compareResult : -compareResult;
}

// Helper function to sort game IDs by a specific field
function sortGameIdsByField(gameIds, allGames, field = 'releaseDate', ascending = true) {
  return [...gameIds].sort((idA, idB) => {
    const gameA = allGames[idA];
    const gameB = allGames[idB];
    return compareGamesByField(gameA, gameB, field, ascending);
  });
}

// Helper function to insert a game ID into an array at the correct position based on release date
// Finds the first element with release date greater than the new game and inserts before it
function insertGameIdInSortedPosition(gameIds, newGameId, allGames) {
  // Check if game already exists
  const normalizedNewId = /^\d+$/.test(String(newGameId)) ? Number(newGameId) : newGameId;
  const exists = gameIds.some(id => {
    const normalizedId = /^\d+$/.test(String(id)) ? Number(id) : id;
    return normalizedId === normalizedNewId;
  });
  
  if (exists) {
    return gameIds; // Game already exists, return original array
  }

  const newGame = allGames[newGameId];
  if (!newGame) {
    // Game not found in allGames, append to end
    return [...gameIds, newGameId];
  }

  // Find the first element with release date greater than the new game
  for (let i = 0; i < gameIds.length; i++) {
    const existingGame = allGames[gameIds[i]];
    if (existingGame && compareGamesByField(newGame, existingGame, 'releaseDate', true) < 0) {
      // Insert before this element
      const result = [...gameIds];
      result.splice(i, 0, newGameId);
      return result;
    }
  }

  // No element found with greater release date, append to end
  return [...gameIds, newGameId];
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
        if (localCover) {
          collectionData.cover = localCover;
        }
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

    // Generate numeric collection ID (timestamp-based for uniqueness)
    const collectionId = Date.now();
    
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
      saveCollection(metadataPath, newCollection);
      // Add to cache
      collectionsCache.push(newCollection);
      
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
      if (background) {
        collectionData.background = background;
      }
      
      res.json({ status: "success", collection: collectionData });
    } catch (e) {
      console.error(`Failed to save ${fileName}:`, e.message);
      res.status(500).json({ error: "Failed to create collection" });
    }
  });

  // Endpoint: get single collection by ID
  app.get("/collections/:id", requireToken, (req, res) => {
    const collectionId = req.params.id;
    // Normalize ID for comparison (convert both to string or number)
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    const collection = collectionsCache.find((c) => {
      // Compare as numbers if both are numeric, otherwise as strings
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
    
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
    if (background) {
      collectionData.background = background;
    }
    
    res.json(collectionData);
  });

  // Endpoint: get games for a collection (returns games by their IDs)
  app.get("/collections/:id/games", requireToken, (req, res) => {
    const collectionId = req.params.id;
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    const collection = collectionsCache.find((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
    
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
        collectionGames.push({
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
          websites: game.websites || null,
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
          similarGames: game.similarGames || null,
        });
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

    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    const collectionIndex = collectionsCache.findIndex((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
    
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Remove duplicate game IDs while preserving order (first occurrence kept)
    const seen = new Set();
    const uniqueGameIds = [];
    for (const gameId of gameIds) {
      // Normalize gameId for comparison (convert to number if numeric, otherwise keep as string)
      const normalizedGameId = /^\d+$/.test(String(gameId)) ? Number(gameId) : gameId;
      if (!seen.has(normalizedGameId)) {
        seen.add(normalizedGameId);
        uniqueGameIds.push(normalizedGameId);
      }
    }
    
    // Log if duplicates were removed
    if (uniqueGameIds.length !== gameIds.length) {
      const duplicateCount = gameIds.length - uniqueGameIds.length;
      console.log(`Removed ${duplicateCount} duplicate game ID(s) from collection ${collectionId}`);
    }

    // Get the current games in the collection (before update)
    const collection = collectionsCache[collectionIndex];
    const currentGameIds = collection.games || [];
    
    // Check if this is likely an addition (one new game added) vs a reorder
    const isAddition = uniqueGameIds.length === currentGameIds.length + 1;
    
    let finalGameIds;
    if (isAddition) {
      // Find the new game and insert it in the correct position
      const newGameId = uniqueGameIds.find(id => {
        const normalizedId = /^\d+$/.test(String(id)) ? Number(id) : id;
        return !currentGameIds.some(currentId => {
          const normalizedCurrentId = /^\d+$/.test(String(currentId)) ? Number(currentId) : currentId;
          return normalizedCurrentId === normalizedId;
        });
      });
      
      if (newGameId) {
        // Insert the new game in the correct position
        finalGameIds = insertGameIdInSortedPosition(currentGameIds, newGameId, allGames);
      } else {
        // Fallback: full sort if we can't identify the new game
        finalGameIds = sortGameIdsByField(uniqueGameIds, allGames, 'releaseDate', true);
      }
    } else {
      // Full reorder: sort all games by release date
      finalGameIds = sortGameIdsByField(uniqueGameIds, allGames, 'releaseDate', true);
    }

    // Update the games array
    collection.games = finalGameIds;

    // Save updated collection
    try {
      saveCollection(metadataPath, collection);
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
    
    // Validate collection exists
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    const collectionIndex = collectionsCache.findIndex((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    // Define allowed fields that can be updated
    const allowedFields = ['title', 'summary', 'showTitle'];
    
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
    Object.assign(collection, filteredUpdates);
    
    // Save updated collection
    try {
      saveCollection(metadataPath, collection);
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
      if (background) {
        collectionData.background = background;
      }
      
      res.json({ status: "success", collection: collectionData });
    } catch (e) {
      console.error(`Failed to save ${fileName}:`, e.message);
      res.status(500).json({ error: "Failed to save collection updates" });
    }
  });

  // Endpoint: delete collection
  app.delete("/collections/:id", requireToken, (req, res) => {
    const collectionId = req.params.id;
    
    // Find collection index
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    const collectionIndex = collectionsCache.findIndex((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
    
    if (collectionIndex === -1) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Delete collection folder and its metadata.json
    deleteCollection(metadataPath, collectionId);
    
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
    
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    // Validate collection exists
    const collection = collectionsCache.find((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
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
      if (background) {
        collectionData.background = background;
      }
      
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
    
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    // Validate collection exists
    const collection = collectionsCache.find((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
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
      if (background) {
        collectionData.background = background;
      }
      
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
    
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    // Validate collection exists
    const collection = collectionsCache.find((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
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
      if (background) {
        collectionData.background = background;
      }
      
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
    
    // Normalize ID for comparison
    const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
    // Validate collection exists
    const collection = collectionsCache.find((c) => {
      if (typeof normalizedId === 'number' && typeof c.id === 'number') {
        return c.id === normalizedId;
      }
      return String(c.id) === String(normalizedId);
    });
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
      if (background) {
        collectionData.background = background;
      }
      
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
      
      // Normalize ID for comparison
      const normalizedId = /^\d+$/.test(collectionId) ? Number(collectionId) : collectionId;
      // Find the collection
      const collection = collectionsCache.find((c) => {
        if (typeof normalizedId === 'number' && typeof c.id === 'number') {
          return c.id === normalizedId;
        }
        return String(c.id) === String(normalizedId);
      });
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
      if (background) {
        collectionData.background = background;
      }
      
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
  registerCollectionsRoutes,
  removeGameFromAllCollections,
  createCacheUpdater,
};

