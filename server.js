// server.js
// Minimal MyHomeGames backend with a safe launcher

// Load environment variables from .env file
// When running as macOS app bundle, look for .env in Resources directory
const path = require("path");
const fs = require("fs");
let envPath = null;

// When pkg creates an executable, __dirname doesn't work as expected.
// Try multiple methods to find the .env file in the app bundle Resources directory
// The executable is at: MyHomeGames.app/Contents/MacOS/MyHomeGames
// The .env file should be at: MyHomeGames.app/Contents/Resources/.env

// Method 1: Try relative to current working directory (when executed from MacOS directory)
// If we're in MacOS directory, Resources is one level up
const cwd = process.cwd();
if (cwd.includes("/Contents/MacOS") || cwd.includes("\\Contents\\MacOS")) {
  const resourcesPath = path.join(cwd, "..", "Resources", ".env");
  const resolvedPath = path.resolve(resourcesPath);
  if (fs.existsSync(resolvedPath)) {
    envPath = resolvedPath;
  }
}

// Method 2: Try using process.execPath (absolute path to executable)
if (!envPath) {
  try {
    let execPath = process.execPath;
    if (!path.isAbsolute(execPath)) {
      execPath = path.resolve(process.cwd(), execPath);
    }
    
    try {
      execPath = fs.realpathSync(execPath);
    } catch (e) {
      // Continue with resolved path
    }
    
    if (execPath.includes(".app/Contents/MacOS")) {
      const macosIndex = execPath.indexOf("/Contents/MacOS/");
      if (macosIndex !== -1) {
        const appBundlePath = execPath.substring(0, macosIndex);
        const resourcesEnvPath = path.join(appBundlePath, "Contents", "Resources", ".env");
        if (fs.existsSync(resourcesEnvPath)) {
          envPath = resourcesEnvPath;
        }
      }
    }
  } catch (error) {
    // Continue to next method
  }
}

// Method 3: Try using process.argv[0] (first argument, usually the executable)
if (!envPath) {
  try {
    let argv0 = process.argv[0];
    if (!path.isAbsolute(argv0)) {
      argv0 = path.resolve(process.cwd(), argv0);
    }
    
    try {
      argv0 = fs.realpathSync(argv0);
    } catch (e) {
      // Continue
    }
    
    if (argv0.includes(".app/Contents/MacOS")) {
      const macosIndex = argv0.indexOf("/Contents/MacOS/");
      if (macosIndex !== -1) {
        const appBundlePath = argv0.substring(0, macosIndex);
        const resourcesEnvPath = path.join(appBundlePath, "Contents", "Resources", ".env");
        if (fs.existsSync(resourcesEnvPath)) {
          envPath = resourcesEnvPath;
        }
      }
    }
  } catch (error) {
    // Continue
  }
}

// Method 4: Try relative to __dirname (for normal Node.js execution or if pkg preserves it)
if (!envPath) {
  try {
    const resourcesPath = path.join(__dirname, "..", "Resources", ".env");
    if (fs.existsSync(resourcesPath)) {
      envPath = path.resolve(resourcesPath);
    }
  } catch (error) {
    // Continue
  }
}

// Load .env file (if path specified, use it; otherwise dotenv will look in current directory)
if (envPath) {
  const result = require("dotenv").config({ path: envPath });
  if (result.error) {
    console.error(`Failed to load .env file from ${envPath}: ${result.error.message}`);
  }
} else {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
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

    // Generate private key (suppress output for faster startup)
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });

    // Generate self-signed certificate (suppress output for faster startup)
    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=localhost"`,
      { stdio: 'pipe' }
    );

    console.log(`SSL certificates generated successfully in ${certDir}`);
    return true;
  } catch (error) {
    console.error(`Failed to generate SSL certificates:`, error.message);
    return false;
  }
}

// All recommended sections logic has been moved to routes/recommended.js

// Signal to macOS immediately that we're starting (helps with icon bouncing)
// Write to stdout immediately to signal app readiness
// Note: stdout is line-buffered in Node.js, so \n forces a flush automatically
process.stdout.write('MyHomeGames Server\n');

