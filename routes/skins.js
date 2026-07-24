const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { ensureDirectoryExists, readJsonFile } = require("../utils/fileUtils");
const {
  isAllowedSkinReleaseDownloadUrl,
  fetchUrlBuffer,
} = require("../utils/skinDownload");

const MAX_SKINS = 24;
const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function skinsRoot(metadataPath) {
  return path.join(metadataPath, "skins");
}

function isUuidSkinId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

function resolveSkinSnapshotPath(skinDir, meta) {
  const candidates = [];
  if (meta && typeof meta.snapshot === "string" && meta.snapshot.trim()) {
    const raw = meta.snapshot.trim();
    if (!raw.includes("..") && !path.isAbsolute(raw) && !raw.includes("\\")) {
      candidates.push(raw);
    }
  }
  candidates.push("snapshot.svg", "snapshot.png", "snapshot.jpg", "snapshot.jpeg", "snapshot.webp");

  for (const rel of candidates) {
    const abs = path.join(skinDir, rel);
    const resolved = path.resolve(abs);
    const resolvedBase = path.resolve(skinDir);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return abs;
    }
  }
  return null;
}

/**
 * Reject zip slip and absolute paths. Returns normalized posix-style relative path or null.
 */
function safeEntryName(entryName) {
  const norm = String(entryName).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.includes("..")) return null;
  const segments = norm.split("/");
  if (segments.some((s) => s === "..")) return null;
  return norm;
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

