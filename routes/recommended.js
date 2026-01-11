const fs = require("fs");
const path = require("path");
const { getCoverUrl, getBackgroundUrl } = require("../utils/gameMediaUtils");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("@mycms/utils");

/**
 * Recommended routes module
 * Handles the recommended games endpoint
 */

// Helper function to generate a numeric ID from section title
function getRecommendedSectionId(sectionTitle) {
  // Generate a numeric hash from the title
  // This ensures the same title always gets the same ID
  let hash = 0;
  const str = String(sectionTitle).toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Return positive number
  return Math.abs(hash);
}


// Get all recommended sections from filesystem (like categories)
// Titles are read from metadata.json files in each section folder
function getAllRecommendedSections(metadataPath) {
  return loadRecommendedSections(metadataPath);
}

// Load games from library to populate recommended sections
function loadLibraryGamesForRecommended(metadataPath) {
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
    const gameMetadataPath = path.join(gamesDir, gameId, "metadata.json");
    if (fs.existsSync(gameMetadataPath)) {
      const game = readJsonFile(gameMetadataPath, null);
      if (game) {
        // Use folder name as ID
        game.id = Number(gameId) || gameId;
        games.push(game);
      }
    }
  });
  
  return games;
}

// Populate recommended sections with games from library
function populateRecommendedSections(sections, games) {
  if (!Array.isArray(games) || games.length === 0) {
    return sections; // Return sections as-is if no games available
  }

  const gameIds = games.map(g => g.id).filter(id => id != null);
  if (gameIds.length === 0) {
    return sections;
  }

  // Helper to get games by genre, sorted by criticratings (descending)
  const getGamesByGenre = (genre) => {
    return games.filter(g => {
      if (!g.genre) return false;
      const genres = Array.isArray(g.genre) ? g.genre : [g.genre];
      return genres.some(g => String(g).toLowerCase().includes(String(genre).toLowerCase()));
    })
    .sort((a, b) => {
      // Sort by criticratings descending (higher ratings first)
      // Games without criticratings go to the end
      const aRating = a.criticratings ?? -1;
      const bRating = b.criticratings ?? -1;
      return bRating - aRating;
    })
    .map(g => g.id);
  };

  // Helper to get games by year range
  const getGamesByYearRange = (minYear, maxYear) => {
    return games.filter(g => g.year && g.year >= minYear && g.year <= maxYear).map(g => g.id);
  };

  // Helper to get games by stars
  const getGamesByStars = (minStars) => {
    return games.filter(g => g.stars && g.stars >= minStars).map(g => g.id);
  };

  // Helper to get games with low user ratings (underrated)
  const getGamesByLowUserRatings = (maxRating) => {
    return games.filter(g => g.userratings && g.userratings <= maxRating).map(g => g.id);
  };

  // Helper to get random games
  const getRandomGames = (count) => {
    const shuffled = [...gameIds].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  };

  // Populate sections based on their title (formatted title like categories)
  return sections.map(section => {
    let sectionGames = [];
    
    // Use formatted title directly for switch
    const sectionTitle = section.title || section.id;
    
    switch (sectionTitle) {
      case "Oldest":
        sectionGames = games.sort((a, b) => (a.year || 9999) - (b.year || 9999)).slice(0, 10).map(g => g.id);
        break;
      case "Classics":
        sectionGames = getGamesByYearRange(1980, 2000).slice(0, 10);
        break;
      case "Most Played":
        sectionGames = getRandomGames(10);
        break;
      case "Recently Installed":
        sectionGames = getRandomGames(10);
        break;
      case "Best Western":
        sectionGames = getGamesByGenre("western").slice(0, 10);
        break;
      case "Indie Gems":
        sectionGames = getGamesByGenre("indie").slice(0, 10);
        break;
      case "Action Games":
        sectionGames = getGamesByGenre("action").slice(0, 10);
        break;
      case "RPG Games":
        sectionGames = getGamesByGenre("rpg").slice(0, 10);
        break;
      case "Strategy Games":
        sectionGames = getGamesByGenre("strategy").slice(0, 10);
        break;
      case "Puzzle Games":
        sectionGames = getGamesByGenre("puzzle").slice(0, 10);
        break;
      case "Sports Games":
        sectionGames = getGamesByGenre("sport").slice(0, 10);
        break;
      case "Racing Games":
        sectionGames = getGamesByGenre("racing").slice(0, 10);
        break;
      case "Horror Games":
        sectionGames = getGamesByGenre("horror").slice(0, 10);
        break;
      case "Fantasy Games":
        sectionGames = getGamesByGenre("fantasy").slice(0, 10);
        break;
      case "Sci-Fi Games":
        sectionGames = getGamesByGenre("sci-fi").slice(0, 10);
        break;
      case "Historical Games":
        sectionGames = getGamesByGenre("historical").slice(0, 10);
        break;
      case "Multiplayer Games":
        sectionGames = getGamesByGenre("multiplayer").slice(0, 10);
        break;
      case "Single Player Games":
        sectionGames = getRandomGames(10);
        break;
      case "Top Rated":
        sectionGames = getGamesByStars(8).slice(0, 10);
        break;
      case "New Releases":
        const currentYear = new Date().getFullYear();
        sectionGames = getGamesByYearRange(currentYear - 2, currentYear).slice(0, 10);
        break;
      case "Modern Games":
        sectionGames = getGamesByYearRange(2010, new Date().getFullYear()).slice(0, 10);
        break;
      case "Retro Games":
        sectionGames = getGamesByYearRange(1980, 1999).slice(0, 10);
        break;
      case "Underrated Games":
        // Get games with low user ratings (underrated) - userratings <= 5
        sectionGames = getGamesByLowUserRatings(5).slice(0, 10);
        break;
      default:
        // For other categories, use random games
        sectionGames = getRandomGames(5);
        break;
    }

    // If no games found for this category, use random games
    if (sectionGames.length === 0) {
      sectionGames = getRandomGames(5);
    }

    return {
      ...section,
      games: sectionGames
    };
  });
}

