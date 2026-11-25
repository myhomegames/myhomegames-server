"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { ensureDirectoryExists } = require("./fileUtils");

/** Extensions treated as installable / playable game payloads. */
const GAME_FILE_EXTENSIONS = new Set([
  ".nes",
  ".fds",
  ".unf",
  ".smc",
  ".sfc",
  ".fig",
  ".gb",
  ".gbc",
  ".gba",
  ".nds",
  ".3ds",
  ".n64",
  ".z64",
  ".v64",
  ".md",
  ".gen",
  ".smd",
  ".sms",
  ".gg",
  ".pce",
  ".cue",
  ".chd",
  ".iso",
  ".rvz",
  ".wbfs",
  ".gcm",
  ".ciso",
  ".nca",
  ".xci",
  ".nsp",
  ".cia",
  ".a26",
  ".a78",
  ".lnx",
  ".ngp",
  ".ngc",
  ".ws",
  ".wsc",
  ".col",
  ".int",
  ".zip",
  ".7z",
  ".rar",
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".sh",
  ".msi",
  ".dmg",
  ".pkg",
  ".wad",
  ".pk3",
  ".pk4",
  ".doom",
  ".dmod",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "__macosx",
  "system volume information",
  "$recycle.bin",
  "windows",
  "program files",
  "program files (x86)",
  "library",
  "applications",
  "shared",
  "soundfonts",
  "cfg",
  "drivers",
  "driver",
  "save",
  "saves",
  "savedata",
  "docs",
  "doc",
  "manual",
  "manuals",
  "patch",
  "patches",
]);

/** Utility / non-game basenames common in DOS and PC installs. */
const JUNK_BASENAMES = new Set([
  "setup",
  "install",
  "installer",
  "uninstall",
  "dosbox",
  "config",
  "configure",
  "setsound",
  "setmusic",
  "setmain",
  "sound",
  "midpak",
  "uvconfig",
  "cwsdpmi",
  "choice",
  "detect",
  "commit",
  "register",
  "readme",
  "order",
  "file_id",
  "pkunzip",
  "pkzip",
  "unzip",
  "launch",
  "qlaunch",
  "editor",
  "mapedit",
  "setup95",
  "install95",
  "autorun",
  "bootdisk",
  "demos",
  "emu set",
  "emuset",
  "getdigit",
  "common",
  "uptodate",
  "pcxview",
  "genmap",
  "dflt",
  "play",
  "bp",
  "bridge",
  "swhelp",
  "setmuse",
  "megaem",
  "corlinst",
]);

const MAX_SCAN_DEPTH = 8;
const MAX_CANDIDATES = 800;

/**
 * Human title from a file or folder basename (strip tags / separators).
 */
function guessTitleFromBasename(name) {
  let title = String(name || "");
  title = title.replace(/\.[^.]+$/, "");
  title = title.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
  title = title.replace(/[_]+/g, " ").replace(/\s*-\s*/g, " ");
  title = title.replace(/\bv\d+(?:\.\d+)*\b/gi, " ");
  title = title.replace(/\s+/g, " ").trim();
  return title;
}

/**
 * Standalone Roman numerals → Arabic for title dedupe keys.
 * Longest match first. Omits lone "i" / "x" (too many false positives:
 * "I Am Alive", "Mega Man X", "X-Men").
 */
const ROMAN_NUMERAL_TOKENS = [
  ["xviii", "18"],
  ["xvii", "17"],
  ["xvi", "16"],
  ["xv", "15"],
  ["xiv", "14"],
  ["xiii", "13"],
  ["xii", "12"],
  ["xi", "11"],
  ["xix", "19"],
  ["xx", "20"],
  ["viii", "8"],
  ["vii", "7"],
  ["iii", "3"],
  ["ii", "2"],
  ["iv", "4"],
  ["ix", "9"],
  ["vi", "6"],
  ["v", "5"],
];

