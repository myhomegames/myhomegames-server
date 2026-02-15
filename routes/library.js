const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  ensureCategoriesExistBatch,
  deleteCategoryIfUnused,
  resolveCategoryIdsToObjects,
  normalizeCategoryFieldToIds,
} = require("./categories");
const {
  ensureThemesExistBatch,
  deleteThemeIfUnused,
  resolveThemeIdsToObjects,
  normalizeThemeFieldToIds,
} = require("./themes");
const {
  ensurePlatformsExistBatch,
  deletePlatformIfUnused,
  resolvePlatformIdsToObjects,
  normalizePlatformFieldToIds,
} = require("./platforms");
const {
  ensureGameEnginesExistBatch,
  deleteGameEngineIfUnused,
  resolveGameEngineIdsToObjects,
  normalizeGameEngineFieldToIds,
} = require("./gameengines");
const {
  ensureGameModesExistBatch,
  deleteGameModeIfUnused,
  resolveGameModeIdsToObjects,
  normalizeGameModeFieldToIds,
} = require("./gamemodes");
const {
  ensurePlayerPerspectivesExistBatch,
  deletePlayerPerspectiveIfUnused,
  resolvePlayerPerspectiveIdsToObjects,
  normalizePlayerPerspectiveFieldToIds,
} = require("./playerperspectives");
const { removeGameFromRecommended } = require("./recommended");
const { removeGameFromAllCollections } = require("./collections");
const { ensureDevelopersExistBatch, removeGameFromAllDevelopers, removeGameFromDeveloper } = require("./developers");
const { ensurePublishersExistBatch, removeGameFromAllPublishers, removeGameFromPublisher } = require("./publishers");
const { getCoverUrl, getBackgroundUrl, deleteMediaFile } = require("../utils/gameMediaUtils");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");


/**
 * Library routes module
 * Handles the main library games endpoint
 */

// Helper function to get game metadata file path
function getGameMetadataPath(metadataPath, gameId) {
  return path.join(metadataPath, "content", "games", String(gameId), "metadata.json");
}

// Helper function to save a single game
function saveGame(metadataPath, game) {
  const gameId = game.id;
  const gameDir = path.join(metadataPath, "content", "games", String(gameId));
  ensureDirectoryExists(gameDir);
  const filePath = getGameMetadataPath(metadataPath, gameId);
  // Remove id from saved data (it's in the folder name)
  const gameToSave = { ...game };
  delete gameToSave.id;
  writeJsonFile(filePath, gameToSave);
}

// Helper function to load a single game
function loadGame(metadataPath, gameId) {
  const filePath = getGameMetadataPath(metadataPath, gameId);
  return readJsonFile(filePath, null);
}

// Normalize franchise/collection/series to array for API responses (supports legacy single value)
function toFranchiseSeriesArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/** Resolve tag fields (ids or legacy titles) to [{ id, title }, ...] for API response. */
function enrichGameTagFields(metadataPath, game) {
  const out = { ...game };
  if (game.themes != null && (Array.isArray(game.themes) ? game.themes.length : 1)) {
    out.themes = resolveThemeIdsToObjects(metadataPath, game.themes);
  }
  if (game.platforms != null && (Array.isArray(game.platforms) ? game.platforms.length : 1)) {
    out.platforms = resolvePlatformIdsToObjects(metadataPath, game.platforms);
  }
  if (game.gameModes != null && (Array.isArray(game.gameModes) ? game.gameModes.length : 1)) {
    out.gameModes = resolveGameModeIdsToObjects(metadataPath, game.gameModes);
  }
  if (game.playerPerspectives != null && (Array.isArray(game.playerPerspectives) ? game.playerPerspectives.length : 1)) {
    out.playerPerspectives = resolvePlayerPerspectiveIdsToObjects(metadataPath, game.playerPerspectives);
  }
  if (game.gameEngines != null && (Array.isArray(game.gameEngines) ? game.gameEngines.length : 1)) {
    out.gameEngines = resolveGameEngineIdsToObjects(metadataPath, game.gameEngines);
  }
  if (game.genre != null && (Array.isArray(game.genre) ? game.genre.length : 1)) {
    out.genre = resolveCategoryIdsToObjects(metadataPath, game.genre);
  }
  return out;
}

