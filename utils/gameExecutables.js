/**
 * Read launch scripts from a game's scripts/ directory on disk.
 * Shared so library list and collection-like game lists stay in sync after script changes.
 */

const fs = require("fs");
const path = require("path");

function getGameScriptsDir(metadataPath, gameId) {
  return path.join(metadataPath, "content", "games", String(gameId), "scripts");
}

const NUMBER_PREFIX_RE = /^(\d+)-(.+)$/;

function parseNumberPrefix(basenameNoExt) {
  const m = String(basenameNoExt).match(NUMBER_PREFIX_RE);
  if (m) return { num: parseInt(m[1], 10), rest: m[2] };
  return { num: Number.MAX_SAFE_INTEGER, rest: basenameNoExt };
}

/** Display label from basename (no ext): strip "N-" then optional "-platformId" suffix. */
function labelFromBasename(basenameNoExt) {
  const { rest } = parseNumberPrefix(basenameNoExt);
  const dashLast = rest.lastIndexOf("-");
  if (dashLast > 0) {
    const suffix = rest.slice(dashLast + 1);
    if (/^\d+$/.test(suffix)) return rest.slice(0, dashLast);
  }
  return rest;
}

function sortKeyForExecutableBasename(basenameNoExt) {
  const { num, rest } = parseNumberPrefix(basenameNoExt);
  return [num, rest];
}

/**
 * Ordered display labels for .sh/.bat scripts under content/games/<id>/scripts.
 * @returns {string[]}
 */
function getExecutablesWithOrder(metadataPath, gameId) {
  const scriptsDir = getGameScriptsDir(metadataPath, gameId);
  if (!fs.existsSync(scriptsDir)) return [];
  let files;
  try {
    files = fs.readdirSync(scriptsDir);
  } catch (err) {
    console.warn(`Failed to read scripts directory ${scriptsDir}:`, err.message);
    return [];
  }
  const executableFiles = files.filter((file) => {
    const filePath = path.join(scriptsDir, file);
    if (!fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    return ext === ".sh" || ext === ".bat";
  });
  executableFiles.sort((a, b) => {
    const aBase = path.basename(a, path.extname(a));
    const bBase = path.basename(b, path.extname(b));
    const [aNum, aRest] = sortKeyForExecutableBasename(aBase);
    const [bNum, bRest] = sortKeyForExecutableBasename(bBase);
    if (aNum !== bNum) return aNum - bNum;
    return aRest.localeCompare(bRest);
  });
  return executableFiles.map((f) => labelFromBasename(path.basename(f, path.extname(f))));
}

/**
 * Refresh `game.executables` from disk and return the array (or null if none).
 * Mutates the in-memory game object so allGames stays aligned with the filesystem.
 */
function syncGameExecutablesFromDisk(metadataPath, game) {
  if (!game || game.id == null) return null;
  const names = getExecutablesWithOrder(metadataPath, game.id);
  if (names.length > 0) {
    game.executables = names;
    return names;
  }
  delete game.executables;
  return null;
}

module.exports = {
  getGameScriptsDir,
  getExecutablesWithOrder,
  syncGameExecutablesFromDisk,
  labelFromBasename,
  parseNumberPrefix,
  sortKeyForExecutableBasename,
};