function normalizeTitleKey(title) {
  let s = String(title || "")
    .toLowerCase()
    // Keep token boundaries so "ii" matches as a word, not inside other text.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [roman, arabic] of ROMAN_NUMERAL_TOKENS) {
    s = s.replace(new RegExp(`\\b${roman}\\b`, "g"), arabic);
  }
  return s.replace(/[^a-z0-9]+/g, "");
}

function shouldSkipDir(dirName) {
  const lower = String(dirName || "").toLowerCase();
  if (!lower || lower.startsWith(".")) return true;
  return SKIP_DIR_NAMES.has(lower);
}

function isMacAppBundle(fullPath, dirent) {
  return dirent.isDirectory() && /\.app$/i.test(dirent.name);
}

function isGameFile(fullPath, dirent) {
  if (dirent.isFile()) {
    return GAME_FILE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase());
  }
  return isMacAppBundle(fullPath, dirent);
}

/**
 * True for setup/install/dosbox/B1-style utilities that must never become library titles.
 */
function isJunkGameBasename(name) {
  const raw = String(name || "");
  const baseNoExt = raw.replace(/\.[^.]+$/, "");
  const title = guessTitleFromBasename(raw);
  const compact = normalizeTitleKey(title);
  if (!compact) return true;
  if (compact.length <= 2) return true;
  if (/^b\d+[a-z]*$/i.test(compact)) return true;
  if (JUNK_BASENAMES.has(title.toLowerCase()) || JUNK_BASENAMES.has(compact)) return true;
  if (/^(setup|install|instal|config|dosbox|uninstall)/i.test(baseNoExt)) return true;
  if (/instal/i.test(baseNoExt) && /hd|setup|soft/i.test(baseNoExt)) return true;
  if (/^dosbox/i.test(baseNoExt)) return true;
  return false;
}

/**
 * Prefer disc masters (.cue/.iso/...) over raw track files (.bin) in the same folder.
 */
function filterRedundantBinFiles(candidates) {
  const dirsWithCueOrIso = new Set();
  for (const c of candidates) {
    const ext = path.extname(c.filePath).toLowerCase();
    if (ext === ".cue" || ext === ".iso" || ext === ".chd" || ext === ".rvz") {
      dirsWithCueOrIso.add(path.dirname(c.filePath));
    }
  }
  return candidates.filter((c) => {
    if (path.extname(c.filePath).toLowerCase() !== ".bin") return true;
    return !dirsWithCueOrIso.has(path.dirname(c.filePath));
  });
}

const COLLECTION_DIR_NAMES = new Set([
  "games",
  "roms",
  "rom",
  "mame",
  "arcade",
  "nes",
  "snes",
  "n64",
  "gba",
  "gb",
  "gbc",
  "nds",
  "3ds",
  "psx",
  "ps1",
  "ps2",
  "psp",
  "saturn",
  "dreamcast",
  "megadrive",
  "genesis",
  "mastersystem",
  "pcengine",
  "tg16",
  "amiga",
  "dos",
  "scummvm",
  "iso",
  "isos",
  "cd",
  "cds",
]);

function pushCandidate(found, candidate, maxCandidates) {
  if (found.length >= maxCandidates) return false;
  if (!candidate?.title || candidate.title.length < 2) return true;
  // Folder units keep short/system names (MAME shortnames); only filter junk file basenames for file kinds.
  if (candidate.kind === "file" && isJunkGameBasename(candidate.sourceName || candidate.title)) {
    return true;
  }
  found.push(candidate);
  return found.length < maxCandidates;
}

/**
 * Compact relative tree listing for AI identification (not the launch executable name).
 */
function sampleDirectoryTree(dir, options = {}) {
  // Keep trees compact: AI requests must stay under free-tier TPM / context caps (e.g. Groq 8k).
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 16;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 2;
  const rootName = path.basename(dir);
  const lines = [rootName + "/"];

  function walk(current, depth, relBase) {
    if (lines.length >= maxEntries || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (lines.length >= maxEntries) break;
      if (ent.name.startsWith(".")) continue;
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        lines.push(`${rootName}/${rel}/`);
        walk(path.join(current, ent.name), depth + 1, rel);
      } else if (ent.isFile()) {
        lines.push(`${rootName}/${rel}`);
      }
    }
  }

  walk(dir, 1, "");
  return lines.slice(0, maxEntries);
}

function listDirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function directoryHasGamePayload(dir) {
  for (const ent of listDirents(dir)) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isFile() && isGameFile(full, ent) && !isJunkGameBasename(ent.name)) return true;
    if (ent.isFile() && isGameFile(full, ent)) return true;
    if (isMacAppBundle(full, ent)) return true;
  }
  return false;
}

function countChildGameFolders(dir) {
  let count = 0;
  for (const ent of listDirents(dir)) {
    if (!ent.isDirectory() || shouldSkipDir(ent.name)) continue;
    if (directoryHasGamePayload(path.join(dir, ent.name))) count += 1;
  }
  return count;
}

const LAUNCH_SCRIPT_EXTENSIONS = new Set([".sh", ".bat"]);

function isLaunchScriptBasename(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (!LAUNCH_SCRIPT_EXTENSIONS.has(ext)) return false;
  return !isJunkGameBasename(name);
}

/**
 * True when a launch script's body references the game folder path
 * (e.g. bobmorane1.sh → …/Bob-Morane-Chevalerie-1_DOS_FR/dosbox.conf).
 */
function scriptReferencesGamePath(scriptPath, gameAbsPath) {
  const gameAbs = path.resolve(String(gameAbsPath || ""));
  if (!gameAbs) return false;
  let text;
  try {
    const st = fs.statSync(scriptPath);
    // Keep reads small — DOSBox one-liners are tiny.
    if (!st.isFile() || st.size <= 0 || st.size > 256 * 1024) return false;
    text = fs.readFileSync(scriptPath, "utf8");
  } catch {
    return false;
  }
  if (!text) return false;

  const gamePosix = gameAbs.replace(/\\/g, "/");
  const base = path.basename(gameAbs);
  const variants = new Set([
    gameAbs,
    gamePosix,
    gameAbs.replace(/ /g, "\\ "),
    gamePosix.replace(/ /g, "\\ "),
  ]);
  // Quoted path fragments with spaces.
  if (base.includes(" ")) {
    variants.add(`"${gamePosix}"`);
    variants.add(`'${gamePosix}'`);
    variants.add(gamePosix.replace(/ /g, "\\ "));
  }
  for (const v of variants) {
    if (v && text.includes(v)) return true;
  }
  return false;
}

/**
 * Optional matching launcher under scripts/ for a game folder (launch only; not used for naming).
 * Matches by normalized basename, then by script content referencing the game folder path.
 */
function findMatchingLaunchScript(scriptsDir, folderName, gameAbsPath = null) {
  const matches = findMatchingLaunchScripts(scriptsDir, folderName, gameAbsPath);
  return matches[0] || null;
}

/**
 * All matching launchers under a collection scripts/ directory.
 * @returns {string[]} absolute script paths (name matches first, then content matches)
 */
function findMatchingLaunchScripts(scriptsDir, folderName, gameAbsPath = null) {
  if (!scriptsDir || !fs.existsSync(scriptsDir)) return [];
  const key = normalizeTitleKey(folderName);
  const byNameExact = [];
  const byNameFuzzy = [];
  const byContent = [];
  for (const ent of listDirents(scriptsDir)) {
    if (!ent.isFile() || !isLaunchScriptBasename(ent.name)) continue;
    const full = path.join(scriptsDir, ent.name);
    const scriptKey = normalizeTitleKey(guessTitleFromBasename(ent.name));
    let nameHit = false;
    if (key && scriptKey) {
      if (scriptKey === key) {
        byNameExact.push(full);
        nameHit = true;
      } else if (scriptKey.includes(key) || key.includes(scriptKey)) {
        byNameFuzzy.push(full);
        nameHit = true;
      }
    }
    if (
      !nameHit &&
      gameAbsPath &&
      scriptReferencesGamePath(full, gameAbsPath)
    ) {
      byContent.push(full);
    }
  }
  return [...byNameExact, ...byNameFuzzy, ...byContent];
}