// Ensure recommended sections are complete (populate games for existing sections)
function ensureRecommendedSectionsComplete(metadataPath) {
  // Load games from library
  const games = loadLibraryGamesForRecommended(metadataPath);
  
  // Load existing sections from filesystem
  const existingSections = loadRecommendedSections(metadataPath);
  
  // Populate games for each existing section
  const populatedSections = populateRecommendedSections(existingSections, games);
  
  // Save/update each section with populated games
  populatedSections.forEach((section) => {
    saveSection(metadataPath, section);
  });
  
  console.log(`Ensured ${populatedSections.length} recommended sections are complete`);
}

// Helper function to get section directory path using numeric ID
function getRecommendedSectionDir(metadataPath, sectionId) {
  return path.join(metadataPath, "content", "recommended", String(sectionId));
}

// Helper function to get section metadata file path
function getSectionMetadataPath(metadataPath, sectionId) {
  const sectionDir = getRecommendedSectionDir(metadataPath, sectionId);
  return path.join(sectionDir, "metadata.json");
}

// Helper function to find section ID by title
function findRecommendedSectionIdByTitle(metadataPath, sectionTitle) {
  const sections = loadRecommendedSections(metadataPath);
  const trimmedTitle = sectionTitle.trim();
  // Check if section exists (case-insensitive match)
  const existingSection = sections.find(sec => sec.title && sec.title.toLowerCase() === trimmedTitle.toLowerCase());
  if (existingSection) {
    // Return the existing section ID
    return existingSection.id;
  }
  return null;
}

// Helper function to save a single section
function saveSection(metadataPath, section) {
  // Use numeric ID from title if not already numeric
  let sectionId;
  if (section.title) {
    sectionId = getRecommendedSectionId(section.title);
  } else if (typeof section.id === 'string' && /^\d+$/.test(section.id)) {
    // Already numeric
    sectionId = section.id;
  } else if (typeof section.id === 'number') {
    sectionId = section.id;
  } else {
    // Fallback: use the id as-is (for backward compatibility)
    sectionId = section.id;
  }
  
  const sectionDir = getRecommendedSectionDir(metadataPath, sectionId);
  ensureDirectoryExists(sectionDir);
  const filePath = getSectionMetadataPath(metadataPath, sectionId);
  
  // Determine title (must be present)
  const sectionTitle = section.title;
  if (!sectionTitle) {
    console.warn(`Warning: Section missing title, skipping save for section ID: ${sectionId}`);
    return;
  }
  
  // Create section object with title first, then games, then other properties
  // This ensures title appears before games in the JSON file
  const sectionToSave = {
    title: sectionTitle,
    games: section.games || []
  };
  
  // Add other properties (excluding id)
  Object.keys(section).forEach(key => {
    if (key !== 'id' && key !== 'title' && key !== 'games') {
      sectionToSave[key] = section[key];
    }
  });
  
  // Remove old string id if present
  if (sectionToSave.id && typeof sectionToSave.id === 'string' && !/^\d+$/.test(sectionToSave.id)) {
    delete sectionToSave.id;
  }
  
  writeJsonFile(filePath, sectionToSave);
}

// Helper function to load a single section
function loadSection(metadataPath, sectionId) {
  const filePath = getSectionMetadataPath(metadataPath, sectionId);
  return readJsonFile(filePath, null);
}