/** Build full game response object with enriched tag fields and cover/background URLs. */
function buildGameResponse(metadataPath, game) {
  const enriched = enrichGameTagFields(metadataPath, game);
  const executables = getExecutablesWithOrder(metadataPath, game.id, game);
  const gameData = {
    id: enriched.id,
    title: enriched.title,
    summary: enriched.summary || "",
    cover: getCoverUrl(game, metadataPath),
    day: enriched.day || null,
    month: enriched.month || null,
    year: enriched.year || null,
    stars: enriched.stars || null,
    genre: enriched.genre && enriched.genre.length ? enriched.genre : null,
    criticratings: enriched.criticratings || null,
    userratings: enriched.userratings || null,
    executables: executables.length > 0 ? executables : null,
    themes: enriched.themes && enriched.themes.length ? enriched.themes : null,
    platforms: enriched.platforms && enriched.platforms.length ? enriched.platforms : null,
    gameModes: enriched.gameModes && enriched.gameModes.length ? enriched.gameModes : null,
    playerPerspectives: enriched.playerPerspectives && enriched.playerPerspectives.length ? enriched.playerPerspectives : null,
    websites: enriched.websites || null,
    ageRatings: enriched.ageRatings || null,
    developers: enriched.developers || null,
    publishers: enriched.publishers || null,
    franchise: toFranchiseSeriesArray(enriched.franchise),
    collection: toFranchiseSeriesArray(enriched.collection),
    series: toFranchiseSeriesArray(enriched.collection),
    screenshots: enriched.screenshots || null,
    videos: enriched.videos || null,
    gameEngines: enriched.gameEngines && enriched.gameEngines.length ? enriched.gameEngines : null,
    keywords: enriched.keywords || null,
    alternativeNames: enriched.alternativeNames || null,
    similarGames: enriched.similarGames || null,
    showTitle: enriched.showTitle,
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
  
  // Read all subdirectories (each game has its own folder)
  const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  // Load each game's metadata.json
  gameFolders.forEach((gameId) => {
    const game = loadGame(metadataPath, gameId);
    if (game) {
      game.id = Number(gameId) || gameId;
      // Migrate tag fields from titles (string[]) to ids (number[]) if needed
      let migrated = false;
      const normalizeIfStrings = (arr) => Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string";
      if (normalizeIfStrings(game.themes)) {
        game.themes = normalizeThemeFieldToIds(metadataPath, game.themes);
        migrated = true;
      }
      if (normalizeIfStrings(game.platforms)) {
        game.platforms = normalizePlatformFieldToIds(metadataPath, game.platforms);
        migrated = true;
      }
      if (normalizeIfStrings(game.gameModes)) {
        game.gameModes = normalizeGameModeFieldToIds(metadataPath, game.gameModes);
        migrated = true;
      }
      if (normalizeIfStrings(game.playerPerspectives)) {
        game.playerPerspectives = normalizePlayerPerspectiveFieldToIds(metadataPath, game.playerPerspectives);
        migrated = true;
      }
      if (normalizeIfStrings(game.gameEngines)) {
        game.gameEngines = normalizeGameEngineFieldToIds(metadataPath, game.gameEngines);
        migrated = true;
      }
      if (normalizeIfStrings(game.genre)) {
        game.genre = normalizeCategoryFieldToIds(metadataPath, game.genre);
        migrated = true;
      }
      if (migrated) saveGame(metadataPath, game);
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
            const ta = (a.title || "").trim();
            const tb = (b.title || "").trim();
            return ta.localeCompare(tb, undefined, { sensitivity: "base" });
          }
        }
      });

      const responsePayload = {
        games: sorted.map((g) => {
          const enriched = enrichGameTagFields(metadataPath, g);
          const executableNames = getExecutablesWithOrder(metadataPath, g.id, g);
          const executables = executableNames.length > 0 ? executableNames : null;
          const gameData = {
            id: enriched.id,
            title: enriched.title,
            summary: enriched.summary || "",
            cover: getCoverUrl(g, metadataPath),
            day: enriched.day || null,
            month: enriched.month || null,
            year: enriched.year || null,
            stars: enriched.stars || null,
            genre: enriched.genre && enriched.genre.length ? enriched.genre : null,
            criticratings: enriched.criticratings || null,
            userratings: enriched.userratings || null,
            executables,
            themes: enriched.themes && enriched.themes.length ? enriched.themes : null,
            platforms: enriched.platforms && enriched.platforms.length ? enriched.platforms : null,
            gameModes: enriched.gameModes && enriched.gameModes.length ? enriched.gameModes : null,
            playerPerspectives: enriched.playerPerspectives && enriched.playerPerspectives.length ? enriched.playerPerspectives : null,
            websites: enriched.websites || null,
            ageRatings: enriched.ageRatings || null,
            developers: enriched.developers || null,
            publishers: enriched.publishers || null,
            franchise: toFranchiseSeriesArray(enriched.franchise),
            collection: toFranchiseSeriesArray(enriched.collection),
            series: toFranchiseSeriesArray(enriched.collection),
            screenshots: enriched.screenshots || null,
            videos: enriched.videos || null,
            gameEngines: enriched.gameEngines && enriched.gameEngines.length ? enriched.gameEngines : null,
            keywords: enriched.keywords || null,
            alternativeNames: enriched.alternativeNames || null,
            similarGames: enriched.similarGames || null,
            showTitle: enriched.showTitle,
          };
          const backgroundUrl = getBackgroundUrl(g, metadataPath);
          if (backgroundUrl) gameData.background = backgroundUrl;
          return gameData;
        }),
      };

      if (fromCache) {
        libraryGamesResponseCache[cacheKey] = responsePayload;
      }
      res.json(responsePayload);
  });

  // Endpoint: get single game by ID
  app.get("/games/:gameId", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = allGames[gameId];
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    const enriched = enrichGameTagFields(metadataPath, game);
    const executableNames = getExecutablesWithOrder(metadataPath, gameId, game);
    const executables = executableNames.length > 0 ? executableNames : null;
    const gameData = {
      id: enriched.id,
      title: enriched.title,
      summary: enriched.summary || "",
      cover: getCoverUrl(game, metadataPath),
      day: enriched.day || null,
      month: enriched.month || null,
      year: enriched.year || null,
      stars: enriched.stars || null,
      genre: enriched.genre && enriched.genre.length ? enriched.genre : null,
      criticratings: enriched.criticratings || null,
      userratings: enriched.userratings || null,
      executables,
      themes: enriched.themes && enriched.themes.length ? enriched.themes : null,
      platforms: enriched.platforms && enriched.platforms.length ? enriched.platforms : null,
      gameModes: enriched.gameModes && enriched.gameModes.length ? enriched.gameModes : null,
      playerPerspectives: enriched.playerPerspectives && enriched.playerPerspectives.length ? enriched.playerPerspectives : null,
      websites: enriched.websites || null,
      ageRatings: enriched.ageRatings || null,
      developers: enriched.developers || null,
      publishers: enriched.publishers || null,
      franchise: toFranchiseSeriesArray(enriched.franchise),
      collection: toFranchiseSeriesArray(enriched.collection),
      series: toFranchiseSeriesArray(enriched.collection),
      screenshots: enriched.screenshots || null,
      videos: enriched.videos || null,
      gameEngines: enriched.gameEngines && enriched.gameEngines.length ? enriched.gameEngines : null,
      keywords: enriched.keywords || null,
      alternativeNames: enriched.alternativeNames || null,
      similarGames: enriched.similarGames || null,
      showTitle: enriched.showTitle,
    };
    const backgroundUrl = getBackgroundUrl(game, metadataPath);
    if (backgroundUrl) gameData.background = backgroundUrl;
    res.json(gameData);
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
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        // If metadata.json exists but can't be loaded, it might be corrupted
        // Still return 404 to be safe
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    // Double-check: ensure game still exists in file system
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      // Game was deleted between cache check and now
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
      "genre",
      "themes",
      "platforms",
      "gameEngines",
      "gameModes",
      "playerPerspectives",
      "developers",
      "publishers",
      "franchise",
      "collection",
      "executables",
      "showTitle",
    ];
    
    // Filter updates to only include allowed fields
    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {});
    
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
    // Developers and publishers: [{ id, name }] – remove from old, add to new
    const validateDevPubArray = (arr) => {
      if (!arr || !Array.isArray(arr)) return null;
      const filtered = arr.filter((item) => item && typeof item === "object" && item.id != null && item.name);
      return filtered.map((x) => ({ id: Number(x.id), name: String(x.name).trim() })).filter((x) => !isNaN(x.id) && x.name);
    };
    if ("developers" in filteredUpdates) {
      const newDevs = validateDevPubArray(filteredUpdates.developers) || [];
      const oldDevs = game.developers || [];
      const oldIds = new Set(oldDevs.map((d) => Number(typeof d === "object" ? d.id : d)));
      const newIds = new Set(newDevs.map((d) => d.id));
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) removeGameFromDeveloper(metadataPath, oldId, gameId);
      }
      if (newDevs.length > 0) ensureDevelopersExistBatch(metadataPath, newDevs, gameId);
    }
    if ("publishers" in filteredUpdates) {
      const newPubs = validateDevPubArray(filteredUpdates.publishers) || [];
      const oldPubs = game.publishers || [];
      const oldIds = new Set(oldPubs.map((p) => Number(typeof p === "object" ? p.id : p)));
      const newIds = new Set(newPubs.map((p) => p.id));
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) removeGameFromPublisher(metadataPath, oldId, gameId);
      }
      if (newPubs.length > 0) ensurePublishersExistBatch(metadataPath, newPubs, gameId);
    }
    // Franchise and collection (series): normalize to array of { id, name }
    if ("franchise" in filteredUpdates) {
      filteredUpdates.franchise = validateDevPubArray(filteredUpdates.franchise) || null;
    }
    if ("collection" in filteredUpdates) {
      filteredUpdates.collection = validateDevPubArray(filteredUpdates.collection) || null;
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
      // Load current game
      const currentGame = loadGame(metadataPath, gameId);
      if (!currentGame) {
        return res.status(404).json({ error: "Game not found" });
      }
      
      // Add id field (it's derived from folder name, not stored in metadata.json)
      currentGame.id = gameId;
      
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
      const enriched = enrichGameTagFields(metadataPath, updatedGame);
      const gameData = {
        id: enriched.id,
        title: enriched.title,
        summary: enriched.summary || "",
        cover: getCoverUrl(updatedGame, metadataPath),
        day: enriched.day || null,
        month: enriched.month || null,
        year: enriched.year || null,
        stars: enriched.stars || null,
        genre: enriched.genre && enriched.genre.length ? enriched.genre : null,
        criticratings: enriched.criticratings || null,
        userratings: enriched.userratings || null,
        executables: updatedGame.executables || null,
        themes: enriched.themes && enriched.themes.length ? enriched.themes : null,
        platforms: enriched.platforms && enriched.platforms.length ? enriched.platforms : null,
        gameModes: enriched.gameModes && enriched.gameModes.length ? enriched.gameModes : null,
        playerPerspectives: enriched.playerPerspectives && enriched.playerPerspectives.length ? enriched.playerPerspectives : null,
        websites: enriched.websites || null,
        ageRatings: enriched.ageRatings || null,
        developers: enriched.developers || null,
        publishers: enriched.publishers || null,
        franchise: toFranchiseSeriesArray(enriched.franchise),
        collection: toFranchiseSeriesArray(enriched.collection),
        series: toFranchiseSeriesArray(enriched.collection),
        screenshots: enriched.screenshots || null,
        videos: enriched.videos || null,
        gameEngines: enriched.gameEngines && enriched.gameEngines.length ? enriched.gameEngines : null,
        keywords: enriched.keywords || null,
        alternativeNames: enriched.alternativeNames || null,
        similarGames: enriched.similarGames || null,
        showTitle: enriched.showTitle,
      };
      const backgroundUrl = getBackgroundUrl(updatedGame, metadataPath);
      if (backgroundUrl) gameData.background = backgroundUrl;
      res.json({ status: "success", game: gameData });
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
      
      res.json({ status: "reloaded", game: buildGameResponse(metadataPath, game) });
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
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game) });
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
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game) });
    } catch (error) {
      console.error(`Failed to save background for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to save background image" });
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
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        // If metadata.json exists but can't be loaded, it might be corrupted
        // Still return 404 to be safe
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    // Double-check: ensure game still exists in file system
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      // Game was deleted between cache check and now
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Delete the cover file
      deleteMediaFile({
        metadataPath,
        resourceId: gameId,
        resourceType: 'games',
        mediaType: 'cover'
      });
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game) });
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
        allGames[gameId] = game;
        invalidateLibraryGamesResponseCache();
      } else {
        // If metadata.json exists but can't be loaded, it might be corrupted
        // Still return 404 to be safe
        return res.status(404).json({ error: "Game not found" });
      }
    }
    
    // Double-check: ensure game still exists in file system
    const gameMetadataPath = getGameMetadataPath(metadataPath, gameId);
    if (!fs.existsSync(gameMetadataPath)) {
      // Game was deleted between cache check and now
      delete allGames[gameId];
      invalidateLibraryGamesResponseCache();
      return res.status(404).json({ error: "Game not found" });
    }
    
    try {
      // Delete the background file
      deleteMediaFile({
        metadataPath,
        resourceId: gameId,
        resourceType: 'games',
        mediaType: 'background'
      });
      
      res.json({ status: "success", game: buildGameResponse(metadataPath, game) });
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
        game: buildGameResponse(metadataPath, game),
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
      let validDevelopers = rawDevelopers ? rawDevelopers.map((d) => ({ id: d.id, name: d.name })) : null;
      let validPublishers = rawPublishers ? rawPublishers.map((p) => ({ id: p.id, name: p.name })) : null;
      let validVideos = validateStringArray(videos);
      let validGameEngines = validateStringArray(gameEngines);
      let validKeywords = validateStringArray(keywords);
      let validAlternativeNames = validateStringArray(alternativeNames);
      let validSimilarGames = validateObjectArray(similarGames);

      // Normalize one franchise/collection item to { id, name } or string
      const normalizeOne = (v) => {
        if (v == null) return null;
        if (typeof v === "string" && v.trim()) return v.trim();
        if (typeof v === "object" && v !== null && typeof v.name === "string" && v.name.trim()) {
          const id = typeof v.id === "number" && !Number.isNaN(v.id) ? v.id : 0;
          return { id, name: v.name.trim() };
        }
        return null;
      };
      // Normalize franchise/collection to array (accept single value or array from IGDB)
      const normalizeFranchiseOrCollectionToArray = (v) => {
        if (v == null) return [];
        const arr = Array.isArray(v) ? v : [v];
        const out = arr.map(normalizeOne).filter(Boolean);
        return out.length > 0 ? out : null;
      };

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
        websites: validWebsites,
        ageRatings: validAgeRatings,
        developers: validDevelopers,
        publishers: validPublishers,
        franchise: normalizeFranchiseOrCollectionToArray(franchise),
        collection: normalizeFranchiseOrCollectionToArray(collection ?? series),
        screenshots: validScreenshots,
        videos: validVideos,
        gameEngines: gameEngineIds,
        keywords: validKeywords,
        alternativeNames: validAlternativeNames,
        similarGames: validSimilarGames,
        igdbCover: cover && typeof cover === "string" && cover.trim() ? cover.trim() : null,
        igdbBackground: background && typeof background === "string" && background.trim() ? background.trim() : null,
        showTitle: true,
      };

      if (rawDevelopers && rawDevelopers.length > 0) ensureDevelopersExistBatch(metadataPath, rawDevelopers, gameId);
      if (rawPublishers && rawPublishers.length > 0) ensurePublishersExistBatch(metadataPath, rawPublishers, gameId);

      // Save game to its own folder
      saveGame(metadataPath, newGame);

      // Add to allGames cache
      allGames[gameId] = newGame;
      invalidateLibraryGamesResponseCache();

      // Update recommended sections using in-memory allGames (no disk read of library)
      if (updateRecommendedSections && typeof updateRecommendedSections === 'function') {
        updateRecommendedSections(metadataPath, allGames);
      }

      const enrichedNew = enrichGameTagFields(metadataPath, newGame);
      const gameData = {
        id: enrichedNew.id,
        title: enrichedNew.title,
        summary: enrichedNew.summary || "",
        cover: getCoverUrl(newGame, metadataPath),
        day: enrichedNew.day || null,
        month: enrichedNew.month || null,
        year: enrichedNew.year || null,
        stars: enrichedNew.stars || null,
        genre: enrichedNew.genre && enrichedNew.genre.length ? enrichedNew.genre : null,
        criticratings: enrichedNew.criticratings || null,
        userratings: enrichedNew.userratings || null,
        executables: newGame.executables || null,
        themes: enrichedNew.themes && enrichedNew.themes.length ? enrichedNew.themes : null,
        platforms: enrichedNew.platforms && enrichedNew.platforms.length ? enrichedNew.platforms : null,
        gameModes: enrichedNew.gameModes && enrichedNew.gameModes.length ? enrichedNew.gameModes : null,
        playerPerspectives: enrichedNew.playerPerspectives && enrichedNew.playerPerspectives.length ? enrichedNew.playerPerspectives : null,
        websites: enrichedNew.websites || null,
        ageRatings: enrichedNew.ageRatings || null,
        developers: enrichedNew.developers || null,
        publishers: enrichedNew.publishers || null,
        franchise: toFranchiseSeriesArray(enrichedNew.franchise),
        collection: toFranchiseSeriesArray(enrichedNew.collection),
        series: toFranchiseSeriesArray(enrichedNew.collection),
        screenshots: enrichedNew.screenshots || null,
        videos: enrichedNew.videos || null,
        gameEngines: enrichedNew.gameEngines && enrichedNew.gameEngines.length ? enrichedNew.gameEngines : null,
        keywords: enrichedNew.keywords || null,
        alternativeNames: enrichedNew.alternativeNames || null,
        similarGames: enrichedNew.similarGames || null,
        showTitle: enrichedNew.showTitle,
      };
      const backgroundUrl = getBackgroundUrl(newGame, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }

      res.json({ status: "success", game: gameData, gameId: newGame.id });
    } catch (error) {
      console.error(`Failed to add game from IGDB:`, error);
      res.status(500).json({ error: "Failed to add game to library", detail: error.message });
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
      
      // Delete game folder and its metadata.json
      deleteGame(metadataPath, gameId);
      
      // Remove game from recommended/metadata.json
      removeGameFromRecommended(metadataPath, gameId);
      
      // Remove game from all collections (use in-memory cache when available)
      const collectionsCache = getCollectionsCache && typeof getCollectionsCache === "function" ? getCollectionsCache() : null;
      removeGameFromAllCollections(metadataPath, gameId, updateCollectionsCache, collectionsCache);
      // Remove game from all developers and publishers
      const developersCache = getDevelopersCache && typeof getDevelopersCache === "function" ? getDevelopersCache() : null;
      const publishersCache = getPublishersCache && typeof getPublishersCache === "function" ? getPublishersCache() : null;
      removeGameFromAllDevelopers(metadataPath, gameId, null, developersCache);
      removeGameFromAllPublishers(metadataPath, gameId, null, publishersCache);
      
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

      if (tagSetsToClean.some((set) => set.values.length > 0)) {
        // Use in-memory allGames (already without deleted game) instead of loading from disk
        const remainingGamesMap = { ...allGames };

        for (const { values, deleteFn } of tagSetsToClean) {
          for (const value of values) {
            if (value === null || value === undefined) continue;
            deleteFn(metadataPath, metadataPath, value, remainingGamesMap);
          }
        }
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



