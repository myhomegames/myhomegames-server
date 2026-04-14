// server.js
// Minimal MyHomeGames backend with a safe launcher

// Load environment variables from .env file
// When running as macOS app bundle, look for .env in Resources directory
const path = require("path");
const fs = require("fs");
const os = require("os");
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
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { readJsonFile, ensureDirectoryExists, writeJsonFile } = require("./utils/fileUtils");

// Import route modules
const libraryRoutes = require("./routes/library");
const recommendedRoutes = require("./routes/recommended");
const categoriesRoutes = require("./routes/categories");
const themesRoutes = require("./routes/themes");
const platformsRoutes = require("./routes/platforms");
const gameEnginesRoutes = require("./routes/gameengines");
const gameModesRoutes = require("./routes/gamemodes");
const playerPerspectivesRoutes = require("./routes/playerperspectives");
const seriesRoutes = require("./routes/series");
const franchisesRoutes = require("./routes/franchises");
const skinsRoutes = require("./routes/skins");
const collectionsRoutes = require("./routes/collections");
const developersRoutes = require("./routes/developers");
const publishersRoutes = require("./routes/publishers");
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

/** Default data directory: macOS ~/Library/..., Windows %APPDATA%\\MyHomeGames, Linux XDG or ~/.local/share */
function getDefaultMetadataPath() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "MyHomeGames");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "MyHomeGames");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "MyHomeGames");
}

const METADATA_PATH = process.env.METADATA_PATH || getDefaultMetadataPath();
const DEFAULT_SKIN_URL =
  process.env.DEFAULT_SKIN_URL || "https://myhomegamesskins.vige.it/zips/plex.mhg-skin.zip";

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
    path.join(METADATA_PATH, "content", "themes"),
    path.join(METADATA_PATH, "content", "platforms"),
    path.join(METADATA_PATH, "content", "game-engines"),
    path.join(METADATA_PATH, "content", "game-modes"),
    path.join(METADATA_PATH, "content", "player-perspectives"),
    path.join(METADATA_PATH, "content", "developers"),
    path.join(METADATA_PATH, "content", "publishers"),
    path.join(METADATA_PATH, "content", "series"),
    path.join(METADATA_PATH, "content", "franchises"),
    path.join(METADATA_PATH, "content", "recommended"),
    path.join(METADATA_PATH, "skins"),
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

function isUuidSkinId(id) {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

function hasInstalledSkins(skinsDir) {
  if (!fs.existsSync(skinsDir)) return false;
  return fs
    .readdirSync(skinsDir, { withFileTypes: true })
    .some((ent) => ent.isDirectory() && isUuidSkinId(ent.name));
}

function fetchUrlBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, (res) => {
      const status = Number(res.statusCode || 0);
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        fetchUrlBuffer(next, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timeout")));
  });
}