function collectCssFilesRecursive(dir, base = "") {
  /** @type {{ abs: string; rel: string }[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...collectCssFilesRecursive(abs, rel));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".css")) out.push({ abs, rel });
  }
  return out;
}

function readBundleCssFromSkinDir(skinDir) {
  const bundlePath = path.join(skinDir, "bundle.css");
  if (fs.existsSync(bundlePath)) {
    return fs.readFileSync(bundlePath, "utf8");
  }
  const files = collectCssFilesRecursive(skinDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  if (files.length === 0) return null;
  return files.map((f) => fs.readFileSync(f.abs, "utf8")).join("\n\n");
}

function countUuidSkinDirs(root) {
  if (!fs.existsSync(root)) return 0;
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && isUuidSkinId(d.name))
    .length;
}

/*
 * Default shape of the SPA skin web manifest. All flags are opt-in (false by default).
 * Keep keys in sync with myhomegames-web `skinWebManifest.ts` (WEB_KEYS + sidebarSearchPopup default).
 * Exported so server.js can reuse it when hydrating `settings.skinWeb` from the active skin.
 */
const DEFAULT_SKIN_WEB_MANIFEST = Object.freeze({
  persistentLibraryShell: false,
  collectionsShortcutList: false,
  libraryPagesVerticalList: false,
  libraryHoverSelect: false,
  libraryBarHeaderActions: false,
  topRightToolDock: false,
  headerTitleFilter: false,
  disableAlphabetNavigator: false,
  sidebarSearchPopup: false,
  ownedGamesFirstInGamesSidebar: false,
  compactCollectionLikeDetail: false,
  verticalCoverAlignment: false,
  fixedFocalStepSound: false,
  autoShowBackgroundOnSelection: false,
  disableTitleTooltips: false,
  collapsibleLibrarySidebar: false,
});

const SKIN_WEB_KEYS = Object.freeze(Object.keys(DEFAULT_SKIN_WEB_MANIFEST));

/** Same display name as an installed skin → replace that folder (keeps UUID / activeSkinId). */
/**
 * Optional skin.json → `web` booleans for the SPA (no skin names in the client).
 * @param {unknown} meta
 */
function extractWebManifest(meta) {
  const out = { ...DEFAULT_SKIN_WEB_MANIFEST };
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return out;
  const w = meta.web;
  if (!w || typeof w !== "object" || Array.isArray(w)) return out;

  out.persistentLibraryShell = w.persistentLibraryShell === true;
  out.collectionsShortcutList = w.collectionsShortcutList === true;
  out.libraryPagesVerticalList = w.libraryPagesVerticalList === true;
  out.libraryHoverSelect = w.libraryHoverSelect === true;
  out.libraryBarHeaderActions = w.libraryBarHeaderActions === true;
  out.topRightToolDock = w.topRightToolDock === true;
  out.headerTitleFilter = w.headerTitleFilter === true;
  out.disableAlphabetNavigator = w.disableAlphabetNavigator === true;
  out.ownedGamesFirstInGamesSidebar = w.ownedGamesFirstInGamesSidebar === true;
  out.compactCollectionLikeDetail = w.compactCollectionLikeDetail === true;
  out.verticalCoverAlignment = w.verticalCoverAlignment === true;
  out.fixedFocalStepSound = w.fixedFocalStepSound === true;
  out.autoShowBackgroundOnSelection = w.autoShowBackgroundOnSelection === true;
  out.disableTitleTooltips = w.disableTitleTooltips === true;
  out.collapsibleLibrarySidebar = w.collapsibleLibrarySidebar === true;

  if (out.verticalCoverAlignment && !("autoShowBackgroundOnSelection" in w)) {
    out.autoShowBackgroundOnSelection = true;
  }

  if (out.headerTitleFilter) {
    if (!("sidebarSearchPopup" in w)) {
      out.sidebarSearchPopup = true;
    } else {
      out.sidebarSearchPopup = w.sidebarSearchPopup === true;
    }
  } else {
    out.sidebarSearchPopup = w.sidebarSearchPopup === true;
  }

  return out;
}

function findExistingSkinIdByName(skinsDir, displayName) {
  const target = typeof displayName === "string" ? displayName.trim() : "";
  if (!target || !fs.existsSync(skinsDir)) return null;
  const matches = [];
  for (const ent of fs.readdirSync(skinsDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !isUuidSkinId(ent.name)) continue;
    const meta = readJsonFile(path.join(skinsDir, ent.name, "skin.json"), null);
    const n = meta && typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : "";
    if (n === target) matches.push(ent.name);
  }
  if (matches.length === 0) return null;
  matches.sort();
  return matches[0];
}

function extractZipToDir(buffer, destDir) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rel = safeEntryName(entry.entryName);
    if (!rel) {
      throw new Error("invalid_zip_path");
    }
    const outPath = path.join(destDir, rel);
    const resolved = path.resolve(outPath);
    const resolvedBase = path.resolve(destDir);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error("invalid_zip_path");
    }
    ensureDirectoryExists(path.dirname(outPath));
    fs.writeFileSync(outPath, entry.getData());
  }
}

/**
 * @returns {{ id: string, name: string }}
 */
function installSkinFromZipBuffer(skinsDir, buffer, { displayName = "", originalName = "" } = {}) {
  ensureDirectoryExists(skinsDir);

  const lower = String(originalName || "").toLowerCase();
  const extractRoot = path.join(skinsDir, `.upload-${crypto.randomUUID()}`);
  ensureDirectoryExists(extractRoot);
  try {
    extractZipToDir(buffer, extractRoot);

    const contentRoot = findSkinContentRoot(extractRoot);
    if (!contentRoot) {
      throw new Error("missing_skin_json");
    }

    const rawMeta = readJsonFile(path.join(contentRoot, "skin.json"), {});
    const meta =
      rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? { ...rawMeta } : {};
    const metaName = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : "";
    const name =
      displayName ||
      metaName ||
      path.basename(lower, ".zip").replace(/\.mhg-skin$/, "") ||
      "Skin";

    const cssProbe = readBundleCssFromSkinDir(contentRoot);
    if (cssProbe == null || !String(cssProbe).trim()) {
      throw new Error("missing_css");
    }

    const existingId = findExistingSkinIdByName(skinsDir, name);
    if (!existingId && countUuidSkinDirs(skinsDir) >= MAX_SKINS) {
      throw new Error("too_many_skins");
    }

    const id = existingId || crypto.randomUUID();
    const finalDir = path.join(skinsDir, id);
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }

    fs.mkdirSync(finalDir, { recursive: true });
    for (const ent of fs.readdirSync(contentRoot, { withFileTypes: true })) {
      const src = path.join(contentRoot, ent.name);
      const dst = path.join(finalDir, ent.name);
      fs.cpSync(src, dst, { recursive: true });
    }

    const skinJson = {
      ...meta,
      name,
      id,
      installedAt: Date.now(),
    };
    fs.writeFileSync(path.join(finalDir, "skin.json"), JSON.stringify(skinJson, null, 2), "utf8");
    return { id, name };
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}