/**
 * Discover real .sh/.bat launchers for a game path.
 * Never invents open/xdg-open wrappers — only returns existing scripts on disk.
 * Collection `scripts/` may match by folder name or by referencing the game path in the script body.
 * @returns {{ path: string, label: string }[]}
 */
function findLaunchScriptsForGame(gamePath) {
  const found = [];
  const seen = new Set();

  const add = (fullPath) => {
    const resolved = path.resolve(String(fullPath || ""));
    if (!resolved || seen.has(resolved)) return;
    let st;
    try {
      st = fs.statSync(resolved);
    } catch {
      return;
    }
    if (!st.isFile()) return;
    const base = path.basename(resolved);
    if (!isLaunchScriptBasename(base)) return;
    seen.add(resolved);
    found.push({
      path: resolved,
      label: path.basename(base, path.extname(base)) || "script",
    });
  };

  let st;
  try {
    st = fs.statSync(gamePath);
  } catch {
    return found;
  }

  if (st.isFile()) {
    add(gamePath);
    return found;
  }

  if (!st.isDirectory()) return found;

  const gameAbs = path.resolve(gamePath);

  // Collection layout first: sibling/ancestor scripts/ (name or content match).
  // Prefer these over in-folder SETUP/HDINSTAL leftovers.
  const folderName = path.basename(gamePath);
  let dir = path.dirname(gamePath);
  for (let i = 0; i < 4; i += 1) {
    for (const match of findMatchingLaunchScripts(
      path.join(dir, "scripts"),
      folderName,
      gameAbs
    )) {
      add(match);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const walkGameDir = (dirWalk, depth) => {
    for (const ent of listDirents(dirWalk)) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dirWalk, ent.name);
      if (ent.isFile()) {
        add(full);
        continue;
      }
      if (!ent.isDirectory() || shouldSkipDir(ent.name) || depth >= 2) continue;
      const lower = ent.name.toLowerCase();
      // Prefer scripts/ and one level of nested game content.
      if (lower === "scripts" || depth === 0) walkGameDir(full, depth + 1);
    }
  };
  walkGameDir(gamePath, 0);

  return found;
}

function buildFolderCandidate(folderPath, options = {}) {
  const name = path.basename(folderPath);
  const title = guessTitleFromBasename(name);
  const tree = sampleDirectoryTree(folderPath);
  const launch =
    options.launchPath ||
    findMatchingLaunchScript(options.scriptsDir, name, folderPath) ||
    folderPath;
  return {
    filePath: launch,
    folderPath,
    title,
    sourceName: name,
    kind: "game-folder",
    tree,
  };
}

function buildRomFileCandidate(filePath, collectionRoot) {
  const name = path.basename(filePath);
  const parent = path.dirname(filePath);
  const relParent = path.relative(collectionRoot, parent);
  const relFile = path.relative(collectionRoot, filePath);
  const tree = [
    ...(relParent && relParent !== "." ? [`${relParent}/`] : []),
    relFile || name,
  ];
  // Include a few sibling names so AI can see set context (MAME folder, etc.).
  const siblings = listDirents(parent)
    .filter((e) => e.isFile() && isGameFile(path.join(parent, e.name), e))
    .slice(0, 12)
    .map((e) => (relParent && relParent !== "." ? `${relParent}/${e.name}` : e.name));
  for (const s of siblings) {
    if (!tree.includes(s)) tree.push(s);
  }
  return {
    filePath,
    folderPath: parent,
    title: guessTitleFromBasename(name),
    sourceName: name,
    kind: "rom-file",
    tree,
  };
}

/**
 * Prefer one candidate per game subdirectory (games/roms/mame/...), with a folder tree for AI.
 * @returns {Array|null}
 */