function findSkinContentRoot(extractRoot) {
  const atRoot = path.join(extractRoot, "skin.json");
  if (fs.existsSync(atRoot)) return extractRoot;
  const entries = fs.readdirSync(extractRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const files = entries.filter((e) => e.isFile());
  if (dirs.length === 1 && files.length === 0) {
    const nested = path.join(extractRoot, dirs[0].name);
    if (fs.existsSync(path.join(nested, "skin.json"))) return nested;
  }
  return null;
}

function readBundleCssFromSkinDir(skinDir) {
  const bundlePath = path.join(skinDir, "bundle.css");
  if (!fs.existsSync(bundlePath)) return null;
  const css = fs.readFileSync(bundlePath, "utf8");
  return String(css).trim() ? css : null;
}

function installSkinZipBuffer(buffer, metadataPath, fallbackName = "Plex") {
  const skinsDir = path.join(metadataPath, "skins");
  ensureDirectoryExists(skinsDir);

  const tempDir = path.join(skinsDir, `.bootstrap-${crypto.randomUUID()}`);
  ensureDirectoryExists(tempDir);
  try {
    const zip = new AdmZip(buffer);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const rel = String(entry.entryName).replace(/\\/g, "/").replace(/^\/+/, "");
      if (!rel || rel.includes("..")) throw new Error("invalid_zip_path");
      const out = path.join(tempDir, rel);
      const resolved = path.resolve(out);
      const resolvedBase = path.resolve(tempDir);
      if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
        throw new Error("invalid_zip_path");
      }
      ensureDirectoryExists(path.dirname(out));
      fs.writeFileSync(out, entry.getData());
    }

    const contentRoot = findSkinContentRoot(tempDir);
    if (!contentRoot) throw new Error("missing_skin_json");
    const css = readBundleCssFromSkinDir(contentRoot);
    if (!css) throw new Error("missing_css");

    const rawMeta = readJsonFile(path.join(contentRoot, "skin.json"), {});
    const meta = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? { ...rawMeta } : {};
    const metaName = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : fallbackName;

    const id = crypto.randomUUID();
    const finalDir = path.join(skinsDir, id);
    fs.mkdirSync(finalDir, { recursive: true });
    for (const ent of fs.readdirSync(contentRoot, { withFileTypes: true })) {
      const src = path.join(contentRoot, ent.name);
      const dst = path.join(finalDir, ent.name);
      fs.cpSync(src, dst, { recursive: true });
    }
    const nextMeta = { ...meta, name: metaName, id, installedAt: Date.now() };
    fs.writeFileSync(path.join(finalDir, "skin.json"), JSON.stringify(nextMeta, null, 2), "utf8");
    return { id, name: metaName };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureDefaultSkinInstalled() {
  if (process.env.NODE_ENV === "test") return;
  const skinsDir = path.join(METADATA_PATH, "skins");
  try {
    ensureDirectoryExists(skinsDir);
    if (hasInstalledSkins(skinsDir)) return;
    const zipBuffer = await fetchUrlBuffer(DEFAULT_SKIN_URL);
    const installed = installSkinZipBuffer(zipBuffer, METADATA_PATH, "Plex");
    const currentSettings = readJsonFile(SETTINGS_FILE, {});
    const safeSettings =
      currentSettings && typeof currentSettings === "object" && !Array.isArray(currentSettings)
        ? currentSettings
        : {};
    writeJsonFile(SETTINGS_FILE, {
      ...safeSettings,
      activeSkinId: installed.id,
    });
    console.log(`Installed default skin "${installed.name}" (${installed.id}) from ${DEFAULT_SKIN_URL}`);
    console.log(`Selected default skin "${installed.name}" (${installed.id})`);
  } catch (error) {
    console.error(`Failed to install default skin from ${DEFAULT_SKIN_URL}:`, error.message);
  }
}

function unlinkIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/** Generate self-signed PEMs without openssl (Windows and other systems without openssl in PATH). selfsigned v5 is async-only. */
async function generateSelfSignedCertificatesWithNode(keyPath, certPath) {
  const selfsigned = require("selfsigned");
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    keyType: "rsa",
    algorithm: "sha256",
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
}

// Generate SSL certificates if they don't exist
async function ensureSSLCertificates(certDir, keyPath, certPath) {
  // Check if certificates already exist
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return true;
  }

  try {
    // Ensure cert directory exists
    ensureDirectoryExists(certDir);

    console.log(`Generating SSL certificates in ${certDir}...`);

    try {
      // Prefer openssl when available (often preinstalled on macOS/Linux)
      execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: "pipe" });
      execSync(
        `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=localhost"`,
        { stdio: "pipe" }
      );
    } catch (opensslErr) {
      unlinkIfExists(keyPath);
      unlinkIfExists(certPath);
      console.warn(
        "openssl not available or failed; generating certificates with Node.js (no openssl required)."
      );
      await generateSelfSignedCertificatesWithNode(keyPath, certPath);
    }

    console.log(`SSL certificates generated successfully in ${certDir}`);
    return true;
  } catch (error) {
    console.error(`Failed to generate SSL certificates:`, error.message);
    return false;
  }
}

// All recommended sections logic has been moved to routes/recommended.js

// Signal to macOS immediately that we're starting (helps with icon bouncing)
// Write to stdout immediately to signal app readiness (skip in test to avoid noisy output)
if (process.env.NODE_ENV !== 'test') {
  process.stdout.write('MyHomeGames Server\n');
}

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
    const defaultSettings = {
      language: "en",
      visibleLibraries: ["recommended", "library", "collections", "categories"],
    };
    writeSettings(defaultSettings);
  } catch (error) {
    // Continue if settings creation fails
  }
}

// Token auth middleware - supports both development token and Twitch tokens
function requireToken(req, res, next) {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (isAuthorizedToken(token)) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}

function getRequestToken(req) {
  return (
    req.header("X-Auth-Token") ||
    req.query.token ||
    req.header("Authorization")
  );
}

function isAuthorizedToken(token) {
  if (!token) return false;
  if (API_TOKEN && token === API_TOKEN) return true;
  return authRoutes.isValidToken(token, METADATA_PATH);
}

// Optional token: when Twitch login is disabled, allow access without token; otherwise require token
function optionalToken(req, res, next) {
  const settings = readSettings();
  if (!settings.twitchLoginEnabled) {
    return next();
  }
  return requireToken(req, res, next);
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
  void ensureDefaultSkinInstalled();
  
  // Load games in background
  libraryRoutes.loadLibraryGames(METADATA_PATH, allGames);
  // Recommended sections are created/updated only when games are created
}, 100); // Small delay to ensure server starts listening first

