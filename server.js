// server.js
// Minimal MyHomeGames backend with a safe launcher

// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const https = require("https");
const http = require("http");
const { readJsonFile, ensureDirectoryExists, writeJsonFile } = require("./utils/fileUtils");

// Import route modules
const libraryRoutes = require("./routes/library");
const recommendedRoutes = require("./routes/recommended");
const categoriesRoutes = require("./routes/categories");
const collectionsRoutes = require("./routes/collections");
const authRoutes = require("./routes/auth");
const igdbRoutes = require("./routes/igdb");

const app = express();
app.use(express.json());
app.use(cors());

const API_TOKEN = process.env.API_TOKEN;
const PORT = process.env.PORT || 4000; // PORT can have a default
// Note: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are no longer read from .env
// They are now passed from the client during login and API requests
const API_BASE = process.env.API_BASE;
const METADATA_PATH =
  process.env.METADATA_PATH ||
  path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    "Library",
    "Application Support",
    "MyHomeGames"
  );

// Settings file path - stored in metadata path root
const SETTINGS_FILE = path.join(METADATA_PATH, "settings.json");

// Ensure metadata directory structure exists
function ensureMetadataDirectories() {
  const directories = [
    METADATA_PATH,
    path.join(METADATA_PATH, "content"),
    path.join(METADATA_PATH, "content", "games"),
    path.join(METADATA_PATH, "content", "collections"),
    path.join(METADATA_PATH, "content", "categories"),
    path.join(METADATA_PATH, "content", "recommended"),
    path.join(METADATA_PATH, "certs"),
  ];

  directories.forEach((dir) => {
    try {
      ensureDirectoryExists(dir);
      if (!fs.existsSync(dir)) {
        console.log(`Created directory: ${dir}`);
      }
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error.message);
    }
  });

  // No need to create metadata.json files in main directories anymore
  // Each item (game, collection, category, section) has its own folder with metadata.json
  // content/recommended sections will be handled by recommendedRoutes.ensureRecommendedSectionsComplete()
  // after routes are registered
}

// Generate SSL certificates if they don't exist
function ensureSSLCertificates(certDir, keyPath, certPath) {
  // Check if certificates already exist
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return true;
  }

  try {
    // Ensure cert directory exists
    ensureDirectoryExists(certDir);

    console.log(`Generating SSL certificates in ${certDir}...`);

    // Generate private key
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });

    // Generate self-signed certificate
    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=localhost"`,
      { stdio: 'inherit' }
    );

    console.log(`SSL certificates generated successfully in ${certDir}`);
    return true;
  } catch (error) {
    console.error(`Failed to generate SSL certificates:`, error.message);
    return false;
  }
}

// All recommended sections logic has been moved to routes/recommended.js

// Create directory structure on startup
ensureMetadataDirectories();

// Create settings.json with default settings if it doesn't exist
const settings = readSettings();
if (!fs.existsSync(SETTINGS_FILE)) {
  writeSettings(settings);
}

// Token auth middleware - supports both development token and Twitch tokens
function requireToken(req, res, next) {
  const token =
    req.header("X-Auth-Token") ||
    req.query.token ||
    req.header("Authorization");
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if it's the development token (for development only)
  if (API_TOKEN && token === API_TOKEN) {
    return next();
  }

  // Check if it's a valid Twitch token
  if (authRoutes.isValidToken(token, METADATA_PATH)) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}

// Load games whitelist from JSON files
// Games JSON files are now stored in METADATA_PATH/content/games/, content/collections/, content/categories/, content/recommended/
let allGames = {}; // Store all games by ID for launcher

// Load all games on startup
libraryRoutes.loadLibraryGames(METADATA_PATH, allGames);
// Recommended games are now just IDs pointing to games already in allGames

// Register routes
authRoutes.registerAuthRoutes(app, METADATA_PATH);
libraryRoutes.registerLibraryRoutes(app, requireToken, METADATA_PATH, allGames);
recommendedRoutes.registerRecommendedRoutes(app, requireToken, METADATA_PATH, allGames);
// Ensure recommended/metadata.json has all sections and is populated
recommendedRoutes.ensureRecommendedSectionsComplete(METADATA_PATH);
categoriesRoutes.registerCategoriesRoutes(app, requireToken, METADATA_PATH, METADATA_PATH, allGames);
igdbRoutes.registerIGDBRoutes(app, requireToken);
const collectionsHandler = collectionsRoutes.registerCollectionsRoutes(
  app,
  requireToken,
  METADATA_PATH,
  METADATA_PATH,
  allGames
);

