const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  ensureCategoriesExistBatch,
  deleteCategoryIfUnused,
  normalizeCategoryFieldToIds,
  getTagToGameIdsMap: getCategoryToGameIdsMap,
  addGameToTag: addGameToCategory,
  removeGameFromTag: removeGameFromCategory,
} = require("./categories");
const {
  ensureThemesExistBatch,
  deleteThemeIfUnused,
  normalizeThemeFieldToIds,
  getTagToGameIdsMap: getThemeToGameIdsMap,
  addGameToTag: addGameToTheme,
  removeGameFromTag: removeGameFromTheme,
} = require("./themes");
const {
  ensurePlatformsExistBatch,
  deletePlatformIfUnused,
  normalizePlatformFieldToIds,
  getTagToGameIdsMap: getPlatformToGameIdsMap,
  addGameToTag: addGameToPlatform,
  removeGameFromTag: removeGameFromPlatform,
} = require("./platforms");
const {
  ensureGameEnginesExistBatch,
  deleteGameEngineIfUnused,
  normalizeGameEngineFieldToIds,
  getTagToGameIdsMap: getGameEngineToGameIdsMap,
  addGameToTag: addGameToGameEngine,
  removeGameFromTag: removeGameFromGameEngine,
} = require("./gameengines");
const {
  ensureGameModesExistBatch,
  deleteGameModeIfUnused,
  normalizeGameModeFieldToIds,
  getTagToGameIdsMap: getGameModeToGameIdsMap,
  addGameToTag: addGameToGameMode,
  removeGameFromTag: removeGameFromGameMode,
} = require("./gamemodes");
const {
  ensurePlayerPerspectivesExistBatch,
  deletePlayerPerspectiveIfUnused,
  normalizePlayerPerspectiveFieldToIds,
  getTagToGameIdsMap: getPlayerPerspectiveToGameIdsMap,
  addGameToTag: addGameToPlayerPerspective,
  removeGameFromTag: removeGameFromPlayerPerspective,
} = require("./playerperspectives");
const { removeGameFromRecommended } = require("./recommended");
const {
  removeGameFromAllCollections,
  addGameToCollection,
  getCollectionToGameIdsMap,
  deleteCollectionIfUnused,
} = require("./collections");
const {
  ensureDevelopersExistBatch,
  removeGameFromAllDevelopers,
  deleteDeveloperIfUnused,
  removeGameFromDeveloper,
  addGameToDeveloper,
  getDeveloperToGameIdsMap,
} = require("./developers");
const {
  ensurePublishersExistBatch,
  removeGameFromAllPublishers,
  deletePublisherIfUnused,
  removeGameFromPublisher,
  addGameToPublisher,
  getPublisherToGameIdsMap,
} = require("./publishers");
const {
  ensureFranchiseExistBatch,
  deleteFranchiseIfUnused,
  addGameToFranchise,
  removeGameFromFranchise,
  getFranchiseToGameIdsMap,
} = require("./franchises");
const {
  ensureSeriesExistBatch,
  deleteSeriesIfUnused,
  addGameToSeries,
  removeGameFromSeries,
  getSeriesToGameIdsMap,
} = require("./series");
const { getCoverUrl, getBackgroundUrl, deleteMediaFile } = require("../utils/gameMediaUtils");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");
const { getTitleForSort } = require("../utils/sortUtils");


/**
 * Library routes module
 * Handles the main library games endpoint
 */

// Helper function to get game metadata file path
function getGameMetadataPath(metadataPath, gameId) {
  return path.join(metadataPath, "content", "games", String(gameId), "metadata.json");
}

