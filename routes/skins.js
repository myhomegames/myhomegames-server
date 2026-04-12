const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { ensureDirectoryExists, readJsonFile } = require("../utils/fileUtils");

const MAX_SKINS = 24;
const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function skinsRoot(metadataPath) {
  return path.join(metadataPath, "skins");
}

function isUuidSkinId(id) {
  return typeof id === "string" && UUID_RE.test(id);
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

function registerSkinsRoutes(app, requireToken, optionalToken, metadataPath) {
  const root = () => skinsRoot(metadataPath);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ZIP_BYTES },
  });

  app.get("/skins", optionalToken, (req, res) => {
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
        skins.push({ id: ent.name, name });
      }
      skins.sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ skins });
    } catch (e) {
      console.error("GET /skins", e);
      return res.status(500).json({ error: "skins_list_failed" });
    }
  });

  app.get("/skins/:skinId/bundle.css", optionalToken, (req, res) => {
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

  app.post("/skins", requireToken, upload.single("archive"), (req, res) => {
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

    const dir = root();
    try {
      ensureDirectoryExists(dir);
      if (countUuidSkinDirs(dir) >= MAX_SKINS) {
        return res.status(400).json({ error: "too_many_skins" });
      }

      const extractRoot = path.join(dir, `.upload-${crypto.randomUUID()}`);
      ensureDirectoryExists(extractRoot);
      try {
        extractZipToDir(req.file.buffer, extractRoot);
      } catch (e) {
        fs.rmSync(extractRoot, { recursive: true, force: true });
        if (e.message === "invalid_zip_path") {
          return res.status(400).json({ error: "invalid_zip_path" });
        }
        throw e;
      }

      const contentRoot = findSkinContentRoot(extractRoot);
      if (!contentRoot) {
        fs.rmSync(extractRoot, { recursive: true, force: true });
        return res.status(400).json({ error: "missing_skin_json" });
      }

      const rawMeta = readJsonFile(path.join(contentRoot, "skin.json"), {});
      const meta =
        rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? { ...rawMeta } : {};
      const metaName = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : "";
      const name = displayName || metaName || path.basename(lower, ".zip").replace(/\.mhg-skin$/, "") || "Skin";

      const cssProbe = readBundleCssFromSkinDir(contentRoot);
      if (cssProbe == null || !String(cssProbe).trim()) {
        fs.rmSync(extractRoot, { recursive: true, force: true });
        return res.status(400).json({ error: "missing_css" });
      }

      const id = crypto.randomUUID();
      const finalDir = path.join(dir, id);
      if (fs.existsSync(finalDir)) {
        fs.rmSync(extractRoot, { recursive: true, force: true });
        return res.status(500).json({ error: "id_collision" });
      }

      fs.mkdirSync(finalDir, { recursive: true });
      for (const ent of fs.readdirSync(contentRoot, { withFileTypes: true })) {
        const src = path.join(contentRoot, ent.name);
        const dst = path.join(finalDir, ent.name);
        fs.cpSync(src, dst, { recursive: true });
      }
      fs.rmSync(extractRoot, { recursive: true, force: true });

      const skinJsonPath = path.join(finalDir, "skin.json");
      const skinJson = {
        ...meta,
        name,
        id,
        installedAt: Date.now(),
      };
      fs.writeFileSync(skinJsonPath, JSON.stringify(skinJson, null, 2), "utf8");

      return res.status(201).json({ id, name });
    } catch (e) {
      console.error("POST /skins", e);
      return res.status(500).json({ error: "skin_install_failed" });
    }
  });

  app.delete("/skins/:skinId", requireToken, (req, res) => {
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

module.exports = {
  registerSkinsRoutes,
  skinsRoot,
  readBundleCssFromSkinDir,
  isUuidSkinId,
};
