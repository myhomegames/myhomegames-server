const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { ensureCategoryExists, loadCategories, deleteCategoryIfUnused } = require("./categories");
const { removeGameFromRecommended } = require("./recommended");
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

// Helper function to delete a game
function deleteGame(metadataPath, gameId) {
  const gameDir = path.join(metadataPath, "content", "games", String(gameId));
  if (fs.existsSync(gameDir)) {
    // Delete all files in the directory first
    try {
      const files = fs.readdirSync(gameDir);
      files.forEach((file) => {
        const filePath = path.join(gameDir, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          } else if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          }
        } catch (e) {
          // Ignore errors deleting individual files
        }
      });
    } catch (e) {
      // If we can't read the directory, try to remove it anyway
    }
    // Remove directory only if it's empty
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
      // Use folder name as ID
      game.id = Number(gameId) || gameId;
      // Always populate executables from directory files (in case metadata.json is out of sync)
      const executableNames = getExecutableNames(metadataPath, gameId);
      if (executableNames.length > 0) {
        game.executables = executableNames;
      } else {
        // If no executables found, remove the field
        delete game.executables;
      }
      games.push(game);
      allGames[game.id] = game;
    }
  });
  
  return games;
}


function registerLibraryRoutes(app, requireToken, metadataPath, allGames) {
  
  // Endpoint: get library games
  app.get("/libraries/library/games", requireToken, (req, res) => {
    const libraryGames = loadLibraryGames(metadataPath, allGames);
    res.json({
      games: libraryGames.map((g) => {
        // Always populate executables from directory files (in case metadata.json is out of sync)
        const executableNames = getExecutableNames(metadataPath, g.id);
        const executables = executableNames.length > 0 ? executableNames : null;
        
        const gameData = {
          id: g.id,
          title: g.title,
          summary: g.summary || "",
          cover: getCoverUrl(g, metadataPath),
          day: g.day || null,
          month: g.month || null,
          year: g.year || null,
          stars: g.stars || null,
          genre: g.genre || null,
          criticratings: g.criticratings || null,
          userratings: g.userratings || null,
          executables: executables,
          themes: g.themes || null,
          platforms: g.platforms || null,
          gameModes: g.gameModes || null,
          playerPerspectives: g.playerPerspectives || null,
          websites: g.websites || null,
          ageRatings: g.ageRatings || null,
          developers: g.developers || null,
          publishers: g.publishers || null,
          franchise: g.franchise || null,
          collection: g.collection || null,
          screenshots: g.screenshots || null,
          videos: g.videos || null,
          gameEngines: g.gameEngines || null,
          keywords: g.keywords || null,
          alternativeNames: g.alternativeNames || null,
          similarGames: g.similarGames || null,
        };
        const backgroundUrl = getBackgroundUrl(g, metadataPath);
        if (backgroundUrl) {
          gameData.background = backgroundUrl;
        }
        return gameData;
      }),
    });
  });

  // Endpoint: get single game by ID
  app.get("/games/:gameId", requireToken, (req, res) => {
    const gameId = Number(req.params.gameId);
    const game = allGames[gameId];
    
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Always populate executables from directory files (in case metadata.json is out of sync)
    const executableNames = getExecutableNames(metadataPath, gameId);
    const executables = executableNames.length > 0 ? executableNames : null;
    
    const gameData = {
      id: game.id,
      title: game.title,
      summary: game.summary || "",
      cover: getCoverUrl(game, metadataPath),
      day: game.day || null,
      month: game.month || null,
      year: game.year || null,
      stars: game.stars || null,
      genre: game.genre || null,
      criticratings: game.criticratings || null,
      userratings: game.userratings || null,
      executables: executables,
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
    };
    const backgroundUrl = getBackgroundUrl(game, metadataPath);
    if (backgroundUrl) {
      gameData.background = backgroundUrl;
    }
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
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Define allowed fields that can be updated
    const allowedFields = ['title', 'summary', 'year', 'month', 'day', 'stars', 'genre', 'executables'];
    
    // Filter updates to only include allowed fields
    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {});
    
    // Handle genre updates: create categories if they don't exist
    if ('genre' in filteredUpdates && filteredUpdates.genre) {
      const genres = Array.isArray(filteredUpdates.genre) 
        ? filteredUpdates.genre 
        : [filteredUpdates.genre];
      
      // Ensure all genres exist as categories
      const validGenres = genres.filter((g) => g && typeof g === "string" && g.trim());
      for (const genre of validGenres) {
        if (genre && typeof genre === "string") {
          ensureCategoryExists(metadataPath, genre);
        }
      }
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
            for (const file of executableFiles) {
              const fileNameWithoutExt = path.basename(file, path.extname(file));
              if (!requestedExecutables.includes(fileNameWithoutExt)) {
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
        // But also verify which files actually exist
        const actualExecutables = getExecutableNames(metadataPath, gameId);
        // Use intersection: only keep executables that both exist as files and are in the requested array
        const finalExecutables = requestedExecutables.filter(name => actualExecutables.includes(name));
        
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
      }
      // Sync executables in cache with actual files
      if (shouldDeleteExecutables || 'executables' in filteredUpdates) {
        const actualExecutables = getExecutableNames(metadataPath, gameId);
        if (actualExecutables.length > 0) {
          allGames[gameId].executables = actualExecutables;
        } else {
          delete allGames[gameId].executables;
        }
      }
      
      // Return updated game data with all fields
      const updatedGame = currentGame;
      const gameData = {
        id: updatedGame.id,
        title: updatedGame.title,
        summary: updatedGame.summary || "",
        cover: getCoverUrl(updatedGame, metadataPath),
        day: updatedGame.day || null,
        month: updatedGame.month || null,
        year: updatedGame.year || null,
        stars: updatedGame.stars || null,
        genre: updatedGame.genre || null,
        criticratings: updatedGame.criticratings || null,
        userratings: updatedGame.userratings || null,
        executables: updatedGame.executables || null,
        themes: updatedGame.themes || null,
        platforms: updatedGame.platforms || null,
        gameModes: updatedGame.gameModes || null,
        playerPerspectives: updatedGame.playerPerspectives || null,
        websites: updatedGame.websites || null,
        ageRatings: updatedGame.ageRatings || null,
        developers: updatedGame.developers || null,
        publishers: updatedGame.publishers || null,
        franchise: updatedGame.franchise || null,
        collection: updatedGame.collection || null,
        screenshots: updatedGame.screenshots || null,
        videos: updatedGame.videos || null,
        gameEngines: updatedGame.gameEngines || null,
        keywords: updatedGame.keywords || null,
        alternativeNames: updatedGame.alternativeNames || null,
        similarGames: updatedGame.similarGames || null,
      };
      const backgroundUrl = getBackgroundUrl(updatedGame, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
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
      
      // Return updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ status: "reloaded", game: gameData });
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
      
      // Return updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ 
        status: "success",
        game: gameData,
      });
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
      
      // Return updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ 
        status: "success",
        game: gameData,
      });
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
      
      // Return updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ 
        status: "success",
        game: gameData,
      });
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
      
      // Return updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ 
        status: "success",
        game: gameData,
      });
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
      
      // Update executables array with names from directory
      const executableNames = getExecutableNames(metadataPath, gameId);
      game.executables = executableNames;
      
      // Update the game in its own metadata.json file
      try {
        const currentGame = loadGame(metadataPath, gameId);
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
      
      // Return executables array and updated game data
      const gameData = {
        id: game.id,
        title: game.title,
        summary: game.summary || "",
        cover: getCoverUrl(game, metadataPath),
        day: game.day || null,
        month: game.month || null,
        year: game.year || null,
        stars: game.stars || null,
        genre: game.genre || null,
        criticratings: game.criticratings || null,
        userratings: game.userratings || null,
        executables: executableNames.length > 0 ? executableNames : null,
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
      };
      const backgroundUrl = getBackgroundUrl(game, metadataPath);
      if (backgroundUrl) {
        gameData.background = backgroundUrl;
      }
      
      res.json({ 
        status: "success",
        game: gameData,
      });
    } catch (error) {
      console.error(`Failed to save executable for game ${gameId}:`, error);
      res.status(500).json({ error: "Failed to save executable file" });
    }
  });

  // Endpoint: add game from IGDB to library
  app.post("/games/add-from-igdb", requireToken, async (req, res) => {
    const { igdbId, name, summary, cover, background, releaseDate, genres, criticRating, userRating, themes, platforms, gameModes, playerPerspectives, websites, ageRatings, developers, publishers, franchise, collection, screenshots, videos, gameEngines, keywords, alternativeNames, similarGames } = req.body;
    
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
      let validDevelopers = validateStringArray(developers);
      let validPublishers = validateStringArray(publishers);
      let validVideos = validateStringArray(videos);
      let validGameEngines = validateStringArray(gameEngines);
      let validKeywords = validateStringArray(keywords);
      let validAlternativeNames = validateStringArray(alternativeNames);
      let validSimilarGames = validateObjectArray(similarGames);

      // Create game object
      const newGame = {
        id: gameId,
        title: name,
        summary: summary || "",
        year: year,
        month: month || null,
        day: day || null,
        genre: validGenres && validGenres.length > 0 ? validGenres : null,
        criticratings: criticRating !== undefined && criticRating !== null ? criticRating / 10 : null, // Convert from 0-100 to 0-10
        userratings: userRating !== undefined && userRating !== null ? userRating / 10 : null, // Convert from 0-100 to 0-10
        themes: validThemes,
        platforms: validPlatforms,
        gameModes: validGameModes,
        playerPerspectives: validPlayerPerspectives,
        websites: validWebsites,
        ageRatings: validAgeRatings,
        developers: validDevelopers,
        publishers: validPublishers,
        franchise: franchise && typeof franchise === "string" && franchise.trim() ? franchise.trim() : null,
        collection: collection && typeof collection === "string" && collection.trim() ? collection.trim() : null,
        screenshots: validScreenshots,
        videos: validVideos,
        gameEngines: validGameEngines,
        keywords: validKeywords,
        alternativeNames: validAlternativeNames,
        similarGames: validSimilarGames,
        igdbCover: cover && typeof cover === "string" && cover.trim() ? cover.trim() : null,
        igdbBackground: background && typeof background === "string" && background.trim() ? background.trim() : null,
      };

      // Note: Game content directory is not created during game creation.
      // It will be created only when uploading cover/background via edit endpoints.
      // Cover and background images will be displayed from IGDB URLs if local files don't exist.

      // Create missing categories from genres
      if (validGenres && validGenres.length > 0) {
        for (const genre of validGenres) {
          if (genre && typeof genre === "string") {
            ensureCategoryExists(metadataPath, genre);
          }
        }
      }

      // Save game to its own folder
      saveGame(metadataPath, newGame);

      // Add to allGames cache
      allGames[gameId] = newGame;

      // Return the new game data
      const gameData = {
        id: newGame.id,
        title: newGame.title,
        summary: newGame.summary || "",
        cover: getCoverUrl(newGame, metadataPath),
        day: newGame.day || null,
        month: newGame.month || null,
        year: newGame.year || null,
        stars: newGame.stars || null,
        genre: newGame.genre || null,
        criticratings: newGame.criticratings || null,
        userratings: newGame.userratings || null,
        executables: newGame.executables || null,
        themes: newGame.themes || null,
        platforms: newGame.platforms || null,
        gameModes: newGame.gameModes || null,
        playerPerspectives: newGame.playerPerspectives || null,
        websites: newGame.websites || null,
        ageRatings: newGame.ageRatings || null,
        developers: newGame.developers || null,
        publishers: newGame.publishers || null,
        franchise: newGame.franchise || null,
        collection: newGame.collection || null,
        screenshots: newGame.screenshots || null,
        videos: newGame.videos || null,
        gameEngines: newGame.gameEngines || null,
        keywords: newGame.keywords || null,
        alternativeNames: newGame.alternativeNames || null,
        similarGames: newGame.similarGames || null,
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
      // Get game genres before deletion (to check for orphaned categories)
      const gameGenres = game.genre ? (Array.isArray(game.genre) ? game.genre : [game.genre]) : [];
      
      // Delete game folder and its metadata.json
      deleteGame(metadataPath, gameId);
      
      // Remove game from recommended/metadata.json
      removeGameFromRecommended(metadataPath, gameId);
      
      // Remove from in-memory cache
      delete allGames[gameId];
      
      // Note: Game content directory (cover, background, etc.) is also deleted with the folder
      
      // Check for orphaned categories and delete them
      if (gameGenres.length > 0) {
        // Load all remaining games for checking category usage
        const remainingGames = loadLibraryGames(metadataPath, {});
        const remainingGamesMap = {};
        remainingGames.forEach((g) => {
          remainingGamesMap[g.id] = g;
        });
        
        // Get all categories (array of {id, title} objects)
        const allCategories = loadCategories(metadataPath);
        
        // For each genre of the deleted game, check if the corresponding category is orphaned
        for (const genre of gameGenres) {
          if (!genre || typeof genre !== "string") continue;
          
          // Check if category exists (case-insensitive match)
          const categoryExists = allCategories.some(cat => cat.title.toLowerCase() === genre.toLowerCase());
          if (categoryExists) {
            // Check if category is still used by any remaining game (case-insensitive match)
            const genreLower = genre.toLowerCase();
            const isStillUsed = Object.values(remainingGamesMap).some((remainingGame) => {
              if (!remainingGame.genre) return false;
              if (Array.isArray(remainingGame.genre)) {
                return remainingGame.genre.some(g => String(g).toLowerCase() === genreLower);
              }
              return String(remainingGame.genre).toLowerCase() === genreLower;
            });
            
            // If category is not used by any remaining game, delete it
            if (!isStillUsed) {
              deleteCategoryIfUnused(metadataPath, metadataPath, genre, remainingGamesMap);
            }
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