// Helper function to delete a section
function deleteSection(metadataPath, sectionId) {
  const sectionDir = path.join(metadataPath, "content", "recommended", sectionId);
  if (fs.existsSync(sectionDir)) {
    // Delete all files in the directory first
    try {
      const files = fs.readdirSync(sectionDir);
      files.forEach((file) => {
        const filePath = path.join(sectionDir, file);
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
    removeDirectoryIfEmpty(sectionDir);
  }
}

function loadRecommendedSections(metadataPath) {
  const recommendedDir = path.join(metadataPath, "content", "recommended");
  const sections = [];
  
  if (!fs.existsSync(recommendedDir)) {
    return sections;
  }
  
  // Read all subdirectories (each section has its own folder)
  // Filter to only numeric folder names (new format)
  const sectionFolders = fs.readdirSync(recommendedDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(folderName => /^\d+$/.test(folderName)); // Only numeric folders
  
  // Load each section's metadata.json
  sectionFolders.forEach((sectionId) => {
    const section = loadSection(metadataPath, sectionId);
    if (section) {
      // Use folder name (numeric ID) as ID
      section.id = sectionId;
      // Ensure title exists (for backward compatibility)
      if (!section.title) {
        // Try to infer from old id if present, or use a default
        section.title = section.title || "Untitled Section";
      }
      sections.push(section);
    }
  });
  
  return sections;
}

/**
 * Remove a game from recommended/metadata.json
 * Supports both old format (single metadata.json file) and new format (directory-per-section)
 * @param {string} metadataPath - Path to metadata directory
 * @param {number} gameId - ID of the game to remove
 * @returns {boolean} - True if the game was removed, false otherwise
 */
function removeGameFromRecommended(metadataPath, gameId) {
  try {
    // First, try new format (directory-per-section)
    const sections = loadRecommendedSections(metadataPath);
    if (sections.length > 0) {
      let hasChanges = false;
      
      // Remove gameId from each section's games array
      sections.forEach((section) => {
        if (Array.isArray(section.games)) {
          const gameIndex = section.games.findIndex((id) => String(id) === String(gameId));
          if (gameIndex !== -1) {
            section.games.splice(gameIndex, 1);
            hasChanges = true;
            // Save updated section
            saveSection(metadataPath, section);
          }
        }
      });
      
      if (hasChanges) {
        return true;
      }
    }
    
    // Fallback to old format (single metadata.json file) for backward compatibility
    const oldRecommendedFile = path.join(metadataPath, "content", "recommended", "metadata.json");
    if (fs.existsSync(oldRecommendedFile)) {
      try {
        const recommendedData = readJsonFile(oldRecommendedFile, null);
        if (recommendedData) {
          let hasChanges = false;
          
          // Handle old format: array of IDs (simple array of numbers)
          if (Array.isArray(recommendedData) && (recommendedData.length === 0 || typeof recommendedData[0] !== 'object' || !recommendedData[0].hasOwnProperty('id'))) {
            const gameIndex = recommendedData.findIndex((id) => String(id) === String(gameId));
            if (gameIndex !== -1) {
              recommendedData.splice(gameIndex, 1);
              hasChanges = true;
              writeJsonFile(oldRecommendedFile, recommendedData);
            }
          } else if (Array.isArray(recommendedData)) {
            // Handle new format in old file location: array of section objects
            recommendedData.forEach((section) => {
              if (Array.isArray(section.games)) {
                const gameIndex = section.games.findIndex((id) => String(id) === String(gameId));
                if (gameIndex !== -1) {
                  section.games.splice(gameIndex, 1);
                  hasChanges = true;
                }
              }
            });
            if (hasChanges) {
              writeJsonFile(oldRecommendedFile, recommendedData);
            }
          }
          
          return hasChanges;
        }
      } catch (e) {
        console.error(`Failed to process old format recommended file:`, e.message);
      }
    }
    
    return false;
  } catch (e) {
    console.error(`Failed to remove game from recommended:`, e.message);
    return false;
  }
}

function registerRecommendedRoutes(app, requireToken, metadataPath, allGames) {
  // Endpoint: get recommended games sections
  app.get("/recommended", requireToken, (req, res) => {
    const allSections = loadRecommendedSections(metadataPath);
    
    // Select 9 random sections from all available sections
    const selectedSections = [];
    const availableSections = [...allSections];
    const maxSections = Math.min(9, availableSections.length);
    
    for (let i = 0; i < maxSections; i++) {
      const randomIndex = Math.floor(Math.random() * availableSections.length);
      selectedSections.push(availableSections[randomIndex]);
      availableSections.splice(randomIndex, 1);
    }
    
    const sectionsWithGames = selectedSections.map((section) => {
      // Get full game data from allGames
      const games = section.games
        .map((id) => allGames[id])
        .filter((game) => game != null) // Filter out any missing games
        .map((g) => {
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
            command: g.command || null,
          };
          const background = getBackgroundUrl(g, metadataPath);
          if (background) {
            gameData.background = background;
          }
          return gameData;
        });
      
      return {
        id: section.title, // Return title as id (for client compatibility)
        title: section.title,
        games: games,
      };
    });
    
    res.json({
      sections: sectionsWithGames,
    });
  });
}

module.exports = {
  loadRecommendedSections,
  registerRecommendedRoutes,
  removeGameFromRecommended,
  ensureRecommendedSectionsComplete,
};