function registerSkinsRoutes(app, requireToken, optionalToken, metadataPath) {
  const root = () => skinsRoot(metadataPath);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ZIP_BYTES },
  });

  /** Public read: theme CSS must load before any API token is available. */
  app.get("/skins", (req, res) => {
    try {
      const dir = root();
      ensureDirectoryExists(dir);
      if (!fs.existsSync(dir)) {
        return res.json({ skins: [] });
      }
      const skins = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith(".") || !isUuidSkinId(ent.name)) continue;
        const skinDir = path.join(dir, ent.name);
        const meta = readJsonFile(path.join(skinDir, "skin.json"), null);
        const name =
          meta && typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : ent.name;
        const version =
          meta && typeof meta.version === "string" && meta.version.trim() ? meta.version.trim() : undefined;
        skins.push({
          id: ent.name,
          name,
          version,
          snapshotUrl: `/skins/${encodeURIComponent(ent.name)}/snapshot`,
          web: extractWebManifest(meta),
        });
      }
      skins.sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ skins });
    } catch (e) {
      console.error("GET /skins", e);
      return res.status(500).json({ error: "skins_list_failed" });
    }
  });

  app.get("/skins/:skinId/bundle.css", (req, res) => {
    const skinId = req.params.skinId;
    if (!isUuidSkinId(skinId)) {
      return res.status(400).type("text/css").send("/* invalid skin id */");
    }
    const skinDir = path.join(root(), skinId);
    if (!fs.existsSync(skinDir) || !fs.statSync(skinDir).isDirectory()) {
      return res.status(404).type("text/css").send("/* skin not found */");
    }
    try {
      const css = readBundleCssFromSkinDir(skinDir);
      if (css == null || !String(css).trim()) {
        return res.status(404).type("text/css").send("/* no css in skin */");
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.type("text/css").send(css);
    } catch (e) {
      console.error("GET bundle.css", e);
      return res.status(500).type("text/css").send("/* read error */");
    }
  });

  app.get("/skins/:skinId/snapshot", (req, res) => {
    const skinId = req.params.skinId;
    if (!isUuidSkinId(skinId)) {
      return res.status(400).send("invalid skin id");
    }
    const skinDir = path.join(root(), skinId);
    if (!fs.existsSync(skinDir) || !fs.statSync(skinDir).isDirectory()) {
      return res.status(404).send("skin not found");
    }
    try {
      const meta = readJsonFile(path.join(skinDir, "skin.json"), null);
      const snapshotPath = resolveSkinSnapshotPath(skinDir, meta);
      if (!snapshotPath) {
        return res.status(404).send("snapshot not found");
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.sendFile(snapshotPath);
    } catch (e) {
      console.error("GET snapshot", e);
      return res.status(500).send("snapshot read error");
    }
  });

  app.post("/skins/install-from-url", optionalToken, async (req, res) => {
    const downloadUrl =
      typeof req.body?.url === "string" && req.body.url.trim() ? req.body.url.trim() : "";
    const displayName =
      typeof req.body?.displayName === "string" && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : "";
    if (!downloadUrl) {
      return res.status(400).json({ error: "missing_url" });
    }
    if (!isAllowedSkinReleaseDownloadUrl(downloadUrl)) {
      return res.status(400).json({ error: "url_not_allowed" });
    }

    try {
      const buffer = await fetchUrlBuffer(downloadUrl, { maxBytes: MAX_ZIP_BYTES });
      const originalName = decodeURIComponent(
        new URL(downloadUrl).pathname.slice(new URL(downloadUrl).pathname.lastIndexOf("/") + 1)
      );
      const installed = installSkinFromZipBuffer(root(), buffer, {
        displayName,
        originalName,
      });
      return res.status(201).json(installed);
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "";
      if (
        msg === "invalid_zip_path" ||
        msg === "missing_skin_json" ||
        msg === "missing_css" ||
        msg === "too_many_skins" ||
        msg === "skin_zip_too_large"
      ) {
        return res.status(400).json({ error: msg });
      }
      if (msg.startsWith("HTTP ")) {
        return res.status(502).json({ error: "skin_download_failed", detail: msg });
      }
      console.error("POST /skins/install-from-url", e);
      return res.status(500).json({ error: "skin_install_failed" });
    }
  });

  app.post("/skins", optionalToken, upload.single("archive"), (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "missing_archive" });
    }
    const lower = (req.file.originalname || "").toLowerCase();
    if (!lower.endsWith(".zip") && !lower.endsWith(".mhg-skin.zip")) {
      return res.status(400).json({ error: "invalid_archive_type" });
    }
    const displayName =
      typeof req.body?.displayName === "string" && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : "";

    try {
      const installed = installSkinFromZipBuffer(root(), req.file.buffer, {
        displayName,
        originalName: req.file.originalname || "",
      });
      return res.status(201).json(installed);
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "";
      if (
        msg === "invalid_zip_path" ||
        msg === "missing_skin_json" ||
        msg === "missing_css" ||
        msg === "too_many_skins"
      ) {
        return res.status(400).json({ error: msg });
      }
      console.error("POST /skins", e);
      return res.status(500).json({ error: "skin_install_failed" });
    }
  });

  app.delete("/skins/:skinId", optionalToken, (req, res) => {
    const skinId = req.params.skinId;
    if (!isUuidSkinId(skinId)) {
      return res.status(400).json({ error: "invalid_skin_id" });
    }
    const skinDir = path.join(root(), skinId);
    try {
      if (!fs.existsSync(skinDir) || !fs.statSync(skinDir).isDirectory()) {
        return res.status(404).json({ error: "not_found" });
      }
      fs.rmSync(skinDir, { recursive: true, force: true });
      return res.status(204).end();
    } catch (e) {
      console.error("DELETE /skins", e);
      return res.status(500).json({ error: "skin_delete_failed" });
    }
  });
}

/**
 * Reads `web` flags directly from the on-disk skin.json of an installed skin.
 * Returns the default manifest (all false) when the skin is missing/invalid.
 * Used by server.js to hydrate `settings.skinWeb` when the user activates a skin.
 */
function readInstalledSkinWebFlags(metadataPath, skinId) {
  const normalizedId = typeof skinId === "string" ? skinId.trim() : "";
  if (!normalizedId || !isUuidSkinId(normalizedId)) {
    return { ...DEFAULT_SKIN_WEB_MANIFEST };
  }
  const skinDir = path.join(skinsRoot(metadataPath), normalizedId);
  const meta = readJsonFile(path.join(skinDir, "skin.json"), null);
  return extractWebManifest(meta);
}

module.exports = {
  registerSkinsRoutes,
  skinsRoot,
  readBundleCssFromSkinDir,
  isUuidSkinId,
  extractWebManifest,
  readInstalledSkinWebFlags,
  DEFAULT_SKIN_WEB_MANIFEST,
  SKIN_WEB_KEYS,
  isAllowedSkinReleaseDownloadUrl,
};
