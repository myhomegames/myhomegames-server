/**
 * Shared logic for collection-like resources: collections, developers, publishers.
 * Each has: content/{folder}/{id}/metadata.json with { title, games: [], summary?, ... }
 */

const fs = require("fs");
const path = require("path");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("./fileUtils");
const { getTitleForSort } = require("./sortUtils");

function normalizeChildIds(rawChilds, selfId) {
  const arr = Array.isArray(rawChilds) ? rawChilds : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const id = normalizeId(raw);
    if (id == null) continue;
    if (String(id) === String(selfId)) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function pruneInvalidChildLinks(items) {
  const validIds = new Set(items.map((i) => String(i.id)));
  let changed = false;
  for (const item of items) {
    const before = Array.isArray(item.childs) ? item.childs : [];
    const pruned = normalizeChildIds(before, item.id).filter((id) => validIds.has(String(id)));
    if (before.length !== pruned.length || before.some((id, idx) => String(id) !== String(pruned[idx]))) {
      item.childs = pruned;
      changed = true;
    }
  }
  return changed;
}

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
        const ec = meta.externalCoverUrl;
        const externalCoverUrl = typeof ec === "string" && ec.trim() ? ec.trim() : null;
        items.push({
          id,
          title: meta.title,
          summary: meta.summary || "",
          games: meta.games || [],
          childs: normalizeChildIds(meta.childs, id),
          showTitle: meta.showTitle !== false,
          ...meta,
          externalCoverUrl,
        });
      }
    }
  }

  const mutated = pruneInvalidChildLinks(items);
  if (mutated) {
    for (const item of items) {
      saveItem(metadataPath, contentFolder, item);
    }
  }

  return items.sort((a, b) =>
    getTitleForSort(a.title).localeCompare(getTitleForSort(b.title))
  );
}

/**
 * Save a single item (removes id from stored data - it's in folder name)
 */
function saveItem(metadataPath, contentFolder, item) {
  const dir = path.join(metadataPath, "content", contentFolder, String(item.id));
  ensureDirectoryExists(dir);
  const toSave = { ...item };
  delete toSave.id;
  toSave.childs = normalizeChildIds(toSave.childs, item.id);
  writeJsonFile(getMetadataPath(metadataPath, contentFolder, item.id), toSave);
}

/**
 * Delete an item (metadata.json and empty directory)
 */
function deleteItem(metadataPath, contentFolder, itemId) {
  const dir = path.join(metadataPath, "content", contentFolder, String(itemId));
  const metaPath = getMetadataPath(metadataPath, contentFolder, itemId);
  const list = loadItems(metadataPath, contentFolder);
  let parentLinksChanged = false;
  for (const item of list) {
    const childs = Array.isArray(item.childs) ? item.childs : [];
    const filtered = childs.filter((id) => String(id) !== String(itemId));
    if (filtered.length !== childs.length) {
      item.childs = filtered;
      saveItem(metadataPath, contentFolder, item);
      parentLinksChanged = true;
    }
  }

  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  if (fs.existsSync(dir)) {
    removeDirectoryIfEmpty(dir);
  }
  return parentLinksChanged;
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

  // Cleanup orphan "collection-like" entries after game deletion:
  // remove only structured leaves (no childs) with no games.
  let removedSomething = true;
  while (removedSomething) {
    pruneInvalidChildLinks(items);
    removedSomething = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const games = Array.isArray(item.games) ? item.games : [];
      if (games.length > 0) continue;
      const childs = Array.isArray(item.childs) ? item.childs : [];
      if (childs.length > 0) continue;
      for (const parent of items) {
        if (!Array.isArray(parent.childs) || parent.childs.length === 0) continue;
        const filtered = parent.childs.filter((id) => String(id) !== String(item.id));
        if (filtered.length !== parent.childs.length) {
          parent.childs = filtered;
          saveItem(metadataPath, contentFolder, parent);
          if (updateCacheCallback) updateCacheCallback(parent);
        }
      }
      deleteItem(metadataPath, contentFolder, item.id);
      items.splice(i, 1);
      removedSomething = true;
    }
  }

  return count;
}

/**
 * Add a game to a single item's games array (for migration / linking).
 */
function addGameToItem(metadataPath, contentFolder, itemId, gameId) {
  const items = loadItems(metadataPath, contentFolder);
  const entry = findById(items, itemId);
  if (!entry) return false;
  const games = entry.games || [];
  if (games.some((g) => Number(g) === Number(gameId))) return false;
  entry.games = [...games, gameId];
  saveItem(metadataPath, contentFolder, entry);
  return true;
}

function addChildToItem(metadataPath, contentFolder, parentId, childId) {
  const items = loadItems(metadataPath, contentFolder);
  const parent = findById(items, parentId);
  const child = findById(items, childId);
  if (!parent || !child) return false;
  const normalizedChildId = normalizeId(child.id);
  const childs = normalizeChildIds(parent.childs, parent.id);
  if (childs.some((id) => String(id) === String(normalizedChildId))) return false;
  parent.childs = [...childs, normalizedChildId];
  saveItem(metadataPath, contentFolder, parent);
  return true;
}