function scanCollectionByGameFolders(root, maxCandidates) {
  const scriptsDir = path.join(root, "scripts");
  const hasScripts = fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory();
  const found = [];

  const containerDirs = [];
  for (const ent of listDirents(root)) {
    if (!ent.isDirectory() || shouldSkipDir(ent.name)) continue;
    const lower = ent.name.toLowerCase();
    if (COLLECTION_DIR_NAMES.has(lower) || lower === "games") {
      containerDirs.push(path.join(root, ent.name));
    }
  }

  // Also treat root as a container when many child folders look like individual games.
  if (containerDirs.length === 0 && countChildGameFolders(root) >= 3) {
    containerDirs.push(root);
  }

  if (containerDirs.length === 0) return null;

  for (const container of containerDirs) {
    const containerBase = path.basename(container).toLowerCase();
    // Skip scripts/shared-style containers even if named oddly.
    if (containerBase === "scripts" || containerBase === "shared") continue;

    for (const ent of listDirents(container)) {
      if (found.length >= maxCandidates) break;
      const full = path.join(container, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        // Nested system folder (roms/mame, roms/nes, …): one unit per game folder or per ROM file.
        if (COLLECTION_DIR_NAMES.has(ent.name.toLowerCase())) {
          let emittedNested = false;
          for (const child of listDirents(full)) {
            if (!child.isDirectory() || shouldSkipDir(child.name)) continue;
            const childPath = path.join(full, child.name);
            if (isJunkGameBasename(child.name)) continue;
            if (
              directoryHasGamePayload(childPath) ||
              listDirents(childPath).some((e) => e.isDirectory() || e.isFile())
            ) {
              pushCandidate(
                found,
                buildFolderCandidate(childPath, {
                  scriptsDir: hasScripts ? scriptsDir : null,
                }),
                maxCandidates
              );
              emittedNested = true;
            }
          }
          // Classic flat MAME/ROM pack: many archives directly in the system folder.
          for (const child of listDirents(full)) {
            if (!child.isFile()) continue;
            const childPath = path.join(full, child.name);
            if (!isGameFile(childPath, child) || isJunkGameBasename(child.name)) continue;
            pushCandidate(found, buildRomFileCandidate(childPath, root), maxCandidates);
            emittedNested = true;
          }
          if (emittedNested) continue;
        }

        if (isJunkGameBasename(ent.name)) continue;
        if (directoryHasGamePayload(full) || listDirents(full).length > 0) {
          pushCandidate(
            found,
            buildFolderCandidate(full, { scriptsDir: hasScripts ? scriptsDir : null }),
            maxCandidates
          );
        }
        continue;
      }

      if (ent.isFile() && isGameFile(full, ent) && !isJunkGameBasename(ent.name)) {
        pushCandidate(found, buildRomFileCandidate(full, root), maxCandidates);
      }
    }
  }

  return found.length > 0 ? found : null;
}

/**
 * Fallback: group loose game files by parent folder (one unit per folder), else individual ROMs.
 */
function scanGroupedOrLooseFiles(root, maxDepth, maxCandidates) {
  const found = [];
  const folderUnits = new Map();

  function walk(dir, depth) {
    if (found.length >= maxCandidates) return;
    if (depth > maxDepth) return;
    const entries = listDirents(dir);
    const fileHits = [];
    const subdirs = [];

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (isMacAppBundle(full, ent)) {
          pushCandidate(
            found,
            {
              ...buildFolderCandidate(full),
              kind: "app",
              tree: [path.basename(full)],
            },
            maxCandidates
          );
          continue;
        }
        if (shouldSkipDir(ent.name)) continue;
        subdirs.push(full);
        continue;
      }
      if (ent.isFile() && isGameFile(full, ent) && !isJunkGameBasename(ent.name)) {
        fileHits.push(full);
      }
    }

    // Many child game folders → treat each child as a unit instead of exploding files here.
    const gameishChildren = subdirs.filter((d) => directoryHasGamePayload(d));
    if (gameishChildren.length >= 3 && depth <= 2) {
      for (const child of gameishChildren) {
        pushCandidate(found, buildFolderCandidate(child), maxCandidates);
      }
      return;
    }

    if (fileHits.length >= 2) {
      // One candidate for the parent folder with a tree of its game files.
      if (!folderUnits.has(dir)) {
        folderUnits.set(dir, true);
        pushCandidate(found, buildFolderCandidate(dir), maxCandidates);
      }
    } else if (fileHits.length === 1) {
      pushCandidate(found, buildRomFileCandidate(fileHits[0], root), maxCandidates);
    }

    for (const sub of subdirs) {
      walk(sub, depth + 1);
    }
  }

  walk(root, 0);
  return filterRedundantBinFiles(found).filter((c) => c.title.length >= 1);
}