/** Normalize tag-like field to array of numeric ids only. Accepts only numbers (no objects). */
function toIdsOnlyArray(val) {
  if (val == null) return [];
  const arr = Array.isArray(val) ? val : [val];
  const result = [];
  const seen = new Set();
  for (const raw of arr) {
    if (raw == null) continue;
    if (typeof raw !== "number" || Number.isNaN(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    result.push(raw);
  }
  return result;
}

/** Return array of numeric ids or null for franchise/collection fields. */
function validateIdArray(val) {
  const arr = toIdsOnlyArray(val);
  return arr.length > 0 ? arr : null;
}

// Helper function to save a single game. Tag fields (genre, themes, platforms, etc.) are stored only in tag blocks, not in game metadata.
function saveGame(metadataPath, game) {
  const gameId = game.id;
  const gameDir = path.join(metadataPath, "content", "games", String(gameId));
  ensureDirectoryExists(gameDir);
  const filePath = getGameMetadataPath(metadataPath, gameId);
  const gameToSave = { ...game };
  delete gameToSave.id;
  // Do not write tag/relation fields to game file; they live in their blocks (gameIds)
  delete gameToSave.genre;
  delete gameToSave.themes;
  delete gameToSave.platforms;
  delete gameToSave.gameEngines;
  delete gameToSave.gameModes;
  delete gameToSave.playerPerspectives;
  delete gameToSave.developers;
  delete gameToSave.publishers;
  delete gameToSave.franchise;
  delete gameToSave.collection;
  writeJsonFile(filePath, gameToSave);
}

// Helper function to load a single game (metadata.json no longer has genre/themes/platforms/etc.; those come from tag blocks)
function loadGame(metadataPath, gameId) {
  const filePath = getGameMetadataPath(metadataPath, gameId);
  return readJsonFile(filePath, null);
}

/** Get tag/relation ids for a single game from blocks (genre, themes, platforms, …, developers, publishers, franchise, collection). */
function getGameTagIdsFromBlocks(metadataPath, gameId) {
  const result = {
    genre: [],
    themes: [],
    platforms: [],
    gameModes: [],
    playerPerspectives: [],
    gameEngines: [],
    developers: [],
    publishers: [],
    franchise: [],
    collection: [],
  };
  const pairs = [
    [getCategoryToGameIdsMap(metadataPath), "genre"],
    [getThemeToGameIdsMap(metadataPath), "themes"],
    [getPlatformToGameIdsMap(metadataPath), "platforms"],
    [getGameModeToGameIdsMap(metadataPath), "gameModes"],
    [getPlayerPerspectiveToGameIdsMap(metadataPath), "playerPerspectives"],
    [getGameEngineToGameIdsMap(metadataPath), "gameEngines"],
    [getDeveloperToGameIdsMap(metadataPath), "developers"],
    [getPublisherToGameIdsMap(metadataPath), "publishers"],
    [getFranchiseToGameIdsMap(metadataPath), "franchise"],
    [getSeriesToGameIdsMap(metadataPath), "collection"],
  ];
  for (const [map, key] of pairs) {
    for (const [tagId, gameIds] of map) {
      if (gameIds.includes(gameId)) result[key].push(tagId);
    }
  }
  return result;
}

/** Build reverse map gameId -> { genre, themes, ..., developers, publishers, franchise, collection } from blocks and apply to allGames. */
function applyTagReverseMapToGames(metadataPath, allGames) {
  const pairs = [
    [getCategoryToGameIdsMap(metadataPath), "genre"],
    [getThemeToGameIdsMap(metadataPath), "themes"],
    [getPlatformToGameIdsMap(metadataPath), "platforms"],
    [getGameModeToGameIdsMap(metadataPath), "gameModes"],
    [getPlayerPerspectiveToGameIdsMap(metadataPath), "playerPerspectives"],
    [getGameEngineToGameIdsMap(metadataPath), "gameEngines"],
    [getDeveloperToGameIdsMap(metadataPath), "developers"],
    [getPublisherToGameIdsMap(metadataPath), "publishers"],
    [getFranchiseToGameIdsMap(metadataPath), "franchise"],
    [getSeriesToGameIdsMap(metadataPath), "collection"],
  ];
  for (const [map, key] of pairs) {
    for (const [tagId, gameIds] of map) {
      for (const gid of gameIds) {
        if (!allGames[gid]) continue;
        if (!allGames[gid][key]) allGames[gid][key] = [];
        if (!allGames[gid][key].includes(tagId)) allGames[gid][key].push(tagId);
      }
    }
  }
  for (const game of Object.values(allGames)) {
    if (!game.genre) game.genre = [];
    if (!game.themes) game.themes = [];
    if (!game.platforms) game.platforms = [];
    if (!game.gameModes) game.gameModes = [];
    if (!game.playerPerspectives) game.playerPerspectives = [];
    if (!game.gameEngines) game.gameEngines = [];
    if (!game.developers) game.developers = [];
    if (!game.publishers) game.publishers = [];
    if (!game.franchise) game.franchise = [];
    if (!game.collection) game.collection = [];
  }
}

/** Remove a game from all tag blocks (genre, themes, platforms, gameModes, playerPerspectives, gameEngines). */
function removeGameFromAllTagBlocks(metadataPath, gameId) {
  const pairs = [
    [getCategoryToGameIdsMap(metadataPath), removeGameFromCategory],
    [getThemeToGameIdsMap(metadataPath), removeGameFromTheme],
    [getPlatformToGameIdsMap(metadataPath), removeGameFromPlatform],
    [getGameModeToGameIdsMap(metadataPath), removeGameFromGameMode],
    [getPlayerPerspectiveToGameIdsMap(metadataPath), removeGameFromPlayerPerspective],
    [getGameEngineToGameIdsMap(metadataPath), removeGameFromGameEngine],
  ];
  for (const [map, removeFn] of pairs) {
    for (const [tagId, gameIds] of map) {
      if (gameIds.includes(gameId)) removeFn(metadataPath, tagId, gameId);
    }
  }
}

// Normalize franchise/collection/series to array for API responses (supports legacy single value)
function toFranchiseSeriesArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/** Resolve array of numeric ids to [{ id, name }] using list of { id, title }. Input: only numbers. */
function resolveDevPubIdsToObjects(list, ids) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map((list || []).map((d) => [Number(d.id), d]));
  const result = [];
  const seen = new Set();
  for (const raw of ids) {
    if (raw == null || typeof raw !== "number" || Number.isNaN(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    const entry = byId.get(raw);
    result.push({ id: raw, name: entry && entry.title != null ? String(entry.title).trim() : String(raw) });
  }
  return result;
}

/** Resolve developer/publisher ids to [{ id, name }] when list is provided. */
function resolveDeveloperPublisherNames(ids, list) {
  if (!list || !Array.isArray(list) || !ids || ids.length === 0) return null;
  const byId = new Map(list.map((x) => [Number(x.id), x]));
  return ids.map((id) => {
    const numId = Number(typeof id === "object" && id != null && id.id != null ? id.id : id);
    const entry = byId.get(numId);
    const name = entry && (entry.title || entry.name) ? String(entry.title || entry.name).trim() : String(numId);
    return { id: numId, name };
  });
}

/** Resolve websites (stored as url[] in metadata) to [{ url }] for API. Accepts legacy [{ url, category? }] too. */
function resolveWebsitesForResponse(websitesField) {
  if (websitesField == null || !Array.isArray(websitesField)) return null;
  if (websitesField.length === 0) return null;
  const result = websitesField
    .map((x) => (typeof x === "string" && x.trim() ? { url: x.trim() } : (x && typeof x === "object" && x.url ? { url: String(x.url).trim() } : null)))
    .filter((o) => o && o.url);
  return result.length > 0 ? result : null;
}

/** Resolve similarGames (stored as id[] in metadata) to [{ id, name }] using allGames. Accepts legacy [{ id, name }] too. */
function resolveSimilarGamesForResponse(similarGamesField, allGames) {
  if (similarGamesField == null || !Array.isArray(similarGamesField)) return null;
  if (similarGamesField.length === 0) return null;
  const ids = similarGamesField.map((x) => {
    if (typeof x === "number" && !Number.isNaN(x)) return x;
    if (typeof x === "object" && x != null && x.id != null) return Number(x.id);
    return null;
  }).filter((id) => id != null && !Number.isNaN(id));
  if (ids.length === 0) return null;
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const g = allGames && allGames[id];
    result.push({ id, name: (g && g.title) ? String(g.title).trim() : String(id) });
  }
  return result.length > 0 ? result : null;
}

/** Build game response: tag fields are id arrays; developers/publishers/similarGames enriched when lists/allGames passed. */
function buildGameResponse(metadataPath, game, developersList = null, publishersList = null, allGames = null) {
  const executables = getExecutablesWithOrder(metadataPath, game.id, game);
  const devIds = game.developers && Array.isArray(game.developers) ? game.developers : [];
  const pubIds = game.publishers && Array.isArray(game.publishers) ? game.publishers : [];
  const developersResolved = resolveDeveloperPublisherNames(devIds, developersList);
  const publishersResolved = resolveDeveloperPublisherNames(pubIds, publishersList);
  const gameData = {
    id: game.id,
    title: game.title,
    summary: game.summary || "",
    cover: getCoverUrl(game, metadataPath),
    day: game.day || null,
    month: game.month || null,
    year: game.year || null,
    stars: game.stars || null,
    genre: game.genre && game.genre.length ? game.genre : null,
    criticratings: game.criticratings || null,
    userratings: game.userratings || null,
    executables: executables.length > 0 ? executables : null,
    themes: game.themes && game.themes.length ? game.themes : null,
    platforms: game.platforms && game.platforms.length ? game.platforms : null,
    gameModes: game.gameModes && game.gameModes.length ? game.gameModes : null,
    playerPerspectives: game.playerPerspectives && game.playerPerspectives.length ? game.playerPerspectives : null,
    websites: resolveWebsitesForResponse(game.websites),
    ageRatings: game.ageRatings || null,
    developers: developersResolved && developersResolved.length > 0 ? developersResolved : (devIds.length > 0 ? devIds : null),
    publishers: publishersResolved && publishersResolved.length > 0 ? publishersResolved : (pubIds.length > 0 ? pubIds : null),
    franchise: toFranchiseSeriesArray(game.franchise),
    collection: toFranchiseSeriesArray(game.collection),
    series: toFranchiseSeriesArray(game.collection),
    screenshots: game.screenshots || null,
    videos: game.videos || null,
    gameEngines: game.gameEngines && game.gameEngines.length ? game.gameEngines : null,
    keywords: game.keywords || null,
    alternativeNames: game.alternativeNames || null,
    similarGames: resolveSimilarGamesForResponse(game.similarGames, allGames),
    showTitle: game.showTitle,
  };
  const backgroundUrl = getBackgroundUrl(game, metadataPath);
  if (backgroundUrl) gameData.background = backgroundUrl;
  return gameData;
}

// Helper function to get executable names from game directory
// Returns array of names (without extension) from .sh and .bat files
function getExecutableNames(metadataPath, gameId) {
  const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
  const executableNames = [];
  
  if (!fs.existsSync(gameContentDir)) {
    return executableNames;
  }
  
  // Read all .sh and .bat files in the game directory
  let files;
  try {
    files = fs.readdirSync(gameContentDir);
  } catch (err) {
    console.warn(`Failed to read game directory ${gameContentDir}:`, err.message);
    return executableNames;
  }
  
  const executableFiles = files.filter(file => {
    // Only include files, not directories
    const filePath = path.join(gameContentDir, file);
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
    const ext = path.extname(file).toLowerCase();
    return ext === '.sh' || ext === '.bat';
  });
  
  // Sort files: script.sh/script.bat first (for backward compatibility), then others alphabetically
  executableFiles.sort((a, b) => {
    const aIsScript = a.startsWith('script.');
    const bIsScript = b.startsWith('script.');
    if (aIsScript && !bIsScript) return -1;
    if (!aIsScript && bIsScript) return 1;
    return a.localeCompare(b);
  });
  
  // Extract names (without extension)
  executableFiles.forEach((file) => {
    const name = path.basename(file, path.extname(file));
    executableNames.push(name);
  });
  
  return executableNames;
}

// Helper function to sanitize executable name for filesystem (convert invalid chars to underscore)
function sanitizeExecutableName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Helper function to get executables respecting order from metadata.json
// If metadata.json has executables, use that order (and verify files exist)
// Otherwise, read from directory
function getExecutablesWithOrder(metadataPath, gameId, gameMetadata = null) {
  // Load game metadata if not provided
  if (!gameMetadata) {
    gameMetadata = loadGame(metadataPath, gameId);
  }
  
  // If metadata.json has executables array, use it (respecting order)
  if (gameMetadata && gameMetadata.executables && Array.isArray(gameMetadata.executables) && gameMetadata.executables.length > 0) {
    // Verify that all executables in metadata exist as files
    const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
    const validExecutables = [];
    
    for (const execName of gameMetadata.executables) {
      if (typeof execName !== 'string' || !execName.trim()) continue;
      
      // Sanitize name for filesystem lookup (files are saved with sanitized names)
      const sanitizedExecName = sanitizeExecutableName(execName);
      
      // Check if file exists (.sh or .bat) using sanitized name
      const shPath = path.join(gameContentDir, `${sanitizedExecName}.sh`);
      const batPath = path.join(gameContentDir, `${sanitizedExecName}.bat`);
      
      if (fs.existsSync(shPath) || fs.existsSync(batPath)) {
        // Return original name (from metadata) not sanitized name
        validExecutables.push(execName);
      }
    }
    
    // If we have valid executables, return them in the order from metadata
    if (validExecutables.length > 0) {
      return validExecutables;
    }
  }
  
  // Fallback: read from directory (for backward compatibility or if metadata is missing)
  return getExecutableNames(metadataPath, gameId);
}

// Helper function to delete a game
function deleteGame(metadataPath, gameId) {
  const gameDir = path.join(metadataPath, "content", "games", String(gameId));
  const metadataFile = getGameMetadataPath(metadataPath, gameId);
  
  // Delete only metadata.json
  if (fs.existsSync(metadataFile)) {
    try {
      fs.unlinkSync(metadataFile);
    } catch (err) {
      console.error(`Failed to delete metadata.json for game ${gameId}:`, err.message);
      throw err;
    }
  }
  
  // Remove directory only if it's empty after deleting metadata.json
  if (fs.existsSync(gameDir)) {
    removeDirectoryIfEmpty(gameDir);
  }
}

function loadLibraryGames(metadataPath, allGames) {
  const gamesDir = path.join(metadataPath, "content", "games");
  const games = [];

  if (!fs.existsSync(gamesDir)) {
    return games;
  }

  const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  gameFolders.forEach((gameId) => {
    const game = loadGame(metadataPath, gameId);
    if (game) {
      game.id = Number(gameId) || gameId;
      const executableNames = getExecutablesWithOrder(metadataPath, gameId, game);
      if (executableNames.length > 0) {
        game.executables = executableNames;
      } else {
        delete game.executables;
      }
      games.push(game);
      allGames[game.id] = game;
    }
  });

  applyTagReverseMapToGames(metadataPath, allGames);
  return games;
}


function registerLibraryRoutes(app, requireToken, metadataPath, allGames, updateCollectionsCache = null, updateRecommendedSections = null, getCollectionsCache = null, getDevelopersCache = null, getPublishersCache = null) {
  // Response cache for GET /libraries/library/games (keyed by sort); invalidated on any game add/update/delete
  let libraryGamesResponseCache = Object.create(null);
  function invalidateLibraryGamesResponseCache() {
    libraryGamesResponseCache = Object.create(null);
  }

  // Endpoint: get existing game IDs (lightweight, for importer to exclude from IGDB search)
  app.get("/games/ids", requireToken, (req, res) => {
    const gamesDir = path.join(metadataPath, "content", "games");
    const ids = [];
    if (fs.existsSync(gamesDir)) {
      const entries = fs.readdirSync(gamesDir, { withFileTypes: true });
      for (const dirent of entries) {
        if (dirent.isDirectory()) {
          const id = parseInt(dirent.name, 10);
          if (!Number.isNaN(id)) {
            ids.push(id);
          }
        }
      }
    }
    res.json({ ids });
  });

  // Endpoint: get unique keywords from all games (for tag suggestions)
  app.get("/keywords", requireToken, (req, res) => {
    const set = new Set();
    for (const game of Object.values(allGames)) {
      const kw = game.keywords;
      if (!kw || !Array.isArray(kw)) continue;
      for (const k of kw) {
        if (k != null && typeof k === "string" && k.trim()) set.add(k.trim());
      }
    }
    const keywords = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    res.json({ keywords });
  });

  // Endpoint: get library games (uses in-memory cache when populated; full response cached per sort for fast repeat requests)
  app.get("/libraries/library/games", requireToken, (req, res) => {
      const fromCache = Object.keys(allGames).length > 0;
      const libraryGames = fromCache
        ? Object.values(allGames)
        : loadLibraryGames(metadataPath, allGames);

      const sortBy = (req.query.sort && String(req.query.sort).toLowerCase()) || "title";
      const cacheKey = sortBy;

      if (fromCache && libraryGamesResponseCache[cacheKey]) {
        return res.json(libraryGamesResponseCache[cacheKey]);
      }

      const sorted = [...libraryGames].sort((a, b) => {
        switch (sortBy) {
          case "year": {
            const ya = a.year ?? 0;
            const yb = b.year ?? 0;
            return ya - yb;
          }
          case "releaseDate": {
            const da = a.year ?? 0;
            const db = b.year ?? 0;
            if (da !== db) return da - db;
            const ma = a.month ?? 0;
            const mb = b.month ?? 0;
            if (ma !== mb) return ma - mb;
            return (a.day ?? 0) - (b.day ?? 0);
          }
          case "stars":
            return (a.stars ?? 0) - (b.stars ?? 0);
          case "criticRating":
            return (a.criticratings ?? 0) - (b.criticratings ?? 0);
          case "userRating":
            return (a.userratings ?? 0) - (b.userratings ?? 0);
          case "title":
          default: {
            const ta = getTitleForSort(a.title);
            const tb = getTitleForSort(b.title);
            return ta.localeCompare(tb, undefined, { sensitivity: "base" });
          }
        }
      });

      const devs = getDevelopersCache ? getDevelopersCache() : null;
      const pubs = getPublishersCache ? getPublishersCache() : null;
      const responsePayload = {
        games: sorted.map((g) => buildGameResponse(metadataPath, g, devs, pubs, allGames)),
      };

      if (fromCache) {
        libraryGamesResponseCache[cacheKey] = responsePayload;
      }
      res.json(responsePayload);
  });

  // Serve game screenshot image (must be before GET /games/:gameId)
  app.get("/games/:gameId/screenshots/:filename", (req, res) => {
    const gameId = decodeURIComponent(req.params.gameId);
    const filename = decodeURIComponent(req.params.filename);
    if (!/^[a-zA-Z0-9_.-]+\.(webp|jpg|jpeg|png|gif)$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const screenshotPath = path.join(metadataPath, "content", "games", gameId, "screenshots", filename);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    if (!fs.existsSync(screenshotPath)) {
      res.setHeader("Content-Type", "image/webp");
      return res.status(404).end();
    }
    const ext = path.extname(filename).toLowerCase();
    const mime = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif" }[ext] || "image/webp";
    res.type(mime);
    res.sendFile(screenshotPath);
  });

  // Endpoint: get single game by ID
  app.get("/games/:gameId", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    const devs = getDevelopersCache ? getDevelopersCache() : null;
    const pubs = getPublishersCache ? getPublishersCache() : null;
    res.json(buildGameResponse(metadataPath, game, devs, pubs, allGames));
  });

  // Endpoint: update game fields
  app.put("/games/:gameId", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    const updates = req.body;
    
    // Validate game exists (check cache and file system)
    let game = allGames[gameId];
    if (!game) {
      // Try loading from file system
      const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
      if (!fs.existsSync(gameMetadataPath)) {
        return res.status(404).json({ error: "Game not found" });
      }
      game = loadGame(metadataPath, gameId);
      if (game) {
        game.id = gameId;
        Object.assign(game, getGameTagIdsFromBlocks(metadataPath, gameId));
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Define allowed fields that can be updated
    const allowedFields = [
      "title",
      "summary",
      "year",
      "month",
      "day",
      "stars",
      "criticRating",
      "userRating",
      "genre",
      "themes",
      "platforms",
      "gameEngines",
      "gameModes",
      "playerPerspectives",
      "ageRatings",
      "developers",
      "publishers",
      "franchise",
      "collection",
      "keywords",
      "executables",
      "showTitle",
      "screenshots",
      "videos",
      "alternativeNames",
      "websites",
      "similarGames",
    ];
    
    // Filter updates to only include allowed fields
    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {});

    // Screenshots and videos: must be null or array of non-empty strings (URLs)
    if ("screenshots" in filteredUpdates) {
      const v = filteredUpdates.screenshots;
      if (v == null) {
        filteredUpdates.screenshots = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "screenshots must be an array of URL strings or null" });
      } else {
        const arr = v.filter((s) => typeof s === "string" && s.trim());
        filteredUpdates.screenshots = arr.length > 0 ? arr : null;
      }
    }
    if ("videos" in filteredUpdates) {
      const v = filteredUpdates.videos;
      if (v == null) {
        filteredUpdates.videos = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "videos must be an array of URL strings or null" });
      } else {
        const arr = v.filter((s) => typeof s === "string" && s.trim());
        filteredUpdates.videos = arr.length > 0 ? arr : null;
      }
    }
    if ("alternativeNames" in filteredUpdates) {
      const v = filteredUpdates.alternativeNames;
      if (v == null) {
        filteredUpdates.alternativeNames = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "alternativeNames must be an array of strings or null" });
      } else {
        const arr = v.filter((s) => typeof s === "string" && s.trim());
        filteredUpdates.alternativeNames = arr.length > 0 ? arr : null;
      }
    }
    if ("websites" in filteredUpdates) {
      const v = filteredUpdates.websites;
      if (v == null) {
        filteredUpdates.websites = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "websites must be an array of objects or null" });
      } else {
        const arr = v
          .filter((item) => item && typeof item === "object" && typeof item.url === "string" && item.url.trim())
          .map((item) => String(item.url).trim())
          .filter((url) => url);
        const seen = new Set();
        const deduped = arr.filter((url) => {
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        });
        // Persist only URLs as string[] in metadata (category not stored)
        filteredUpdates.websites = deduped.length > 0 ? deduped : null;
      }
    }
    // Critic/user ratings: 0-100 from client, convert to 0-10 for storage
    if ("criticRating" in filteredUpdates) {
      const v = filteredUpdates.criticRating;
      if (v == null || v === "") {
        filteredUpdates.criticratings = null;
      } else {
        const num = Number(v);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ error: "criticRating must be a number between 0 and 100 or null" });
        }
        filteredUpdates.criticratings = num / 10;
      }
      delete filteredUpdates.criticRating;
    }
    if ("userRating" in filteredUpdates) {
      const v = filteredUpdates.userRating;
      if (v == null || v === "") {
        filteredUpdates.userratings = null;
      } else {
        const num = Number(v);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ error: "userRating must be a number between 0 and 100 or null" });
        }
        filteredUpdates.userratings = num / 10;
      }
      delete filteredUpdates.userRating;
    }

    // Age ratings: array of { category, rating } or null (category/rating can be number or string)
    if ("ageRatings" in filteredUpdates) {
      const v = filteredUpdates.ageRatings;
      if (v == null) {
        filteredUpdates.ageRatings = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "ageRatings must be an array of { category, rating } or null" });
      } else {
        const valid = v
          .filter((item) => item && typeof item === "object" && item.category != null && item.rating != null)
          .map((item) => ({
            category: Number(item.category),
            rating: Number(item.rating),
          }))
          .filter((item) => !Number.isNaN(item.category) && !Number.isNaN(item.rating));
        filteredUpdates.ageRatings = valid.length > 0 ? valid : null;
      }
    }

    if ("similarGames" in filteredUpdates) {
      const v = filteredUpdates.similarGames;
      if (v == null) {
        filteredUpdates.similarGames = null;
      } else if (!Array.isArray(v)) {
        return res.status(400).json({ error: "similarGames must be an array of objects or null" });
      } else {
        const arr = v
          .filter((item) => item && typeof item === "object" && item.id != null)
          .map((item) => ({
            id: Number(item.id),
            name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : String(item.id),
          }))
          .filter((o) => !Number.isNaN(o.id));
        const seen = new Set();
        const deduped = arr.filter((o) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        });
        // Persist only ids in metadata (names resolved at response time from allGames)
        filteredUpdates.similarGames = deduped.length > 0 ? deduped.map((o) => o.id) : null;
      }
    }
    
    // Normalize tag fields to ids (accept titles or ids from client; store ids)
    if ("genre" in filteredUpdates) {
      filteredUpdates.genre = normalizeCategoryFieldToIds(metadataPath, filteredUpdates.genre);
    }
    if ("themes" in filteredUpdates) {
      filteredUpdates.themes = normalizeThemeFieldToIds(metadataPath, filteredUpdates.themes);
    }
    if ("platforms" in filteredUpdates) {
      filteredUpdates.platforms = normalizePlatformFieldToIds(metadataPath, filteredUpdates.platforms);
    }
    if ("gameEngines" in filteredUpdates) {
      filteredUpdates.gameEngines = normalizeGameEngineFieldToIds(metadataPath, filteredUpdates.gameEngines);
    }
    if ("gameModes" in filteredUpdates) {
      filteredUpdates.gameModes = normalizeGameModeFieldToIds(metadataPath, filteredUpdates.gameModes);
    }
    if ("playerPerspectives" in filteredUpdates) {
      filteredUpdates.playerPerspectives = normalizePlayerPerspectiveFieldToIds(metadataPath, filteredUpdates.playerPerspectives);
    }
    // Developers and publishers: accept number[] or [{ id, name? }]; normalize to ids + items with names for blocks
    const normalizeDeveloperPublisher = (arr, getCache) => {
      if (!arr || !Array.isArray(arr) || arr.length === 0) return { ids: [], items: [] };
      const cache = getCache && typeof getCache === "function" ? getCache() : null;
      const list = Array.isArray(cache) ? cache : [];
      const byId = new Map(list.map((x) => [Number(x.id), x]));
      const seen = new Set();
      const ids = [];
      const items = [];
      for (const x of arr) {
        const id = x == null ? null : typeof x === "object" && x && x.id != null ? Number(x.id) : Number(x);
        if (id == null || Number.isNaN(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        const name =
          typeof x === "object" && x && (x.name != null || x.title != null)
            ? String(x.name ?? x.title).trim()
            : (byId.get(id) && (byId.get(id).title || byId.get(id).name)) || String(id);
        items.push({ id, name });
      }
      return { ids, items };
    };
    if ("developers" in filteredUpdates) {
      const { ids: newDevIds, items: newDevItems } = normalizeDeveloperPublisher(
        filteredUpdates.developers,
        () => (typeof getDevelopersCache === "function" ? getDevelopersCache() : null)
      );
      const oldDevs = Array.isArray(game.developers) ? game.developers : [];
      const oldIds = new Set(oldDevs.map((d) => Number(typeof d === "object" && d && d.id != null ? d.id : d)));
      const newIds = new Set(newDevIds);
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) removeGameFromDeveloper(metadataPath, oldId, gameId);
      }
      if (newDevItems.length > 0) ensureDevelopersExistBatch(metadataPath, newDevItems, gameId);
      filteredUpdates.developers = newDevIds.length > 0 ? newDevIds : null;
    }
    if ("publishers" in filteredUpdates) {
      const { ids: newPubIds, items: newPubItems } = normalizeDeveloperPublisher(
        filteredUpdates.publishers,
        () => (typeof getPublishersCache === "function" ? getPublishersCache() : null)
      );
      const oldPubs = Array.isArray(game.publishers) ? game.publishers : [];
      const oldIds = new Set(oldPubs.map((p) => Number(typeof p === "object" && p && p.id != null ? p.id : p)));
      const newIds = new Set(newPubIds);
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) removeGameFromPublisher(metadataPath, oldId, gameId);
      }
      if (newPubItems.length > 0) ensurePublishersExistBatch(metadataPath, newPubItems, gameId);
      filteredUpdates.publishers = newPubIds.length > 0 ? newPubIds : null;
    }
    // Franchise and collection (series): accept [{ id, name }] or number[]; ensure blocks exist and link game
    const normalizeFranchiseSeriesFromClient = (val) => {
      if (val == null) return { ids: [], items: [] };
      const arr = Array.isArray(val) ? val : [val];
      const seen = new Set();
      const ids = [];
      const items = [];
      for (const raw of arr) {
        if (raw == null) continue;
        let id = null;
        let name = null;
        if (typeof raw === "number" && !Number.isNaN(raw)) {
          id = raw;
          name = String(raw);
        } else if (typeof raw === "object" && raw && raw.id != null) {
          id = Number(raw.id);
          if (Number.isNaN(id)) continue;
          name = raw.name != null ? String(raw.name).trim() : (raw.title != null ? String(raw.title).trim() : String(id));
        }
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        items.push({ id, name: name || String(id) });
      }
      return { ids, items };
    };
    if ("franchise" in filteredUpdates) {
      const { ids, items } = normalizeFranchiseSeriesFromClient(filteredUpdates.franchise);
      filteredUpdates.franchise = ids.length > 0 ? ids : null;
      if (items.length > 0) {
        ensureFranchiseExistBatch(metadataPath, items, gameId);
      }
    }
    if ("collection" in filteredUpdates) {
      const { ids, items } = normalizeFranchiseSeriesFromClient(filteredUpdates.collection);
      filteredUpdates.collection = ids.length > 0 ? ids : null;
      if (items.length > 0) {
        ensureSeriesExistBatch(metadataPath, items, gameId);
      }
    }
    // Keywords: array of strings, stored in game metadata
    if ("keywords" in filteredUpdates) {
      const raw = filteredUpdates.keywords;
      if (!raw || !Array.isArray(raw)) {
        filteredUpdates.keywords = null;
      } else {
        const filtered = raw.filter((x) => typeof x === "string" && x.trim());
        filteredUpdates.keywords = filtered.length > 0 ? filtered : null;
      }
    }

    // Compute which tag ids were removed (for cleanup). Input: only number[].
    const toTagIdArray = (val) => {
      if (val == null) return [];
      const arr = Array.isArray(val) ? val : [val];
      return arr.filter((x) => typeof x === "number" && !Number.isNaN(x));
    };
    const tagCleanup = [];
    if ("genre" in filteredUpdates) {
      const oldIds = toTagIdArray(game.genre);
      const newIds = toTagIdArray(filteredUpdates.genre);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromCategory(metadataPath, id, gameId); tagCleanup.push({ type: "genre", id, deleteFn: deleteCategoryIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToCategory(metadataPath, id, gameId));
    }
    if ("themes" in filteredUpdates) {
      const oldIds = toTagIdArray(game.themes);
      const newIds = toTagIdArray(filteredUpdates.themes);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromTheme(metadataPath, id, gameId); tagCleanup.push({ type: "themes", id, deleteFn: deleteThemeIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToTheme(metadataPath, id, gameId));
    }
    if ("platforms" in filteredUpdates) {
      const oldIds = toTagIdArray(game.platforms);
      const newIds = toTagIdArray(filteredUpdates.platforms);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromPlatform(metadataPath, id, gameId); tagCleanup.push({ type: "platforms", id, deleteFn: deletePlatformIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToPlatform(metadataPath, id, gameId));
    }
    if ("gameEngines" in filteredUpdates) {
      const oldIds = toTagIdArray(game.gameEngines);
      const newIds = toTagIdArray(filteredUpdates.gameEngines);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromGameEngine(metadataPath, id, gameId); tagCleanup.push({ type: "gameEngines", id, deleteFn: deleteGameEngineIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToGameEngine(metadataPath, id, gameId));
    }
    if ("gameModes" in filteredUpdates) {
      const oldIds = toTagIdArray(game.gameModes);
      const newIds = toTagIdArray(filteredUpdates.gameModes);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromGameMode(metadataPath, id, gameId); tagCleanup.push({ type: "gameModes", id, deleteFn: deleteGameModeIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToGameMode(metadataPath, id, gameId));
    }
    if ("playerPerspectives" in filteredUpdates) {
      const oldIds = toTagIdArray(game.playerPerspectives);
      const newIds = toTagIdArray(filteredUpdates.playerPerspectives);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromPlayerPerspective(metadataPath, id, gameId); tagCleanup.push({ type: "playerPerspectives", id, deleteFn: deletePlayerPerspectiveIfUnused }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToPlayerPerspective(metadataPath, id, gameId));
    }
    const franchiseSeriesCleanup = [];
    if ("franchise" in filteredUpdates) {
      const oldIds = toTagIdArray(game.franchise);
      const newIds = toTagIdArray(filteredUpdates.franchise);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromFranchise(metadataPath, id, gameId); franchiseSeriesCleanup.push({ folder: "franchises", id }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToFranchise(metadataPath, id, gameId));
    }
    if ("collection" in filteredUpdates) {
      const oldIds = toTagIdArray(game.collection);
      const newIds = toTagIdArray(filteredUpdates.collection);
      oldIds.filter((id) => !newIds.includes(id)).forEach((id) => { removeGameFromSeries(metadataPath, id, gameId); franchiseSeriesCleanup.push({ folder: "series", id }); });
      newIds.filter((id) => !oldIds.includes(id)).forEach((id) => addGameToSeries(metadataPath, id, gameId));
    }

    // Track if we need to delete executables (when executables is null)
    let shouldDeleteExecutables = false;
    
    // Handle executables field: validate it's an array of strings
    if ('executables' in filteredUpdates) {
      if (filteredUpdates.executables === null || filteredUpdates.executables === undefined) {
        // If executables is null, we need to delete all executable files
        shouldDeleteExecutables = true;
        // Remove it from filteredUpdates but we'll handle deletion separately
        delete filteredUpdates.executables;
      } else if (!Array.isArray(filteredUpdates.executables)) {
        return res.status(400).json({ 
          error: "Executables must be an array of names (strings)" 
        });
      } else {
        // Validate all items are strings
        for (const exec of filteredUpdates.executables) {
          if (typeof exec !== 'string' || !exec.trim()) {
            return res.status(400).json({ 
              error: "All executables must be non-empty strings" 
            });
          }
        }
      }
    }
    
    // Check if there are any updates left (allow empty if we're deleting executables)
    if (Object.keys(filteredUpdates).length === 0 && !shouldDeleteExecutables) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    
    // Update game in memory
    if (Object.keys(filteredUpdates).length > 0) {
      Object.assign(game, filteredUpdates);
    }
    
    // Save to file - each game has its own folder
    try {
      const currentGame = loadGame(metadataPath, gameId);
      if (!currentGame) {
        return res.status(404).json({ error: "Game not found" });
      }
      currentGame.id = gameId;
      Object.assign(currentGame, getGameTagIdsFromBlocks(metadataPath, gameId));
      
      // Delete local screenshot files that were removed from the list
      if ("screenshots" in filteredUpdates) {
        const oldList = Array.isArray(currentGame.screenshots) ? currentGame.screenshots : [];
        const newList = Array.isArray(filteredUpdates.screenshots) ? filteredUpdates.screenshots : [];
        const newSet = new Set(newList);
        const localScreenshotRe = /^\/games\/(\d+)\/screenshots\/([a-zA-Z0-9_.-]+\.(webp|jpg|jpeg|png|gif))$/;
        const gameIdStr = String(gameId);
        for (const url of oldList) {
          if (typeof url !== "string" || newSet.has(url)) continue;
          const m = (url.trim()).match(localScreenshotRe);
          if (!m || m[1] !== gameIdStr) continue;
          const filename = m[2];
          const screenshotsDir = path.join(metadataPath, "content", "games", gameIdStr, "screenshots");
          const filePath = path.join(screenshotsDir, filename);
          try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              removeDirectoryIfEmpty(screenshotsDir);
            }
          } catch (err) {
            console.warn(`Failed to delete screenshot file ${filePath}:`, err.message);
          }
        }
      }
      
      // Update game with new values
      if (Object.keys(filteredUpdates).length > 0) {
        Object.assign(currentGame, filteredUpdates);
      }
      
      // If we need to delete executables (executables was set to null)
      if (shouldDeleteExecutables) {
        const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
        if (fs.existsSync(gameContentDir)) {
          try {
            const files = fs.readdirSync(gameContentDir);
            // Delete all .sh and .bat files
            for (const file of files) {
              const filePath = path.join(gameContentDir, file);
              const ext = path.extname(file).toLowerCase();
              if ((ext === '.sh' || ext === '.bat') && fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
              }
            }
          } catch (err) {
            console.error(`Failed to delete executables for game ${gameId}:`, err.message);
          }
        }
        // Remove executables field from metadata
        delete currentGame.executables;
      }
      
      // If executables was updated (but not deleted), sync files with the provided array
      if ('executables' in filteredUpdates && !shouldDeleteExecutables) {
        const requestedExecutables = filteredUpdates.executables;
        const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
        
        if (fs.existsSync(gameContentDir)) {
          try {
            // Get all existing executable files
            const files = fs.readdirSync(gameContentDir);
            const executableFiles = files.filter(file => {
              const filePath = path.join(gameContentDir, file);
              if (!fs.statSync(filePath).isFile()) return false;
              const ext = path.extname(file).toLowerCase();
              return ext === '.sh' || ext === '.bat';
            });
            
            // Delete files that are not in the requested executables array
            // Compare using sanitized names (files are saved with sanitized names)
            for (const file of executableFiles) {
              const fileNameWithoutExt = path.basename(file, path.extname(file));
              // Check if this file's sanitized name matches any requested executable's sanitized name
              const fileMatches = requestedExecutables.some(reqExec => {
                const sanitizedReqExec = sanitizeExecutableName(reqExec);
                return sanitizedReqExec === fileNameWithoutExt;
              });
              if (!fileMatches) {
                const filePath = path.join(gameContentDir, file);
                try {
                  fs.unlinkSync(filePath);
                } catch (err) {
                  console.warn(`Failed to delete executable file ${filePath}:`, err.message);
                }
              }
            }
          } catch (err) {
            console.error(`Failed to sync executables for game ${gameId}:`, err.message);
          }
        }
        
        // Update executables in metadata.json with the requested array
        // Verify which files actually exist and maintain the requested order
        const finalExecutables = [];
        
        // Keep executables in the requested order, but only if the file exists
        for (const execName of requestedExecutables) {
          if (typeof execName !== 'string' || !execName.trim()) continue;
          
          // Sanitize name for filesystem lookup (files are saved with sanitized names)
          const sanitizedExecName = sanitizeExecutableName(execName);
          
          // Check if file exists (.sh or .bat) using sanitized name
          const shPath = path.join(gameContentDir, `${sanitizedExecName}.sh`);
          const batPath = path.join(gameContentDir, `${sanitizedExecName}.bat`);
          
          if (fs.existsSync(shPath) || fs.existsSync(batPath)) {
            // Return original name (from metadata) not sanitized name
            finalExecutables.push(execName);
          }
        }
        
        if (finalExecutables.length > 0) {
          currentGame.executables = finalExecutables;
        } else {
          // If no files exist, remove executables field
          delete currentGame.executables;
        }
      }
      
      // Save updated game
      saveGame(metadataPath, currentGame);
      
      // Update allGames cache to ensure it's in sync
      if (Object.keys(filteredUpdates).length > 0) {
        Object.assign(allGames[gameId], filteredUpdates);
        invalidateLibraryGamesResponseCache();
      }
      // Remove tags that are no longer used by any game (and have no cover)
      for (const { id, deleteFn } of tagCleanup) {
        deleteFn(metadataPath, metadataPath, id, allGames);
      }
      for (const { folder, id } of franchiseSeriesCleanup) {
        if (folder === "franchises") {
          deleteFranchiseIfUnused(metadataPath, id, allGames);
        } else if (folder === "series") {
          deleteSeriesIfUnused(metadataPath, id, allGames);
        }
      }
      // Sync executables in cache with metadata (respecting order)
      if (shouldDeleteExecutables || 'executables' in filteredUpdates) {
        const orderedExecutables = getExecutablesWithOrder(metadataPath, gameId, currentGame);
        if (orderedExecutables.length > 0) {
          allGames[gameId].executables = orderedExecutables;
        } else {
          delete allGames[gameId].executables;
        }
      }
      invalidateLibraryGamesResponseCache();

      const updatedGame = currentGame;
      const devs = getDevelopersCache ? getDevelopersCache() : null;
      const pubs = getPublishersCache ? getPublishersCache() : null;
      res.json({ status: "success", game: buildGameResponse(metadataPath, updatedGame, devs, pubs, allGames) });
    } catch (e) {
      console.error(`Failed to save ${fileName}:`, e.message);
      res.status(500).json({ error: "Failed to save game updates" });
    }
  });

  // Endpoint: reload metadata for a single game
  app.post("/games/:gameId/reload", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    
    try {
      // Reload library games to refresh metadata
      loadLibraryGames(metadataPath, allGames);
      
      // Check if game exists after reload
      const game = allGames[gameId];
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      
      const devs = getDevelopersCache ? getDevelopersCache() : null;
      const pubs = getPublishersCache ? getPublishersCache() : null;
      res.json({ status: "reloaded", game: buildGameResponse(metadataPath, game, devs, pubs, allGames) });
    } catch (e) {
      console.error(`Failed to reload game ${gameId}:`, e.message);
      res.status(500).json({ error: "Failed to reload game metadata" });
    }
  });

  // Configure multer for file uploads (memory storage, we'll save manually)
  const upload = multer({ storage: multer.memoryStorage() });

  // Endpoint: upload cover image for a game
  app.post("/games/:gameId/upload-cover", requireToken, upload.single('file'), (req, res) => {
    const gameId = Number(req.params.gameId);
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }
    
    // Validate game exists
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Create game content directory if it doesn't exist
      const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
      // Ensure parent directories exist (important for macOS filesystem)
      ensureDirectoryExists(gameContentDir);
      
      // Save as cover.webp
      const coverPath = path.join(gameContentDir, "cover.webp");
      fs.writeFileSync(coverPath, file.buffer);
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game, null, null, allGames) });
    } catch (error) {
      console.error(`Failed to save cover for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to save cover image" });
    }
  });

  // Endpoint: upload background image for a game
  app.post("/games/:gameId/upload-background", requireToken, upload.single('file'), (req, res) => {
    const gameId = Number(req.params.gameId);
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }
    
    // Validate game exists
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Create game content directory if it doesn't exist
      const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
      // Ensure parent directories exist (important for macOS filesystem)
      ensureDirectoryExists(gameContentDir);
      
      // Save as background.webp
      const backgroundPath = path.join(gameContentDir, "background.webp");
      fs.writeFileSync(backgroundPath, file.buffer);
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game, null, null, allGames) });
    } catch (error) {
      console.error(`Failed to save background for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to save background image" });
    }
  });

  // Endpoint: upload screenshot image for a game
  app.post("/games/:gameId/upload-screenshot", requireToken, upload.single("file"), (req, res) => {
    const gameId = Number(req.params.gameId);
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "File must be an image" });
    }
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    try {
      const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
      ensureDirectoryExists(gameContentDir);
      const screenshotsDir = path.join(gameContentDir, "screenshots");
      ensureDirectoryExists(screenshotsDir);
      const ext = (file.mimetype === "image/webp" && "webp") || (file.mimetype === "image/png" && "png") || (file.mimetype === "image/gif" && "gif") || "jpg";
      const baseName = `screenshot-${Date.now()}.${ext}`;
      const screenshotPath = path.join(screenshotsDir, baseName);
      fs.writeFileSync(screenshotPath, file.buffer);
      const url = `/games/${gameId}/screenshots/${baseName}`;
      return res.json({ status: "success", url });
    } catch (error) {
      console.error(`Failed to save screenshot for game ${gameId}:`, error);
      return res.status(500).json({ error: "Failed to save screenshot" });
    }
  });

  // Endpoint: delete cover image for a game
  app.delete("/games/:gameId/delete-cover", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    
    // Validate gameId is a valid number
    if (isNaN(gameId)) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Validate game exists (check cache and file system)
    let game = allGames[gameId];
    if (!game) {
      // Try loading from file system
      const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
      if (!fs.existsSync(gameMetadataPath)) {
        return res.status(404).json({ error: "Game not found" });
      }
      game = loadGame(metadataPath, gameId);
      if (game) {
        game.id = gameId;
        Object.assign(game, getGameTagIdsFromBlocks(metadataPath, gameId));
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      deleteMediaFile({
        metadataPath,
        resourceId: gameId,
        resourceType: 'games',
        mediaType: 'cover'
      });
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game, null, null, allGames) });
    } catch (error) {
      console.error(`Failed to delete cover for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to delete cover image" });
    }
  });

  // Endpoint: delete background image for a game
  app.delete("/games/:gameId/delete-background", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    
    // Validate gameId is a valid number
    if (isNaN(gameId)) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Validate game exists (check cache and file system)
    let game = allGames[gameId];
    if (!game) {
      // Try loading from file system
      const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
      if (!fs.existsSync(gameMetadataPath)) {
        return res.status(404).json({ error: "Game not found" });
      }
      game = loadGame(metadataPath, gameId);
      if (game) {
        game.id = gameId;
        Object.assign(game, getGameTagIdsFromBlocks(metadataPath, gameId));
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      deleteMediaFile({
        metadataPath,
        resourceId: gameId,
        resourceType: 'games',
        mediaType: 'background'
      });
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game, null, null, allGames) });
    } catch (error) {
      console.error(`Failed to delete background for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to delete background image" });
    }
  });

  // Endpoint: upload executable file for a game
  app.post("/games/:gameId/upload-executable", requireToken, upload.single('file'), (req, res) => {
    const gameId = Number(req.params.gameId);
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file extension (only .sh or .bat allowed)
    const originalName = file.originalname || '';
    const fileExtension = path.extname(originalName).toLowerCase();
    
    if (fileExtension !== '.sh' && fileExtension !== '.bat') {
      return res.status(400).json({ error: "Only .sh and .bat files are allowed" });
    }
    
    // Get optional label from body (FormData field)
    const label = req.body.label ? req.body.label.trim() : null;
    
    // Validate game exists
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Create game content directory if it doesn't exist
      const gameContentDir = path.join(metadataPath, "content", "games", String(gameId));
      // Ensure parent directories exist (important for macOS filesystem)
      ensureDirectoryExists(gameContentDir);
      
      // Use label if provided, otherwise default to "script"
      let scriptName;
      if (label) {
        // Sanitize label (remove invalid characters for filename)
        const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
        scriptName = `${sanitizedLabel}${fileExtension}`;
      } else {
        // Default behavior: script.sh or script.bat
        scriptName = fileExtension === '.bat' ? 'script.bat' : 'script.sh';
      }
      const executablePath = path.join(gameContentDir, scriptName);
      
      // Write file to disk
      fs.writeFileSync(executablePath, file.buffer);
      
      // Make file executable (Unix-like systems, only for .sh files)
      if (fileExtension === '.sh') {
        try {
          fs.chmodSync(executablePath, 0o755);
        } catch (chmodError) {
          // Ignore chmod errors on Windows
          console.warn('Could not set executable permissions:', chmodError.message);
        }
      }
      
      // Update executables array: maintain existing order and add new one if not present
      // Save the original label (not sanitized) in metadata.json
      const currentGame = loadGame(metadataPath, gameId);
      let executableNames;
      
      // Use original label for metadata.json (not sanitized filename)
      const metadataExecutableName = label || 'script';
      
      if (currentGame && currentGame.executables && Array.isArray(currentGame.executables) && currentGame.executables.length > 0) {
        // Maintain existing order, add new executable if not already present
        executableNames = [...currentGame.executables];
        if (!executableNames.includes(metadataExecutableName)) {
          executableNames.push(metadataExecutableName);
        }
      } else {
        // No existing order, read from directory and merge with new one
        executableNames = getExecutableNames(metadataPath, gameId);
        // Remove the sanitized name if present and add the original label
        const sanitizedExecutableName = scriptName.replace(/\.(sh|bat)$/, '');
        executableNames = executableNames.filter(name => name !== sanitizedExecutableName);
        if (!executableNames.includes(metadataExecutableName)) {
          executableNames.push(metadataExecutableName);
        }
      }
      
      game.executables = executableNames;
      
      // Update the game in its own metadata.json file
      try {
        if (currentGame) {
          currentGame.id = gameId; // Set id before saving (id is not stored in metadata.json)
          currentGame.executables = executableNames;
          saveGame(metadataPath, currentGame);
        }
        // Update allGames cache
        allGames[gameId].executables = executableNames;
      } catch (saveError) {
        console.warn(`Failed to save executables field for game ${gameId}:`, saveError.message);
        // Continue anyway, the file was uploaded successfully
      }
      
      res.json({
        status: "success",
        game: buildGameResponse(metadataPath, game, null, null, allGames),
      });
    } catch (error) {
      console.error(`Failed to save executable for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to save executable file" });
    }
  });

  // Endpoint: add game from IGDB to library
  app.post("/games/add-from-igdb", requireToken, async (req, res) => {
    const { igdbId, name, summary, cover, background, releaseDate, genres, criticRating, userRating, stars, themes, platforms, gameModes, playerPerspectives, websites, ageRatings, developers, publishers, franchise, collection, series, screenshots, videos, gameEngines, keywords, alternativeNames, similarGames } = req.body;
    
    if (!igdbId || !name) {
      return res.status(400).json({ error: "Missing required fields: igdbId and name" });
    }

    try {
      // Use IGDB ID directly as game ID
      const gameId = Number(igdbId);
      
      // Check if game with this IGDB ID already exists (check both in-memory and file)
      // First check cache
      if (allGames[gameId]) {
        return res.status(409).json({ 
          error: "Game already exists", 
          gameId: gameId 
        });
      }
      
      // Also check if game folder exists (in case game is not in allGames cache)
      const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
      if (fs.existsSync(gameMetadataPath)) {
        const existingGame = loadGame(metadataPath, gameId);
        if (existingGame) {
          // Add to cache for future checks (use number as key for consistency)
          existingGame.id = gameId;
          allGames[gameId] = existingGame;
          invalidateLibraryGamesResponseCache();
          return res.status(409).json({ 
            error: "Game already exists", 
            gameId: gameId 
          });
        }
      }
      
      // Also check if game directory exists (even if metadata.json doesn't exist yet)
      const gameDir = path.join(metadataPath, "content", "games", String(gameId));
      if (fs.existsSync(gameDir)) {
        // Directory exists, check if metadata.json exists
        const existingGame = loadGame(metadataPath, gameId);
        if (existingGame) {
          // Game exists with valid metadata.json
          existingGame.id = gameId;
          allGames[gameId] = existingGame;
          invalidateLibraryGamesResponseCache();
          return res.status(409).json({ 
            error: "Game already exists", 
            gameId: gameId 
          });
        }
        // If directory exists but no metadata.json, allow the operation
        // The directory will be reused and metadata.json will be created
      }
      
      // Parse release date using utility function
      // Always extract day, month, and year from numeric date values when possible
      const { createReleaseDate } = require("../utils/dateUtils");
      const releaseDateObj = createReleaseDate(releaseDate);
      const year = releaseDateObj ? releaseDateObj.year : null;
      const month = releaseDateObj ? releaseDateObj.month : null;
      const day = releaseDateObj ? releaseDateObj.day : null;

      // Filter and validate genres
      let validGenres = null;
      if (genres && Array.isArray(genres) && genres.length > 0) {
        validGenres = genres.filter((g) => g && typeof g === "string" && g.trim());
        if (validGenres.length === 0) {
          validGenres = null;
        }
      }

      // Filter and validate all IGDB fields
      const validateStringArray = (arr) => {
        if (arr && Array.isArray(arr) && arr.length > 0) {
          const filtered = arr.filter((item) => item && typeof item === "string" && item.trim());
          return filtered.length > 0 ? filtered : null;
        }
        return null;
      };

      const validateObjectArray = (arr) => {
        if (arr && Array.isArray(arr) && arr.length > 0) {
          return arr.filter((item) => item && typeof item === "object");
        }
        return null;
      };

      let validScreenshots = validateStringArray(screenshots);
      let validThemes = validateStringArray(themes);
      let validPlatforms = validateStringArray(platforms);
      let validGameModes = validateStringArray(gameModes);
      let validPlayerPerspectives = validateStringArray(playerPerspectives);
      let validWebsites = validateObjectArray(websites);
      let validAgeRatings = validateObjectArray(ageRatings);
      // Developers and publishers: [{ id, name, logo?, description? }] from IGDB
      const validateDeveloperPublisherArray = (arr) => {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
        const filtered = arr.filter((item) => item && typeof item === "object" && item.id != null && item.name);
        return filtered.map((x) => ({ id: Number(x.id), name: String(x.name).trim(), logo: x.logo || null, description: x.description || "" })).filter((x) => !isNaN(x.id) && x.name);
      };
      const rawDevelopers = validateDeveloperPublisherArray(developers);
      const rawPublishers = validateDeveloperPublisherArray(publishers);
      let validVideos = validateStringArray(videos);
      let validGameEngines = validateStringArray(gameEngines);
      let validKeywords = validateStringArray(keywords);
      let validAlternativeNames = validateStringArray(alternativeNames);
      let validSimilarGames = validateObjectArray(similarGames);

      // Normalize franchise/collection from IGDB to [{ id, name }] for ensureFranchiseExistBatch/ensureSeriesExistBatch (names used only for initial metadata)
      const normalizeOne = (v) => {
        if (v == null) return null;
        if (typeof v === "object" && v !== null && typeof v.name === "string" && v.name.trim()) {
          const id = typeof v.id === "number" && !Number.isNaN(v.id) ? v.id : 0;
          return { id, name: v.name.trim() };
        }
        return null;
      };
      const normalizeFranchiseOrCollectionToArray = (v) => {
        if (v == null) return [];
        const arr = Array.isArray(v) ? v : [v];
        const out = arr.map(normalizeOne).filter(Boolean);
        return out.length > 0 ? out : null;
      };
      const franchiseForEnsure = normalizeFranchiseOrCollectionToArray(franchise);
      const collectionForEnsure = normalizeFranchiseOrCollectionToArray(collection ?? series);

      // Resolve tag titles to ids (creates missing tags)
      const genreIds = normalizeCategoryFieldToIds(metadataPath, validGenres);
      const themeIds = normalizeThemeFieldToIds(metadataPath, validThemes);
      const platformIds = normalizePlatformFieldToIds(metadataPath, validPlatforms);
      const gameEngineIds = normalizeGameEngineFieldToIds(metadataPath, validGameEngines);
      const gameModeIds = normalizeGameModeFieldToIds(metadataPath, validGameModes);
      const playerPerspectiveIds = normalizePlayerPerspectiveFieldToIds(metadataPath, validPlayerPerspectives);

      const newGame = {
        id: gameId,
        title: name,
        summary: summary || "",
        year: year,
        month: month || null,
        day: day || null,
        genre: genreIds,
        criticratings: criticRating !== undefined && criticRating !== null ? criticRating / 10 : null,
        userratings: userRating !== undefined && userRating !== null ? userRating / 10 : null,
        stars: stars !== undefined && stars !== null ? stars : null,
        themes: themeIds,
        platforms: platformIds,
        gameModes: gameModeIds,
        playerPerspectives: playerPerspectiveIds,
        websites: (validWebsites && validWebsites.length)
          ? validWebsites.map((w) => (w && typeof w.url === "string" && w.url.trim() ? w.url.trim() : null)).filter(Boolean)
          : null,
        ageRatings: validAgeRatings,
        developers: rawDevelopers ? rawDevelopers.map((d) => d.id) : null,
        publishers: rawPublishers ? rawPublishers.map((p) => p.id) : null,
        franchise: franchiseForEnsure ? franchiseForEnsure.map((x) => x.id) : null,
        collection: collectionForEnsure ? collectionForEnsure.map((x) => x.id) : null,
        screenshots: validScreenshots,
        videos: validVideos,
        gameEngines: gameEngineIds,
        keywords: validKeywords,
        alternativeNames: validAlternativeNames,
        similarGames: (validSimilarGames && validSimilarGames.length)
          ? [...new Set(validSimilarGames.map((s) => Number(s.id)).filter((id) => !Number.isNaN(id)))]
          : null,
        igdbCover: cover && typeof cover === "string" && cover.trim() ? cover.trim() : null,
        igdbBackground: background && typeof background === "string" && background.trim() ? background.trim() : null,
        showTitle: true,
      };

      if (rawDevelopers && rawDevelopers.length > 0) ensureDevelopersExistBatch(metadataPath, rawDevelopers, gameId);
      if (rawPublishers && rawPublishers.length > 0) ensurePublishersExistBatch(metadataPath, rawPublishers, gameId);
      if (franchiseForEnsure && franchiseForEnsure.length > 0) ensureFranchiseExistBatch(metadataPath, franchiseForEnsure, gameId);
      if (collectionForEnsure && collectionForEnsure.length > 0) ensureSeriesExistBatch(metadataPath, collectionForEnsure, gameId);

      // Sync tag ids to tag blocks (genre, themes, platforms, gameModes, playerPerspectives, gameEngines)
      if (genreIds && genreIds.length) genreIds.forEach((id) => addGameToCategory(metadataPath, id, gameId));
      if (themeIds && themeIds.length) themeIds.forEach((id) => addGameToTheme(metadataPath, id, gameId));
      if (platformIds && platformIds.length) platformIds.forEach((id) => addGameToPlatform(metadataPath, id, gameId));
      if (gameModeIds && gameModeIds.length) gameModeIds.forEach((id) => addGameToGameMode(metadataPath, id, gameId));
      if (playerPerspectiveIds && playerPerspectiveIds.length) playerPerspectiveIds.forEach((id) => addGameToPlayerPerspective(metadataPath, id, gameId));
      if (gameEngineIds && gameEngineIds.length) gameEngineIds.forEach((id) => addGameToGameEngine(metadataPath, id, gameId));

      // Save game to its own folder
      saveGame(metadataPath, newGame);

      // Add to allGames cache
      allGames[gameId] = newGame;
      invalidateLibraryGamesResponseCache();

      // Update recommended sections using in-memory allGames (no disk read of library)
      if (updateRecommendedSections && typeof updateRecommendedSections === 'function') {
        updateRecommendedSections(metadataPath, allGames);
      }

      const devs = getDevelopersCache ? getDevelopersCache() : null;
      const pubs = getPublishersCache ? getPublishersCache() : null;
      res.json({ status: "success", game: buildGameResponse(metadataPath, newGame, devs, pubs, allGames), gameId: newGame.id });
    } catch (error) {
      console.error(`Failed to add game from IGDB:`, error);
      res.status(500).json({ error: "Failed to add game to library", detail: error.message });
    }
  });

  // Endpoint: create a new game from scratch (no IGDB). ID = creation timestamp.
  app.post("/games/create", requireToken, async (req, res) => {
    const { title } = req.body;
    const name = typeof title === "string" ? title.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Missing required field: title" });
    }

    try {
      let gameId = Date.now();
      const gameDirBase = path.join(metadataPath, "content", "games");
      while (allGames[gameId] || fs.existsSync(path.join(gameDirBase, String(gameId)))) {
        gameId += 1;
      }

      const newGame = {
        id: gameId,
        title: name,
        summary: "",
        year: null,
        month: null,
        day: null,
        genre: null,
        criticratings: null,
        userratings: null,
        stars: null,
        themes: null,
        platforms: null,
        gameModes: null,
        playerPerspectives: null,
        websites: null,
        ageRatings: null,
        developers: null,
        publishers: null,
        franchise: null,
        collection: null,
        screenshots: null,
        videos: null,
        gameEngines: null,
        keywords: null,
        alternativeNames: null,
        similarGames: null,
        igdbCover: null,
        igdbBackground: null,
        showTitle: true,
      };

      saveGame(metadataPath, newGame);
      allGames[gameId] = newGame;
      invalidateLibraryGamesResponseCache();

      if (updateRecommendedSections && typeof updateRecommendedSections === "function") {
        updateRecommendedSections(metadataPath, allGames);
      }

      const devs = getDevelopersCache ? getDevelopersCache() : null;
      const pubs = getPublishersCache ? getPublishersCache() : null;
      res.json({ status: "success", game: buildGameResponse(metadataPath, newGame, devs, pubs, allGames), gameId: newGame.id });
    } catch (error) {
      console.error("Failed to create game:", error);
      res.status(500).json({ error: "Failed to create game", detail: error.message });
    }
  });

  // Endpoint: delete game
  app.delete("/games/:gameId", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    
    // Validate game exists
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Get game tags before deletion (to check for orphaned entries)
      const gameGenres = game.genre ? (Array.isArray(game.genre) ? game.genre : [game.genre]) : [];
      const gameThemes = game.themes ? (Array.isArray(game.themes) ? game.themes : [game.themes]) : [];
      const gamePlatforms = game.platforms ? (Array.isArray(game.platforms) ? game.platforms : [game.platforms]) : [];
      const gameEngines = game.gameEngines ? (Array.isArray(game.gameEngines) ? game.gameEngines : [game.gameEngines]) : [];
      const gameModes = game.gameModes ? (Array.isArray(game.gameModes) ? game.gameModes : [game.gameModes]) : [];
      const gamePerspectives = game.playerPerspectives
        ? (Array.isArray(game.playerPerspectives) ? game.playerPerspectives : [game.playerPerspectives])
        : [];
      const gameFranchiseIds = Array.isArray(game.franchise) ? game.franchise : game.franchise != null ? [game.franchise] : [];
      const gameCollectionIds = Array.isArray(game.collection) ? game.collection : game.collection != null ? [game.collection] : [];
      const gameDeveloperIds = (game.developers && Array.isArray(game.developers)
        ? game.developers
        : game.developers != null ? [game.developers] : []
      ).map((x) => (typeof x === "object" && x != null && x.id != null ? x.id : x));
      const gamePublisherIds = (game.publishers && Array.isArray(game.publishers)
        ? game.publishers
        : game.publishers != null ? [game.publishers] : []
      ).map((x) => (typeof x === "object" && x != null && x.id != null ? x.id : x));

      // Remove game from all tag blocks (genre, themes, platforms, etc.) and franchise/series blocks before deleting
      removeGameFromAllTagBlocks(metadataPath, gameId);
      // Remove game from all franchises
      for (const [franchiseId, gameIds] of getFranchiseToGameIdsMap(metadataPath)) {
        if (gameIds.includes(gameId)) removeGameFromFranchise(metadataPath, franchiseId, gameId);
      }
      // Remove game from all series
      for (const [seriesId, gameIds] of getSeriesToGameIdsMap(metadataPath)) {
        if (gameIds.includes(gameId)) removeGameFromSeries(metadataPath, seriesId, gameId);
      }

      // Delete game folder and its metadata.json
      deleteGame(metadataPath, gameId);
      
      // Remove game from recommended/metadata.json
      removeGameFromRecommended(metadataPath, gameId);
      
      // Remove game from all collections (use in-memory cache when available)
      const collectionsCache = getCollectionsCache && typeof getCollectionsCache === "function" ? getCollectionsCache() : null;
      const collectionToGames = getCollectionToGameIdsMap(metadataPath);
      const collectionIdsContainingGame = [];
      for (const [collectionId, gameIds] of collectionToGames) {
        if (gameIds.some((g) => Number(g) === Number(gameId))) collectionIdsContainingGame.push(collectionId);
      }
      removeGameFromAllCollections(metadataPath, gameId, updateCollectionsCache, collectionsCache);
      for (const id of collectionIdsContainingGame) {
        if (id != null) deleteCollectionIfUnused(metadataPath, id);
      }
      // Remove game from all developers and publishers (pass null cache to load fresh from disk,
      // so we include developers/publishers created when the game was added)
      removeGameFromAllDevelopers(metadataPath, gameId, null, null);
      removeGameFromAllPublishers(metadataPath, gameId, null, null);

      for (const id of gameDeveloperIds) {
        if (id != null) deleteDeveloperIfUnused(metadataPath, id);
      }
      for (const id of gamePublisherIds) {
        if (id != null) deletePublisherIfUnused(metadataPath, id);
      }

      // Remove from in-memory cache
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      
      // Note: Game content directory (cover, background, etc.) is also deleted with the folder
      
      const tagSetsToClean = [
        { values: gameGenres, deleteFn: deleteCategoryIfUnused },
        { values: gameThemes, deleteFn: deleteThemeIfUnused },
        { values: gamePlatforms, deleteFn: deletePlatformIfUnused },
        { values: gameEngines, deleteFn: deleteGameEngineIfUnused },
        { values: gameModes, deleteFn: deleteGameModeIfUnused },
        { values: gamePerspectives, deleteFn: deletePlayerPerspectiveIfUnused },
      ];

      const remainingGamesMap = { ...allGames };

      if (tagSetsToClean.some((set) => set.values.length > 0)) {
        for (const { values, deleteFn } of tagSetsToClean) {
          for (const value of values) {
            if (value === null || value === undefined) continue;
            deleteFn(metadataPath, metadataPath, value, remainingGamesMap);
          }
        }
      }

      for (const id of gameFranchiseIds) {
        deleteFranchiseIfUnused(metadataPath, id, remainingGamesMap);
      }
      for (const id of gameCollectionIds) {
        deleteSeriesIfUnused(metadataPath, id, remainingGamesMap);
      }
      
      res.json({ status: "success" });
    } catch (error) {
      console.error(`Failed to delete game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to delete game" });
    }
  });
}

module.exports = {
  loadLibraryGames,
  registerLibraryRoutes,
};