// Endpoint: serve game cover image (public, no auth required for images)
app.get("/covers/:gameId", (req, res) => {
  const gameId = decodeURIComponent(req.params.gameId);
  const coverPath = path.join(METADATA_PATH, "content", "games", gameId, "cover.webp");

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

// Endpoint: serve game background image (public, no auth required for images)
app.get("/backgrounds/:gameId", (req, res) => {
  const gameId = decodeURIComponent(req.params.gameId);
  const backgroundPath = path.join(METADATA_PATH, "content", "games", gameId, "background.webp");

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Check if file exists
  if (!fs.existsSync(backgroundPath)) {
    // Return 404 with image content type to avoid CORB issues
    res.setHeader('Content-Type', 'image/webp');
    return res.status(404).end();
  }

  // Set appropriate content type for webp
  res.type("image/webp");
  res.sendFile(backgroundPath);
});

// Endpoint: serve collection background image (public, no auth required for images)
app.get("/collection-backgrounds/:collectionId", (req, res) => {
  const collectionId = decodeURIComponent(req.params.collectionId);
  const backgroundPath = path.join(METADATA_PATH, "content", "collections", String(collectionId), "background.webp");

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Check if file exists
  if (!fs.existsSync(backgroundPath)) {
    // Return 404 with image content type to avoid CORB issues
    res.setHeader('Content-Type', 'image/webp');
    return res.status(404).end();
  }

  // Set appropriate content type for webp
  res.type("image/webp");
  res.sendFile(backgroundPath);
});

// Endpoint: launcher — launches a whitelisted command for a game
app.get("/launcher", requireToken, (req, res) => {
  const gameId = req.query.gameId;
  if (!gameId) return res.status(400).json({ error: "Missing gameId" });

  const entry = allGames[Number(gameId)];
  if (!entry) return res.status(404).json({ error: "Game not found" });

  // 'command' field contains only the extension without dot (e.g., "sh" or "bat")
  // We need to construct the full path automatically
  const commandExtension = entry.command;

  // Validate command extension exists
  if (!commandExtension || typeof commandExtension !== 'string' || commandExtension.trim() === '') {
    return res.status(400).json({
      error: "Launch failed",
      detail: "Command is missing or invalid. Please check the game configuration."
    });
  }

  // Normalize extension (remove dot if present, then add it back for file path)
  const normalizedExt = commandExtension.startsWith('.') ? commandExtension.substring(1) : commandExtension;
  if (normalizedExt !== 'sh' && normalizedExt !== 'bat') {
    return res.status(400).json({
      error: "Launch failed",
      detail: "Invalid command extension. Only 'sh' and 'bat' are allowed."
    });
  }
  
  // Construct the full path: {METADATA_PATH}/content/games/{gameId}/script.{extension}
  const extension = `.${normalizedExt}`; // Add dot for file path
  const scriptName = `script${extension}`;
  const gameContentDir = path.join(METADATA_PATH, "content", "games", String(gameId));
  const fullCommandPath = path.join(gameContentDir, scriptName);

  // Validate that the script file exists
  if (!fs.existsSync(fullCommandPath)) {
    return res.status(404).json({
      error: "Launch failed",
      detail: `Script file not found: ${fullCommandPath}. Please upload the executable file first.`
    });
  }

  // Spawn process with shell to allow command with arguments
  // Quote the path if it contains spaces to avoid shell interpretation issues
  let responseSent = false;

  try {
    // Quote the path if it contains spaces
    const quotedPath = fullCommandPath.includes(' ') 
      ? `"${fullCommandPath}"` 
      : fullCommandPath;

    const child = spawn(quotedPath, {
      shell: true,
      detached: true,
      stdio: "ignore",
    });

    // Handle spawn errors (e.g., command not found) - this happens synchronously
    child.on("error", (err) => {
      if (!responseSent) {
        responseSent = true;
        const errorMessage =
          err.code === "ENOENT"
            ? `Command not found: ${fullCommandPath}. Please check if the executable exists.`
            : err.message;
        return res.status(500).json({
          error: "Launch failed",
          detail: errorMessage,
        });
      }
    });

    // Only send success response if spawn succeeded
    child.once("spawn", () => {
      if (!responseSent) {
        responseSent = true;
        child.unref();
        return res.json({ status: "launched", pid: child.pid });
      }
    });
  } catch (e) {
    if (!responseSent) {
      responseSent = true;
      // Include full error message and stack if available
      const errorDetail = e.message || e.toString() || "Unknown error occurred";
      return res
        .status(500)
        .json({ error: "Launch failed", detail: errorDetail });
    }
  }
});

// Reload games list (admin endpoint) — protected by token
app.post("/reload-games", requireToken, (req, res) => {
  allGames = {};
  libraryRoutes.loadLibraryGames(METADATA_PATH, allGames);
  // Recommended games are now just IDs pointing to games already in allGames
  const collectionsCache = collectionsHandler.reload();
  const recommendedSections = recommendedRoutes.loadRecommendedSections(METADATA_PATH);
  const categories = categoriesRoutes.loadCategories(METADATA_PATH);
  const totalCount = Object.keys(allGames).length;
  res.json({ 
    status: "reloaded", 
    count: totalCount, 
    collections: collectionsCache.length,
    recommended: recommendedSections.length,
    categories: categories.length
  });
});

// Helper function to read settings
function readSettings() {
  const defaultSettings = {
    language: "en",
  };
  const settings = readJsonFile(SETTINGS_FILE, defaultSettings);
  // Ensure we always return an object
  if (typeof settings !== 'object' || settings === null) {
    return defaultSettings;
  }
  return settings;
}

// Helper function to write settings
function writeSettings(settings) {
  try {
    // Ensure parent directory exists before writing
    const parentDir = path.dirname(SETTINGS_FILE);
    ensureDirectoryExists(parentDir);
    writeJsonFile(SETTINGS_FILE, settings);
    return true;
  } catch (e) {
    console.error("Error writing settings:", e.message);
    return false;
  }
}

// Endpoint: get settings
app.get("/settings", requireToken, (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

// Endpoint: update settings
app.put("/settings", requireToken, (req, res) => {
  const currentSettings = readSettings();
  const updatedSettings = {
    ...currentSettings,
    ...req.body,
  };

  if (writeSettings(updatedSettings)) {
    res.json({ status: "success", settings: updatedSettings });
  } else {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// Validate required environment variables
function validateEnvironment() {
  const errors = [];
  
  const API_BASE = process.env.API_BASE;
 
  // Note: Twitch OAuth credentials are now passed from client, not required in .env
  // API_BASE is still required for OAuth redirects
  const hasApiBase = !!API_BASE;
  
  if (!hasApiBase) {
    errors.push("API_BASE is required for Twitch OAuth redirects");
  }
  
  if (errors.length > 0) {
    console.error("Environment configuration errors:");
    errors.forEach(error => console.error(`  - ${error}`));
    console.error("\nPlease configure your .env file with the required variables.");
    process.exit(1);
  }
}

// Only start listening if not in test environment
if (process.env.NODE_ENV !== 'test') {
  validateEnvironment();
  
  // HTTP server (always available)
  const HTTP_PORT = process.env.HTTP_PORT || PORT;
  const httpServer = http.createServer(app);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`MyHomeGames server listening on http://localhost:${HTTP_PORT}`);
  });
  
  // HTTPS server (optional)
  const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
  const HTTPS_PORT = process.env.HTTPS_PORT || 41440; // Default HTTPS port different from HTTP
  
  if (HTTPS_ENABLED) {
    // Always use metadata path for certificates
    const metadataCertsDir = path.join(METADATA_PATH, 'certs');
    const keyPath = path.join(metadataCertsDir, 'key.pem');
    const certPath = path.join(metadataCertsDir, 'cert.pem');
    
    // Ensure certificates exist (generate if needed)
    if (!ensureSSLCertificates(metadataCertsDir, keyPath, certPath)) {
      console.error("Failed to ensure SSL certificates exist.");
      console.error("HTTPS server not started. Only HTTP available.");
    } else {
      try {
        const key = fs.readFileSync(keyPath);
        const cert = fs.readFileSync(certPath);
        
        const httpsServer = https.createServer({ key, cert }, app);
        httpsServer.listen(HTTPS_PORT, () => {
          console.log(`MyHomeGames server listening on https://localhost:${HTTPS_PORT}`);
          console.log(`Using SSL certificates from: ${metadataCertsDir}`);
        });
      } catch (error) {
        console.error("Error loading SSL certificates:", error.message);
        console.error("HTTPS server not started. Only HTTP available.");
      }
    }
  }
  
  if (!API_TOKEN) {
    console.warn("Warning: No API_TOKEN configured for development. For production, use Twitch OAuth (credentials passed via web requests).");
  }
}

// Export app for testing
module.exports = app;