/**
 * Find game units under `folderPath`. Prefers subdirectory trees (DOS games/, MAME roms/, …)
 * and attaches a folder tree snapshot for AI official-title identification.
 * @returns {{ filePath: string, title: string, sourceName: string, kind?: string, tree?: string[], folderPath?: string }[]}
 */
function scanFolderForGameCandidates(folderPath, options = {}) {
  const root = path.resolve(String(folderPath || "").trim());
  if (!root || !fs.existsSync(root)) {
    const err = new Error("Folder does not exist");
    err.code = "ENOENT";
    throw err;
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    const err = new Error("Path is not a directory");
    err.code = "ENOTDIR";
    throw err;
  }

  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : MAX_SCAN_DEPTH;
  const maxCandidates = Number.isFinite(options.maxCandidates)
    ? options.maxCandidates
    : MAX_CANDIDATES;

  if (options.forceRecursive !== true) {
    const collection = scanCollectionByGameFolders(root, maxCandidates);
    if (collection) return collection;
  }

  return scanGroupedOrLooseFiles(root, maxDepth, maxCandidates);
}

function gameHasPlatformHint(game, platformHint) {
  const hint = String(platformHint || "")
    .trim()
    .toLowerCase();
  if (!hint) return false;
  const platforms = Array.isArray(game?.platforms) ? game.platforms : [];
  return platforms.some((p) => {
    const name = String(typeof p === "string" ? p : p?.name || "")
      .trim()
      .toLowerCase();
    if (!name) return false;
    return name === hint || name.includes(hint) || hint.includes(name);
  });
}

function normalizePlatformEntries(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  const normalized = [];
  for (const p of list) {
    if (p == null) continue;
    if (typeof p === "number" || (typeof p === "string" && /^\d+$/.test(String(p).trim()))) {
      normalized.push({ id: String(p).trim(), name: "" });
      continue;
    }
    if (typeof p === "string") {
      const name = p.trim();
      if (name) normalized.push({ id: "", name });
      continue;
    }
    if (typeof p === "object") {
      const id =
        p.id != null && String(p.id).trim() !== "" ? String(p.id).trim() : "";
      const name = String(p.name || p.title || "").trim();
      if (id || name) normalized.push({ id, name });
    }
  }
  return normalized;
}

function platformNameMatchesHint(name, hint) {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  const h = String(hint || "")
    .trim()
    .toLowerCase();
  if (!n || !h) return false;
  return n === h || n.includes(h) || h.includes(n);
}

/**
 * Platform id for Manage Installation filename suffix.
 * Must be the local library platform tag id (not the raw IGDB platform id).
 *
 * @param {Array} catalogPlatforms IGDB platforms (`{id,name}` / names) and/or local numeric ids
 * @param {string|null} platformHint AI platform hint
 * @param {{ localTags?: {id:number|string, title?:string, name?:string}[], localPlatformIds?: Array }} [options]
 * @returns {string} local platform id or ""
 */
