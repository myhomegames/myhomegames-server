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

function normalizeTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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
  if (/^(setup|install|config|dosbox|uninstall)/i.test(baseNoExt)) return true;
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
 * Optional matching launcher under scripts/ for a game folder (launch only; not used for naming).
 */
function findMatchingLaunchScript(scriptsDir, folderName) {
  if (!scriptsDir || !fs.existsSync(scriptsDir)) return null;
  const key = normalizeTitleKey(folderName);
  if (!key) return null;
  let best = null;
  for (const ent of listDirents(scriptsDir)) {
    if (!ent.isFile() || !isLaunchScriptBasename(ent.name)) continue;
    const scriptKey = normalizeTitleKey(guessTitleFromBasename(ent.name));
    if (!scriptKey) continue;
    if (scriptKey === key || scriptKey.includes(key) || key.includes(scriptKey)) {
      const full = path.join(scriptsDir, ent.name);
      if (scriptKey === key) return full;
      best = best || full;
    }
  }
  return best;
}

/**
 * Discover real .sh/.bat launchers for a game path.
 * Never invents open/xdg-open wrappers — only returns existing scripts on disk.
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

  const walkGameDir = (dir, depth) => {
    for (const ent of listDirents(dir)) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
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

  // Collection layout: sibling/ancestor scripts/<matching-name>.sh|bat
  const folderName = path.basename(gamePath);
  let dir = path.dirname(gamePath);
  for (let i = 0; i < 4; i += 1) {
    const match = findMatchingLaunchScript(path.join(dir, "scripts"), folderName);
    if (match) add(match);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return found;
}

function buildFolderCandidate(folderPath, options = {}) {
  const name = path.basename(folderPath);
  const title = guessTitleFromBasename(name);
  const tree = sampleDirectoryTree(folderPath);
  const launch =
    options.launchPath ||
    findMatchingLaunchScript(options.scriptsDir, name) ||
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

/**
 * Pick an IGDB platform id for a launch script filename suffix.
 * Prefers a platform matching the AI hint; otherwise the first entry with an id.
 * @returns {string} platform id or ""
 */
function resolveExecutablePlatformId(platforms, platformHint = null) {
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
      const name = String(p.name || "").trim();
      if (id || name) normalized.push({ id, name });
    }
  }
  if (normalized.length === 0) return "";
  const hint = String(platformHint || "")
    .trim()
    .toLowerCase();
  if (hint) {
    const hit = normalized.find((p) => {
      const name = p.name.toLowerCase();
      if (!name) return false;
      return name === hint || name.includes(hint) || hint.includes(name);
    });
    if (hit?.id) return hit.id;
  }
  const withId = normalized.find((p) => p.id);
  return withId?.id || "";
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
 * Write a launch script that opens/runs the local game path.
 * @returns {string} script file path
 */
function writeLocalPathLaunchScript(metadataPath, gameId, localPath, options = {}) {
  const scriptsDir = path.join(metadataPath, "content", "games", String(gameId), "scripts");
  ensureDirectoryExists(scriptsDir);

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
  findLaunchScriptsForGame,
  resolveExecutablePlatformId,
  resolveUserFolderPath,
};