// Register routes
authRoutes.registerAuthRoutes(app, METADATA_PATH);
recommendedRoutes.registerRecommendedRoutes(app, optionalToken, METADATA_PATH, allGames);
categoriesRoutes.registerCategoriesRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
igdbRoutes.registerIGDBRoutes(app, optionalToken);
const collectionsHandler = collectionsRoutes.registerCollectionsRoutes(
  app,
  optionalToken,
  METADATA_PATH,
  METADATA_PATH,
  allGames
);
const developersHandler = developersRoutes.registerDevelopersRoutes(
  app,
  optionalToken,
  METADATA_PATH,
  METADATA_PATH,
  allGames
);
const publishersHandler = publishersRoutes.registerPublishersRoutes(
  app,
  optionalToken,
  METADATA_PATH,
  METADATA_PATH,
  allGames
);
const updateCollectionsCache = collectionsRoutes.createCacheUpdater(collectionsHandler.getCache());
libraryRoutes.registerLibraryRoutes(
  app,
  optionalToken,
  METADATA_PATH,
  allGames,
  updateCollectionsCache,
  recommendedRoutes.ensureRecommendedSectionsComplete,
  collectionsHandler.getCache,
  developersHandler.getCache,
  publishersHandler.getCache
);
themesRoutes.registerThemesRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
platformsRoutes.registerPlatformsRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
gameEnginesRoutes.registerGameEnginesRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
gameModesRoutes.registerGameModesRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
playerPerspectivesRoutes.registerPlayerPerspectivesRoutes(app, optionalToken, METADATA_PATH, METADATA_PATH, allGames);
seriesRoutes.registerSeriesRoutes(app, optionalToken, allGames, METADATA_PATH);
franchisesRoutes.registerFranchisesRoutes(app, optionalToken, allGames, METADATA_PATH);
skinsRoutes.registerSkinsRoutes(app, requireToken, optionalToken, METADATA_PATH);

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
  
  // Metadata stores labels; files on disk can be label+platformId (e.g. Play1.sh). Resolve to path.
  const sanitizeExecutableName = (name) => {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  };
  const sanitizedExecutableName = sanitizeExecutableName(executableName);
  const scriptsDir = path.join(METADATA_PATH, "content", "games", String(gameId), "scripts");
  let fullCommandPath = path.join(scriptsDir, `${sanitizedExecutableName}.sh`);
  if (!fs.existsSync(fullCommandPath)) {
    fullCommandPath = path.join(scriptsDir, `${sanitizedExecutableName}.bat`);
  }
  if (!fs.existsSync(fullCommandPath) && fs.existsSync(scriptsDir)) {
    const matchLabel = (base, label) => {
      if (base === label) return true;
      const m = base.match(/^\d+-(.+)$/);
      if (!m) return false;
      const rest = m[1];
      return rest === label || rest.startsWith(label + '-');
    };
    const files = fs.readdirSync(scriptsDir);
    const match = files.find(f => {
      const ext = path.extname(f).toLowerCase();
      if (ext !== '.sh' && ext !== '.bat') return false;
      const base = path.basename(f, ext);
      return matchLabel(base, sanitizedExecutableName);
    });
    if (match) fullCommandPath = path.join(scriptsDir, match);
  }

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
  developersHandler.reload();
  publishersHandler.reload();
  const recommendedSections = recommendedRoutes.loadRecommendedSections(METADATA_PATH);
  const categories = categoriesRoutes.loadCategories(METADATA_PATH);
  const themes = themesRoutes.loadThemes(METADATA_PATH);
  const platforms = platformsRoutes.loadPlatforms(METADATA_PATH);
  const gameEngines = gameEnginesRoutes.loadGameEngines(METADATA_PATH);
  const gameModes = gameModesRoutes.loadGameModes(METADATA_PATH);
  const playerPerspectives = playerPerspectivesRoutes.loadPlayerPerspectives(METADATA_PATH);
  const totalCount = Object.keys(allGames).length;
  res.json({ 
    status: "reloaded", 
    count: totalCount, 
    collections: collectionsCache.length,
    developers: developersHandler.getCache().length,
    publishers: publishersHandler.getCache().length,
    recommended: recommendedSections.length,
    categories: categories.length,
    themes: themes.length,
    platforms: platforms.length,
    gameEngines: gameEngines.length,
    gameModes: gameModes.length,
    playerPerspectives: playerPerspectives.length
  });
});

