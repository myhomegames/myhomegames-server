/**
 * Shared logic for collection-like resources: collections, developers, publishers.
 * Each has: content/{folder}/{id}/metadata.json with { title, games: [], summary?, ... }
 */

const fs = require("fs");
const path = require("path");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("./fileUtils");

/**
 * Get metadata path for an item
 */
function getMetadataPath(metadataPath, contentFolder, itemId) {
  return path.join(metadataPath, "content", contentFolder, String(itemId), "metadata.json");
}

/**
 * Load all items from a content folder
 */
function loadItems(metadataPath, contentFolder) {
  const dir = path.join(metadataPath, "content", contentFolder);
  const items = [];

  if (!fs.existsSync(dir)) {
    return items;
  }

  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const folderName of folders) {
    const metaPath = path.join(dir, folderName, "metadata.json");
    if (fs.existsSync(metaPath)) {
      const meta = readJsonFile(metaPath, null);
      if (meta && meta.title) {
        const id = /^\d+$/.test(folderName) ? Number(folderName) : folderName;
        items.push({
          id,
          title: meta.title,
          summary: meta.summary || "",
          games: meta.games || [],
          showTitle: meta.showTitle !== false,
          igdbCover: meta.igdbCover || null,
          igdbSummary: meta.igdbSummary || null,
          ...meta,
        });
      }
    }
  }

  return items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

/**
 * Save a single item (removes id from stored data - it's in folder name)
 */
function saveItem(metadataPath, contentFolder, item) {
  const dir = path.join(metadataPath, "content", contentFolder, String(item.id));
  ensureDirectoryExists(dir);
  const toSave = { ...item };
  delete toSave.id;
  writeJsonFile(getMetadataPath(metadataPath, contentFolder, item.id), toSave);
}

/**
 * Delete an item (metadata.json and empty directory)
 */
function deleteItem(metadataPath, contentFolder, itemId) {
  const dir = path.join(metadataPath, "content", contentFolder, String(itemId));
  const metaPath = getMetadataPath(metadataPath, contentFolder, itemId);

  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  if (fs.existsSync(dir)) {
    removeDirectoryIfEmpty(dir);
  }
}

/**
 * Normalize ID for comparison (string or number)
 */
function normalizeId(id) {
  if (id == null) return null;
  return /^\d+$/.test(String(id)) ? Number(id) : String(id);
}

/**
 * Find item in array by ID
 */
function findById(items, id) {
  const n = normalizeId(id);
  return items.find((c) => {
    if (typeof n === "number" && typeof c.id === "number") return c.id === n;
    return String(c.id) === String(n);
  });
}

/**
 * Find item index in array by ID
 */
function findIndexById(items, id) {
  const n = normalizeId(id);
  return items.findIndex((c) => {
    if (typeof n === "number" && typeof c.id === "number") return c.id === n;
    return String(c.id) === String(n);
  });
}

/**
 * Remove game from all items of a given type
 */
function removeGameFromAll(metadataPath, contentFolder, gameId, updateCacheCallback, cache) {
  const items = cache && Array.isArray(cache) ? cache : loadItems(metadataPath, contentFolder);
  let count = 0;

  for (const item of items) {
    const games = item.games || [];
    const idx = games.findIndex((g) => Number(g) === Number(gameId));
    if (idx !== -1) {
      games.splice(idx, 1);
      item.games = games;
      saveItem(metadataPath, contentFolder, item);
      count++;
      if (updateCacheCallback) updateCacheCallback(item);
    }
  }

  if (count > 0) {
    console.log(`Removed game ${gameId} from ${count} ${contentFolder} item(s)`);
  }
  return count;
}

module.exports = {
  getMetadataPath,
  loadItems,
  saveItem,
  deleteItem,
  normalizeId,
  findById,
  findIndexById,
  removeGameFromAll,
};