function resolveExecutablePlatformId(catalogPlatforms, platformHint = null, options = {}) {
  const localTags = Array.isArray(options.localTags) ? options.localTags : [];
  const localPlatformIds = Array.isArray(options.localPlatformIds)
    ? options.localPlatformIds
    : [];
  const tagsById = new Map(
    localTags.map((t) => [String(t.id), t]).filter(([id]) => id && id !== "undefined")
  );
  const tagsByTitle = new Map();
  for (const t of localTags) {
    const title = String(t.title || t.name || "")
      .trim()
      .toLowerCase();
    if (title) tagsByTitle.set(title, t);
  }

  const findLocalIdByName = (name) => {
    const lower = String(name || "")
      .trim()
      .toLowerCase();
    if (!lower) return "";
    const exact = tagsByTitle.get(lower);
    if (exact) return String(exact.id);
    for (const [title, tag] of tagsByTitle) {
      if (platformNameMatchesHint(title, lower)) return String(tag.id);
    }
    return "";
  };

  const candidates = [];
  for (const entry of normalizePlatformEntries(catalogPlatforms)) {
    if (entry.name) {
      const localId = findLocalIdByName(entry.name);
      if (localId) {
        candidates.push({
          id: localId,
          name: entry.name,
        });
        continue;
      }
    }
  }
  for (const raw of localPlatformIds) {
    const id =
      raw != null && typeof raw === "object"
        ? raw.id != null
          ? String(raw.id)
          : ""
        : String(raw).trim();
    if (!id) continue;
    const tag = tagsById.get(id);
    candidates.push({
      id,
      name: String(tag?.title || tag?.name || "").trim(),
    });
  }

  if (candidates.length === 0) {
    // Legacy fallback: numeric-only platform lists already use local tag ids.
    const numericOnly = normalizePlatformEntries(catalogPlatforms).filter((p) => p.id && !p.name);
    if (numericOnly.length > 0 && localTags.length === 0) return numericOnly[0].id;
    return "";
  }

  const hint = String(platformHint || "").trim();
  if (hint) {
    const hit = candidates.find((c) => platformNameMatchesHint(c.name, hint));
    if (hit) return hit.id;
  }
  return candidates[0].id;
}

/**
 * Pick the best IGDB search hit for a guessed title (exact name preferred).
 * Optional AI hints: platform prefers matching platforms[]; year prefers release year.
 */
function pickBestIgdbMatch(title, games, options = {}) {
  const list = Array.isArray(games) ? games : [];
  if (list.length === 0) return null;
  const needle = String(title || "")
    .trim()
    .toLowerCase();
  const needleKey = normalizeTitleKey(title);
  const platformHint = options.platform || null;
  const yearHint = Number.isFinite(Number(options.year)) ? Number(options.year) : null;

  function score(game) {
    let s = 0;
    const name = String(game?.name || "")
      .trim()
      .toLowerCase();
    const key = normalizeTitleKey(game?.name);
    if (name === needle) s += 100;
    else if (key && key === needleKey) s += 80;
    else if (key && needleKey && (key.includes(needleKey) || needleKey.includes(key))) s += 40;
    if (platformHint && gameHasPlatformHint(game, platformHint)) s += 25;
    if (yearHint != null) {
      const ts = Number(game?.releaseDateFull?.timestamp || game?.releaseDate || game?.first_release_date);
      if (Number.isFinite(ts) && ts > 0) {
        const y = new Date(ts * (ts < 1e12 ? 1000 : 1)).getUTCFullYear();
        if (y === yearHint) s += 15;
        else if (Math.abs(y - yearHint) <= 1) s += 5;
      }
    }
    return s;
  }

  const ranked = [...list].sort((a, b) => score(b) - score(a));
  return ranked[0] || null;
}

/**
 * Require a sufficiently close catalog hit so junk titles do not import random IGDB games.
 */
function isAcceptableIgdbMatch(title, match) {
  if (!match?.name) return false;
  const a = normalizeTitleKey(title);
  const b = normalizeTitleKey(match.name);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Allow short common prefix for abbreviations expanded by AI (e.g. fallout ↔ fallout)
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 5) {
    let shared = 0;
    while (shared < minLen && a[shared] === b[shared]) shared += 1;
    if (shared / Math.max(a.length, b.length) >= 0.6) return true;
  }
  return false;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * True when a game scripts/ wrapper body already targets this local path
 * (posix, escaped spaces, or Windows JSON-quoted form).
 */
function scriptBodyTargetsLocalPath(body, localPath) {
  const target = path.resolve(String(localPath || ""));
  if (!target || !body) return false;
  const posix = target.replace(/\\/g, "/");
  const variants = [
    target,
    posix,
    shellQuote(target),
    shellQuote(posix),
    JSON.stringify(String(target)),
    JSON.stringify(posix),
    target.replace(/ /g, "\\ "),
    posix.replace(/ /g, "\\ "),
  ];
  return variants.some((v) => v && body.includes(v));
}