// Create directory structure on startup
// In test mode, create all directories synchronously
// In production, create only essential directories first, rest later
if (process.env.NODE_ENV === 'test') {
  ensureMetadataDirectories();
} else {
  // Create only essential directories synchronously for faster startup
  const essentialDirs = [
    METADATA_PATH,
    path.join(METADATA_PATH, "content"),
    path.join(METADATA_PATH, "content", "games"),
    path.join(METADATA_PATH, "certs"),
  ];
  essentialDirs.forEach((dir) => {
    try {
      if (!fs.existsSync(dir)) {
        ensureDirectoryExists(dir);
      }
    } catch (error) {
      // Continue if directory creation fails - will be created later if needed
    }
  });
}

// Create settings.json with default settings if it doesn't exist (quick check)
if (!fs.existsSync(SETTINGS_FILE)) {
  try {
    const defaultSettings = { language: "en" };
    writeSettings(defaultSettings);
  } catch (error) {
    // Continue if settings creation fails
  }
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

// Load all games on startup (completely async, after server is listening)
// This allows the server to start faster and signal macOS that it's ready
// Delay loading games until after server is ready to avoid blocking startup
setTimeout(() => {
  // Create remaining directories if needed
  ensureMetadataDirectories();
  
  // Load games in background
  libraryRoutes.loadLibraryGames(METADATA_PATH, allGames);
  // Recommended games are now just IDs pointing to games already in allGames
  // Ensure recommended/metadata.json has all sections and is populated
  recommendedRoutes.ensureRecommendedSectionsComplete(METADATA_PATH);
}, 100); // Small delay to ensure server starts listening first

// Register routes
authRoutes.registerAuthRoutes(app, METADATA_PATH);
recommendedRoutes.registerRecommendedRoutes(app, requireToken, METADATA_PATH, allGames);
categoriesRoutes.registerCategoriesRoutes(app, requireToken, METADATA_PATH, METADATA_PATH, allGames);
igdbRoutes.registerIGDBRoutes(app, requireToken);
const collectionsHandler = collectionsRoutes.registerCollectionsRoutes(
  app,
  requireToken,
  METADATA_PATH,
  METADATA_PATH,
  allGames
);
const updateCollectionsCache = collectionsRoutes.createCacheUpdater(collectionsHandler.getCache());
libraryRoutes.registerLibraryRoutes(app, requireToken, METADATA_PATH, allGames, updateCollectionsCache);

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

// Endpoint: launcher — launches an executable for a game
app.get("/launcher", requireToken, (req, res) => {
  const gameId = req.query.gameId;
  if (!gameId) return res.status(400).json({ error: "Missing gameId" });

  const entry = allGames[Number(gameId)];
  if (!entry) return res.status(404).json({ error: "Game not found" });

  // 'executables' field contains array of names (without extension)
  // We need to construct the full path automatically using the first executable
  const executables = entry.executables;

  // Validate executables exists and has at least one item
  if (!executables || !Array.isArray(executables) || executables.length === 0) {
    return res.status(400).json({
      error: "Launch failed",
      detail: "No executables configured. Please check the game configuration."
    });
  }

  // Get executable name from query parameter or use first one
  const requestedExecutableName = req.query.executableName;
  let executableName;
  if (requestedExecutableName && typeof requestedExecutableName === 'string' && requestedExecutableName.trim()) {
    // Verify the requested executable exists in the list
    if (executables.includes(requestedExecutableName.trim())) {
      executableName = requestedExecutableName.trim();
    } else {
      return res.status(400).json({
        error: "Launch failed",
        detail: `Executable "${requestedExecutableName}" not found in game configuration.`
      });
    }
  } else {
    // Use first executable if no specific one requested
    executableName = executables[0];
  }
  if (!executableName || typeof executableName !== 'string' || executableName.trim() === '') {
    return res.status(400).json({
      error: "Launch failed",
      detail: "Invalid executable name. Please check the game configuration."
    });
  }
  
  // Construct the full path: {METADATA_PATH}/content/games/{gameId}/{name}.sh or {name}.bat
  // Sanitize executable name for filesystem (files are saved with sanitized names)
  const sanitizeExecutableName = (name) => {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  };
  const sanitizedExecutableName = sanitizeExecutableName(executableName);
  const gameContentDir = path.join(METADATA_PATH, "content", "games", String(gameId));
  // Try .sh first, then .bat
  let fullCommandPath = path.join(gameContentDir, `${sanitizedExecutableName}.sh`);
  if (!fs.existsSync(fullCommandPath)) {
    fullCommandPath = path.join(gameContentDir, `${sanitizedExecutableName}.bat`);
  }

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

    // Handle spawn errors (e.g., executable not found) - this happens synchronously
    child.on("error", (err) => {
      if (!responseSent) {
        responseSent = true;
        const errorMessage =
          err.code === "ENOENT"
            ? `Executable not found: ${fullCommandPath}. Please check if the executable exists.`
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

// Store server references for graceful shutdown
let httpServer = null;
let httpsServer = null;

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  
  const servers = [];
  if (httpServer) servers.push(httpServer);
  if (httpsServer) servers.push(httpsServer);
  
  if (servers.length === 0) {
    process.exit(0);
    return;
  }
  
  // Close all servers
  let closedCount = 0;
  servers.forEach((server) => {
    server.close(() => {
      closedCount++;
      if (closedCount === servers.length) {
        console.log('All servers closed. Exiting...');
        process.exit(0);
      }
    });
  });
  
  // Force exit after 10 seconds if servers don't close
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Only start listening if not in test environment
if (process.env.NODE_ENV !== 'test') {
  validateEnvironment();
  
  const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
  
  if (HTTPS_ENABLED) {
    // HTTPS server only
    const HTTPS_PORT = process.env.HTTPS_PORT || 41440;
    // Always use metadata path for certificates
    const metadataCertsDir = path.join(METADATA_PATH, 'certs');
    const keyPath = path.join(metadataCertsDir, 'key.pem');
    const certPath = path.join(metadataCertsDir, 'cert.pem');
    
    // Check if certificates exist first (fast check)
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      // Certificates exist, start server immediately
      try {
        const key = fs.readFileSync(keyPath);
        const cert = fs.readFileSync(certPath);
        
        httpsServer = https.createServer({ key, cert }, app);
        httpsServer.listen(HTTPS_PORT, '127.0.0.1', () => {
          console.log(`MyHomeGames server listening on https://localhost:${HTTPS_PORT}`);
          console.log(`Using SSL certificates from: ${metadataCertsDir}`);
          // Signal to macOS that the app is ready
          process.stdout.write('Server ready\n');
        });
        
        // Handle server errors
        httpsServer.on('error', (error) => {
          console.error('HTTPS server error:', error);
          if (error.code === 'EADDRINUSE') {
            console.error(`Port ${HTTPS_PORT} is already in use.`);
          }
        });
      } catch (error) {
        console.error("Error loading SSL certificates:", error.message);
        console.error("HTTPS server not started.");
        process.exit(1);
      }
    } else {
      // Certificates don't exist, generate them (this might take a moment)
      if (!ensureSSLCertificates(metadataCertsDir, keyPath, certPath)) {
        console.error("Failed to ensure SSL certificates exist.");
        console.error("HTTPS server not started.");
        process.exit(1);
      } else {
        try {
          const key = fs.readFileSync(keyPath);
          const cert = fs.readFileSync(certPath);
          
          httpsServer = https.createServer({ key, cert }, app);
          httpsServer.listen(HTTPS_PORT, '127.0.0.1', () => {
            console.log(`MyHomeGames server listening on https://localhost:${HTTPS_PORT}`);
            console.log(`Using SSL certificates from: ${metadataCertsDir}`);
            // Signal to macOS that the app is ready
            process.stdout.write('Server ready\n');
          });
          
          // Handle server errors
          httpsServer.on('error', (error) => {
            console.error('HTTPS server error:', error);
            if (error.code === 'EADDRINUSE') {
              console.error(`Port ${HTTPS_PORT} is already in use.`);
            }
          });
        } catch (error) {
          console.error("Error loading SSL certificates:", error.message);
          console.error("HTTPS server not started.");
          process.exit(1);
        }
      }
    }
  } else {
    // HTTP server only
    const HTTP_PORT = process.env.HTTP_PORT || PORT;
    httpServer = http.createServer(app);
    httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
      console.log(`MyHomeGames server listening on http://localhost:${HTTP_PORT}`);
      // Signal to macOS that the app is ready
      process.stdout.write('Server ready\n');
    });
    
    // Handle server errors
    httpServer.on('error', (error) => {
      console.error('HTTP server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${HTTP_PORT} is already in use.`);
      }
    });
  }
  
  if (!API_TOKEN) {
    console.warn("Warning: No API_TOKEN configured for development. For production, use Twitch OAuth (credentials passed via web requests).");
  }
}

// Export app for testing
module.exports = app;
