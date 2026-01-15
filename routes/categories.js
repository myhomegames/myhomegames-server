const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");

/**
 * Categories routes module
 * Handles categories endpoints
 */

// Helper function to generate a numeric ID from category title
function getCategoryId(categoryTitle) {
  // Generate a numeric hash from the title
  // This ensures the same title always gets the same ID
  let hash = 0;
  const str = String(categoryTitle).toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Return positive number
  return Math.abs(hash);
}

// Helper function to get category directory path using numeric ID
function getCategoryDir(metadataPath, categoryId) {
  return path.join(metadataPath, "content", "categories", String(categoryId));
}

// Helper function to get category metadata.json path
function getCategoryMetadataPath(metadataPath, categoryId) {
  const categoryDir = getCategoryDir(metadataPath, categoryId);
  return path.join(categoryDir, "metadata.json");
}

// Helper function to find category ID by title
function findCategoryIdByTitle(metadataPath, categoryTitle) {
  const categories = loadCategories(metadataPath);
  const trimmedTitle = categoryTitle.trim();
  // Check if category exists (case-insensitive match)
  const existingCategory = categories.find(cat => cat.title.toLowerCase() === trimmedTitle.toLowerCase());
  if (existingCategory) {
    // Return the existing category ID
    return existingCategory.id;
  }
  return null;
}

// Helper function to save a single category (create directory and metadata.json)
function saveCategory(metadataPath, categoryTitle) {
  const categoryId = getCategoryId(categoryTitle);
  const categoryDir = getCategoryDir(metadataPath, categoryId);
  ensureDirectoryExists(categoryDir);
  // Create metadata.json with title
  const metadataFilePath = getCategoryMetadataPath(metadataPath, categoryId);
  const metadata = { title: categoryTitle };
  writeJsonFile(metadataFilePath, metadata);
}

// Helper function to check if a category exists and load its title
function loadCategory(metadataPath, categoryTitle) {
  const categoryId = findCategoryIdByTitle(metadataPath, categoryTitle);
  if (!categoryId) {
    return null;
  }
  const metadataFilePath = getCategoryMetadataPath(metadataPath, categoryId);
  const metadata = readJsonFile(metadataFilePath, null);
  // Return the title from metadata.json if it exists, null otherwise
  return metadata && metadata.title ? metadata.title : null;
}