function removeChildFromItem(metadataPath, contentFolder, parentId, childId) {
  const items = loadItems(metadataPath, contentFolder);
  const parent = findById(items, parentId);
  if (!parent) return false;
  const before = normalizeChildIds(parent.childs, parent.id);
  const after = before.filter((id) => String(id) !== String(normalizeId(childId)));
  if (after.length === before.length) return false;
  parent.childs = after;
  saveItem(metadataPath, contentFolder, parent);
  return true;
}

/**
 * Returns Map(itemId -> gameIds[]) for building game->items reverse index.
 */
function getResourceToGameIdsMap(metadataPath, contentFolder) {
  const items = loadItems(metadataPath, contentFolder);
  const map = new Map();
  for (const item of items) {
    const gameIds = Array.isArray(item.games) ? item.games : [];
    if (gameIds.length > 0) map.set(item.id, gameIds);
  }
  return map;
}

/**
 * Compare two games by a field (used for sorting).
 */
function compareGamesByField(gameA, gameB, field = "releaseDate", ascending = true) {
  let compareResult = 0;
  switch (field) {
    case "releaseDate":
      if (!gameA || (!gameA.year && !gameA.month && !gameA.day)) return 1;
      if (!gameB || (!gameB.year && !gameB.month && !gameB.day)) return -1;
      if (gameA.year !== gameB.year) compareResult = (gameA.year || 0) - (gameB.year || 0);
      else if (gameA.month !== gameB.month) compareResult = (gameA.month || 0) - (gameB.month || 0);
      else compareResult = (gameA.day || 0) - (gameB.day || 0);
      break;
    case "year":
      const yearA = gameA?.year ?? 0;
      const yearB = gameB?.year ?? 0;
      if (yearA === 0 && yearB === 0) compareResult = 0;
      else if (yearA === 0) compareResult = 1;
      else if (yearB === 0) compareResult = -1;
      else compareResult = yearA - yearB;
      break;
    case "title":
      compareResult = getTitleForSort(gameA?.title).localeCompare(
        getTitleForSort(gameB?.title),
        undefined,
        { sensitivity: "base" }
      );
      break;
    case "stars":
      compareResult = (gameA?.stars ?? 0) - (gameB?.stars ?? 0);
      break;
    case "criticRating":
      compareResult = (gameA?.criticratings ?? 0) - (gameB?.criticratings ?? 0);
      break;
    case "userRating":
      compareResult = (gameA?.userratings ?? 0) - (gameB?.userratings ?? 0);
      break;
    default:
      compareResult = 0;
  }
  return ascending ? compareResult : -compareResult;
}

/**
 * Sort game IDs by a field using allGames lookup.
 */
function sortGameIdsByField(gameIds, allGames, field = "releaseDate", ascending = true) {
  return [...gameIds].sort((idA, idB) => {
    const gameA = allGames[idA];
    const gameB = allGames[idB];
    return compareGamesByField(gameA, gameB, field, ascending);
  });
}

/**
 * Insert one game ID into a sorted list by release date.
 */
function insertGameIdInSortedPosition(gameIds, newGameId, allGames) {
  const normalizedNewId = normalizeId(newGameId);
  if (gameIds.some((id) => normalizeId(id) === normalizedNewId)) return gameIds;
  const newGame = allGames[newGameId];
  if (!newGame) return [...gameIds, newGameId];
  for (let i = 0; i < gameIds.length; i++) {
    const existingGame = allGames[gameIds[i]];
    if (existingGame && compareGamesByField(newGame, existingGame, "releaseDate", true) < 0) {
      const result = [...gameIds];
      result.splice(i, 0, newGameId);
      return result;
    }
  }
  return [...gameIds, newGameId];
}

/**
 * Compute final game IDs for PUT games/order: preserve client order on reorder,
 * insert by release date when exactly one new game is added.
 */
function computeFinalGameIdsForOrder(currentGameIds, requestedGameIds, allGames) {
  const seen = new Set();
  const uniqueGameIds = [];
  for (const gameId of requestedGameIds) {
    const n = normalizeId(gameId);
    if (n != null && !seen.has(n)) {
      seen.add(n);
      uniqueGameIds.push(n);
    }
  }
  const current = currentGameIds || [];
  const isAddition = uniqueGameIds.length === current.length + 1;
  if (isAddition) {
    const newGameId = uniqueGameIds.find(
      (id) => !current.some((cId) => normalizeId(cId) === normalizeId(id))
    );
    if (newGameId) return insertGameIdInSortedPosition(current, newGameId, allGames);
  }
  return uniqueGameIds;
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
  addGameToItem,
  addChildToItem,
  removeChildFromItem,
  getResourceToGameIdsMap,
  compareGamesByField,
  sortGameIdsByField,
  insertGameIdInSortedPosition,
  computeFinalGameIdsForOrder,
};