// Helper function to read settings
function readSettings() {
  const defaultSettings = {
    language: "en",
    visibleLibraries: ["recommended", "library", "collections", "categories"],
    twitchLoginEnabled: false,
    activeSkinId: "",
    twitchClientId: "",
    twitchClientSecret: "",
  };
  const settings = readJsonFile(SETTINGS_FILE, defaultSettings);
  // Ensure we always return an object and merge with defaults for missing keys
  if (typeof settings !== 'object' || settings === null) {
    return defaultSettings;
  }
  return { ...defaultSettings, ...settings };
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

// Endpoint: get settings (public so client can load twitchLoginEnabled without token)
app.get("/settings", (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

// Endpoint: get server version (public, for update notification to compare with GitHub releases)
function getServerVersion() {
  try {
    const infoPath = path.join(process.cwd(), "server-info.json");
    if (fs.existsSync(infoPath)) {
      const data = JSON.parse(fs.readFileSync(infoPath, "utf8"));
      if (data && typeof data.version === "string") return data.version;
    }
  } catch (_) {}
  try {
    const pkgPath = path.join(__dirname, "package.json");
    if (fs.existsSync(pkgPath)) {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (data && typeof data.version === "string") return data.version;
    }
  } catch (_) {}
  return null;
}
app.get("/version", (req, res) => {
  const version = getServerVersion();
  if (version) res.json({ version });
  else res.status(500).json({ error: "Version not available" });
});

// Endpoint: update settings
// Special case: if Twitch login is currently enabled and caller is unauthenticated,
// allow only the emergency toggle { twitchLoginEnabled: false } to avoid lock-out.
app.put("/settings", (req, res) => {
  const currentSettings = readSettings();
  const token = getRequestToken(req);
  const authorized = isAuthorizedToken(token);
  const twitchEnabled = !!currentSettings.twitchLoginEnabled;

  if (twitchEnabled && !authorized) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const keys = Object.keys(body);
    const isDisableOnlyRequest =
      keys.length === 1 &&
      keys[0] === "twitchLoginEnabled" &&
      body.twitchLoginEnabled === false;

    if (!isDisableOnlyRequest) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const updatedSettings = {
    ...currentSettings,
    ...req.body,
  };

  const ok = writeSettings(updatedSettings);
  if (ok) {
    res.json({ status: "success", settings: updatedSettings });
  } else {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// Endpoint: redirect to frontend URL (default redirect endpoint)
// This endpoint allows the browser to accept the server certificate during redirect
app.get("/", (req, res) => {
  // Get frontend URL from environment or derive from API_BASE
  let frontendUrl = process.env.FRONTEND_URL;
  
  if (!frontendUrl && API_BASE) {
    // Try to derive frontend URL from API_BASE (remove port and path)
    try {
      const apiUrl = new URL(API_BASE);
      // Default frontend ports: 5173 (Vite dev), 3000, or same as API port
      const frontendPort = process.env.FRONTEND_PORT || '5173';
      frontendUrl = `${apiUrl.protocol}//${apiUrl.hostname}:${frontendPort}`;
    } catch (e) {
      // Fallback if URL parsing fails
      frontendUrl = 'http://localhost:5173';
    }
  }
  
  if (!frontendUrl) {
    frontendUrl = 'http://localhost:5173';
  }
  
  res.redirect(frontendUrl);
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
    // HTTPS server only (async: selfsigned v5 generates certs via Promise)
    const HTTPS_PORT = process.env.HTTPS_PORT || 41440;
    const metadataCertsDir = path.join(METADATA_PATH, "certs");
    const keyPath = path.join(metadataCertsDir, "key.pem");
    const certPath = path.join(metadataCertsDir, "cert.pem");

    (async () => {
      try {
        if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
          const ok = await ensureSSLCertificates(metadataCertsDir, keyPath, certPath);
          if (!ok) {
            console.error("Failed to ensure SSL certificates exist.");
            console.error("HTTPS server not started.");
            process.exit(1);
            return;
          }
        }

        const key = fs.readFileSync(keyPath);
        const cert = fs.readFileSync(certPath);

        httpsServer = https.createServer({ key, cert }, app);
        httpsServer.listen(HTTPS_PORT, "127.0.0.1", () => {
          console.log(`MyHomeGames server listening on https://localhost:${HTTPS_PORT}`);
          console.log(`Using SSL certificates from: ${metadataCertsDir}`);
          process.stdout.write("Server ready\n");
        });

        httpsServer.on("error", (error) => {
          console.error("HTTPS server error:", error);
          if (error.code === "EADDRINUSE") {
            console.error(`Port ${HTTPS_PORT} is already in use.`);
          }
        });
      } catch (error) {
        console.error("Error loading SSL certificates:", error.message);
        console.error("HTTPS server not started.");
        process.exit(1);
      }
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
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