// Helper function to delete a category
function deleteCategory(metadataPath, categoryTitle) {
  const categoryId = findCategoryIdByTitle(metadataPath, categoryTitle);
  if (!categoryId) {
    return;
  }
  const categoryDir = getCategoryDir(metadataPath, categoryId);
  if (fs.existsSync(categoryDir)) {
    // Delete all files in the directory first
    try {
      const files = fs.readdirSync(categoryDir);
      files.forEach((file) => {
        const filePath = path.join(categoryDir, file);
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
    removeDirectoryIfEmpty(categoryDir);
  }
}

function loadCategories(metadataPath) {
  const categoriesDir = path.join(metadataPath, "content", "categories");
  const categories = [];
  
  if (!fs.existsSync(categoriesDir)) {
    return categories;
  }
  
  // Read all subdirectories (each category has its own folder with metadata.json)
  const categoryFolders = fs.readdirSync(categoriesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  // Load title and ID from each category's metadata.json
  categoryFolders.forEach((folderName) => {
    // The folder name must be a numeric ID
    const categoryId = Number(folderName);
    // Skip folders that are not numeric (e.g., old format folders with category names)
    if (isNaN(categoryId)) {
      return;
    }
    const metadataFilePath = path.join(categoriesDir, folderName, "metadata.json");
    const metadata = readJsonFile(metadataFilePath, null);
    if (metadata && metadata.title) {
      categories.push({
        id: categoryId,
        title: metadata.title
      });
    }
  });
  
  // Sort categories alphabetically by title
  categories.sort((a, b) => a.title.localeCompare(b.title));
  
  return categories;
}


// Helper function to create a category if it doesn't exist (returns category title or null)
function ensureCategoryExists(metadataPath, genreTitle) {
  if (!genreTitle || typeof genreTitle !== "string" || !genreTitle.trim()) {
    return null;
  }

  const trimmedTitle = genreTitle.trim();
  const categories = loadCategories(metadataPath);
  
  // Check if category already exists (case-insensitive match for filesystem compatibility)
  // On case-insensitive filesystems (like macOS), "Adventure" and "ADVENTURE" are the same folder
  const existingCategory = categories.find(cat => cat.title.toLowerCase() === trimmedTitle.toLowerCase());
  if (existingCategory) {
    // Return the existing category title (preserve the case that's already in the filesystem)
    return existingCategory.title;
  }

  // Save new category to its own folder
  try {
    saveCategory(metadataPath, trimmedTitle);
    return trimmedTitle;
  } catch (e) {
    console.error(`Failed to save category ${trimmedTitle}:`, e.message);
    return null;
  }
}

function registerCategoriesRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  // Configure multer for file uploads (memory storage, we'll save manually)
  const upload = multer({ storage: multer.memoryStorage() });

  // Endpoint: serve category cover image (public, no auth required for images)
  app.get("/category-covers/:categoryTitle", (req, res) => {
    const categoryTitle = decodeURIComponent(req.params.categoryTitle);
    const categoryId = findCategoryIdByTitle(metadataPath, categoryTitle);
    if (!categoryId) {
      return res.status(404).send("Category not found");
    }
    const coverPath = path.join(metadataPath, "content", "categories", String(categoryId), "cover.webp");

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

  // Endpoint: list categories
  app.get("/categories", requireToken, (req, res) => {
    const categories = loadCategories(metadataPath);
    // Return categories with title as id (for client compatibility)
    // The numeric ID is only used internally for folder names
    res.json({
      categories: categories.map(cat => cat.title),
    });
  });

  // Endpoint: create new category
  app.post("/categories", requireToken, (req, res) => {
    const { title } = req.body;
    
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Check if category already exists before creating
    const categories = loadCategories(metadataPath);
    const trimmedTitle = title.trim();
    
    const existingCategory = categories.find(cat => cat.title.toLowerCase() === trimmedTitle.toLowerCase());
    if (existingCategory) {
      return res.status(409).json({ 
        error: "Category already exists", 
        category: existingCategory.title
      });
    }

    // Create the category
    const categoryTitle = ensureCategoryExists(metadataPath, title);
    
    if (!categoryTitle) {
      return res.status(500).json({ error: "Failed to create category" });
    }
    
    // Note: Category content directory is not created during category creation.
    // It will be created only when uploading cover via edit endpoints.
    // Cover images will be displayed from IGDB URLs if local files don't exist.
    
    res.json({
      category: categoryTitle,
    });
  });

  // Endpoint: delete category (only if not used by any game)
  app.delete("/categories/:categoryTitle", requireToken, (req, res) => {
    const categoryTitle = decodeURIComponent(req.params.categoryTitle);
    const categories = loadCategories(metadataPath);
    
    // Find the category
    const category = categories.find(cat => cat.title.toLowerCase() === categoryTitle.toLowerCase());
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Reload games from file to ensure we have the latest data
    // Use the new directory-per-game structure
    let allGamesFromFile = {};
    try {
      const gamesDir = path.join(metadataPath, "content", "games");
      if (fs.existsSync(gamesDir)) {
        const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        gameFolders.forEach((gameId) => {
          const gameMetadataPath = path.join(gamesDir, gameId, "metadata.json");
          if (fs.existsSync(gameMetadataPath)) {
            const game = readJsonFile(gameMetadataPath, null);
            if (game) {
              // Use folder name as ID
              game.id = Number(gameId) || gameId;
              allGamesFromFile[game.id] = game;
            }
          }
        });
      }
    } catch (e) {
      console.error("Failed to reload games for category deletion check:", e.message);
      // Fallback to in-memory allGames
      allGamesFromFile = allGames;
    }

    // Check if category is used by any game (exact match)
    const isUsed = Object.values(allGamesFromFile).some((game) => {
      if (!game.genre) return false;
      if (Array.isArray(game.genre)) {
        return game.genre.includes(categoryTitle);
      }
      return String(game.genre) === categoryTitle;
    });

    if (isUsed) {
      return res.status(409).json({ 
        error: "Category is still in use by one or more games",
        message: "Cannot delete category that is assigned to games"
      });
    }

    // Delete category folder and its metadata.json
    deleteCategory(metadataPath, categoryTitle);
    
    res.json({ status: "success", message: "Category deleted" });
  });

  // Endpoint: upload cover image for a category
  app.post("/categories/:categoryTitle/upload-cover", requireToken, upload.single('file'), (req, res) => {
    const categoryTitle = decodeURIComponent(req.params.categoryTitle);
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    // Validate file is an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }
    
    // Validate category exists
    const categoryId = findCategoryIdByTitle(metadataPath, categoryTitle);
    if (!categoryId) {
      return res.status(404).json({ error: "Category not found" });
    }
    
    try {
      // Create category content directory if it doesn't exist
      const categoryContentDir = getCategoryDir(metadataPath, categoryId);
      ensureDirectoryExists(categoryContentDir);
      
      // Ensure category metadata.json exists
      const categoryMetadataPath = getCategoryMetadataPath(metadataPath, categoryId);
      if (!fs.existsSync(categoryMetadataPath)) {
        // Create metadata.json with title
        const metadata = { title: categoryTitle };
        writeJsonFile(categoryMetadataPath, metadata);
      }
      
      // Save as cover.webp
      const coverPath = path.join(categoryContentDir, "cover.webp");
      fs.writeFileSync(coverPath, file.buffer);
      
      // Return success with cover URL
      res.json({ 
        status: "success",
        category: {
          title: categoryTitle,
          cover: `/category-covers/${encodeURIComponent(categoryTitle)}`,
        },
      });
    } catch (error) {
      console.error(`Failed to save cover for category ${categoryTitle}:`, error);
      res.status(500).json({ error: "Failed to save cover image" });
    }
  });
}

/**
 * Delete a category if it's not used by any game
 * @param {string} metadataPath - Path to metadata directory
 * @param {string} metadataGamesDir - Path to metadata/games directory
 * @param {string} categoryTitle - Category title to delete
 * @param {Object} allGamesFromFile - Object with all games (gameId -> game object)
 * @returns {boolean} - True if category was deleted, false if it's still in use
 */
function deleteCategoryIfUnused(metadataPath, metadataGamesDir, categoryTitle, allGamesFromFile) {
  const categories = loadCategories(metadataPath);
  
  // Find the category
  const category = categories.find(cat => cat.title.toLowerCase() === categoryTitle.toLowerCase());
  if (!category) {
    return false; // Category not found
  }

  // Check if category is used by any game (case-insensitive match)
  const categoryTitleLower = categoryTitle.toLowerCase();
  const isUsed = Object.values(allGamesFromFile).some((game) => {
    if (!game.genre) return false;
    if (Array.isArray(game.genre)) {
      return game.genre.some(g => String(g).toLowerCase() === categoryTitleLower);
    }
    return String(game.genre).toLowerCase() === categoryTitleLower;
  });

  if (isUsed) {
    return false; // Category is still in use
  }

  // Delete category folder and its metadata.json
  deleteCategory(metadataPath, categoryTitle);
  
  return true; // Category was deleted
}

module.exports = {
  loadCategories,
  ensureCategoryExists,
  deleteCategoryIfUnused,
  registerCategoriesRoutes,
};

