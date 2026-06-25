/**
 * Helpers for optimized game deletion (targeted updates + deferred cleanup).
 */

function scheduleGameDeleteBackgroundCleanup(fn) {
  const run = () => {
    try {
      fn();
    } catch (error) {
      console.error("Background game-delete cleanup failed:", error);
    }
  };
  // Run synchronously under Jest so integration tests stay deterministic.
  if (process.env.JEST_WORKER_ID !== undefined) {
    run();
    return;
  }
  setImmediate(run);
}

function normalizeNumericIdList(values) {
  if (!values || !Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (value == null) continue;
    const id = Number(typeof value === "object" && value != null && value.id != null ? value.id : value);
    if (Number.isNaN(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Build reverse index: gameId -> resource ids that list this game. */
function buildGameToResourceIdsMap(items) {
  const map = new Map();
  if (!items || !Array.isArray(items)) return map;
  for (const item of items) {
    const resourceId = item && item.id;
    if (resourceId == null) continue;
    const games = Array.isArray(item.games) ? item.games : [];
    for (const gameId of games) {
      const key = Number(gameId);
      if (Number.isNaN(key)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(resourceId);
    }
  }
  return map;
}

function findResourceIdsContainingGame(items, gameId) {
  const target = Number(gameId);
  if (Number.isNaN(target) || !items || !Array.isArray(items)) return [];
  const result = [];
  for (const item of items) {
    const games = item.games || [];
    if (games.some((g) => Number(g) === target)) result.push(item.id);
  }
  return result;
}

function collectResourceIdsForGame(gameId, primaryIds, cachedItems) {
  const ids = new Set(normalizeNumericIdList(primaryIds));
  if (cachedItems && Array.isArray(cachedItems)) {
    for (const resourceId of findResourceIdsContainingGame(cachedItems, gameId)) {
      ids.add(Number(resourceId));
    }
  }
  return [...ids].filter((id) => !Number.isNaN(id));
}

function collectResourceIdsForGameWithMapFallback(gameId, primaryIds, cachedItems, resourceToGameIdsMap) {
  const ids = new Set(collectResourceIdsForGame(gameId, primaryIds, cachedItems));
  if (!cachedItems && resourceToGameIdsMap) {
    for (const [resourceId, gameIds] of resourceToGameIdsMap) {
      if (gameIds.some((g) => Number(g) === Number(gameId))) {
        ids.add(Number(resourceId));
      }
    }
  }
  return [...ids].filter((id) => !Number.isNaN(id));
}

module.exports = {
  scheduleGameDeleteBackgroundCleanup,
  normalizeNumericIdList,
  buildGameToResourceIdsMap,
  findResourceIdsContainingGame,
  collectResourceIdsForGame,
  collectResourceIdsForGameWithMapFallback,
};