/**
 * Existing wrapper under content/games/<id>/scripts that already launches localPath.
 * @returns {string|null} absolute script path
 */
function findExistingLaunchScriptForLocalPath(metadataPath, gameId, localPath) {
  const scriptsDir = path.join(metadataPath, "content", "games", String(gameId), "scripts");
  if (!fs.existsSync(scriptsDir)) return null;
  let files;
  try {
    files = fs.readdirSync(scriptsDir);
  } catch {
    return null;
  }
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".sh" && ext !== ".bat" && ext !== ".cmd") continue;
    const full = path.join(scriptsDir, file);
    let body;
    try {
      const st = fs.statSync(full);
      if (!st.isFile() || st.size <= 0 || st.size > 256 * 1024) continue;
      body = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (scriptBodyTargetsLocalPath(body, localPath)) return full;
  }
  return null;
}

/**
 * Write a launch script that opens/runs the local game path.
 * Skips creating a new file when one already targets the same localPath
 * (folder-import exists/re-attach must not duplicate executables).
 * @returns {string} script file path
 */
function writeLocalPathLaunchScript(metadataPath, gameId, localPath, options = {}) {
  const scriptsDir = path.join(metadataPath, "content", "games", String(gameId), "scripts");
  ensureDirectoryExists(scriptsDir);

  const existing = findExistingLaunchScriptForLocalPath(metadataPath, gameId, localPath);
  if (existing) return existing;

  const label = String(options.label || "folderimport")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  const platformId =
    options.platformId != null && String(options.platformId).trim()
      ? String(options.platformId).trim()
      : "";

  let nextNum = 1;
  for (const file of fs.readdirSync(scriptsDir)) {
    const m = /^(\d+)-/.exec(file);
    if (m) nextNum = Math.max(nextNum, Number(m[1]) + 1);
  }
  const pad = String(nextNum).padStart(2, "0");
  const base = `${pad}-${label}${platformId ? `-${platformId}` : ""}`;

  const isWin = process.platform === "win32";
  const scriptName = isWin ? `${base}.bat` : `${base}.sh`;
  const scriptPath = path.join(scriptsDir, scriptName);
  const quoted = shellQuote(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const runDirect = [".sh", ".bat", ".cmd"].includes(ext) || options.kind === "script";

  let body;
  if (isWin) {
    if (runDirect) {
      body = `@echo off\r\ncall ${JSON.stringify(String(localPath))}\r\n`;
    } else {
      body = `@echo off\r\nstart "" ${JSON.stringify(String(localPath))}\r\n`;
    }
  } else if (runDirect) {
    body = `#!/bin/bash\nexec ${quoted} "$@"\n`;
  } else if (process.platform === "darwin") {
    body = `#!/bin/bash\nopen ${quoted}\n`;
  } else {
    body = `#!/bin/bash\nxdg-open ${quoted} >/dev/null 2>&1 || open ${quoted}\n`;
  }

  fs.writeFileSync(scriptPath, body, { encoding: "utf8", mode: 0o755 });
  if (!isWin) {
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch {
      // ignore
    }
  }
  return scriptPath;
}

/**
 * Normalize a user-supplied folder path (expand ~).
 */
function resolveUserFolderPath(folderPath) {
  let raw = String(folderPath || "").trim();
  if (!raw) return "";
  if (raw.startsWith("~/") || raw === "~") {
    raw = path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

module.exports = {
  GAME_FILE_EXTENSIONS,
  JUNK_BASENAMES,
  guessTitleFromBasename,
  normalizeTitleKey,
  isJunkGameBasename,
  sampleDirectoryTree,
  scanFolderForGameCandidates,
  pickBestIgdbMatch,
  isAcceptableIgdbMatch,
  writeLocalPathLaunchScript,
  findExistingLaunchScriptForLocalPath,
  scriptBodyTargetsLocalPath,
  findLaunchScriptsForGame,
  findMatchingLaunchScript,
  scriptReferencesGamePath,
  resolveExecutablePlatformId,
  resolveUserFolderPath,
};
