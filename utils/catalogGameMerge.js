const { createReleaseDate } = require("./dateUtils");
const { coerceToGameTypeId } = require("./gameType");
const { isMissingLocalValue } = require("./catalogCompany");

const LOG_PREFIX = "[catalog-game-merge]";

function log(message, extra) {
  if (extra !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function validateStringArray(arr) {
  if (arr && Array.isArray(arr) && arr.length > 0) {
    const filtered = arr.filter((item) => item && typeof item === "string" && item.trim());
    return filtered.length > 0 ? filtered : null;
  }
  return null;
}

function normalizeCatalogTagNames(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  const names = [];
  for (const item of arr) {
    if (typeof item === "string" && item.trim()) names.push(item.trim());
    else if (item && typeof item === "object" && typeof item.name === "string" && item.name.trim()) {
      names.push(item.name.trim());
    }
  }
  return names.length > 0 ? names : null;
}

function validateObjectArray(arr) {
  if (arr && Array.isArray(arr) && arr.length > 0) {
    return arr.filter((item) => item && typeof item === "object");
  }
  return null;
}

function validateDeveloperPublisherArray(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  const filtered = arr.filter((item) => item && typeof item === "object" && item.id != null && item.name);
  return filtered
    .map((x) => ({
      id: Number(x.id),
      name: String(x.name).trim(),
      logo: x.logo || null,
      description: x.description || "",
    }))
    .filter((x) => !Number.isNaN(x.id) && x.name);
}

function normalizeOneFranchiseOrCollection(v) {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && typeof v.name === "string" && v.name.trim()) {
    const id = typeof v.id === "number" && !Number.isNaN(v.id) ? v.id : 0;
    return { id, name: v.name.trim() };
  }
  return null;
}

function normalizeFranchiseOrCollectionToArray(v) {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  const out = arr.map(normalizeOneFranchiseOrCollection).filter(Boolean);
  return out.length > 0 ? out : null;
}

/**
 * Parse GET /igdb/game/:id response into local merge shape (metadata + tag raw data).
 */
function parseCatalogGamePayload(catalogPayload) {
  if (!catalogPayload || typeof catalogPayload !== "object") return null;

  const releaseDateObj = createReleaseDate(
    catalogPayload.releaseDateFull?.timestamp ?? catalogPayload.releaseDate
  );

  const validGenres = validateStringArray(catalogPayload.genres);
  const validThemes = normalizeCatalogTagNames(catalogPayload.themes) || validateStringArray(catalogPayload.themes);
  const validPlatforms = normalizeCatalogTagNames(catalogPayload.platforms) || validateStringArray(catalogPayload.platforms);
  const validGameModes = normalizeCatalogTagNames(catalogPayload.gameModes) || validateStringArray(catalogPayload.gameModes);
  const validPlayerPerspectives =
    normalizeCatalogTagNames(catalogPayload.playerPerspectives) || validateStringArray(catalogPayload.playerPerspectives);
  const validWebsites = validateObjectArray(catalogPayload.websites);
  const validAgeRatings = validateObjectArray(catalogPayload.ageRatings);
  const rawDevelopers = validateDeveloperPublisherArray(catalogPayload.developers);
  const rawPublishers = validateDeveloperPublisherArray(catalogPayload.publishers);
  const validScreenshots = validateStringArray(catalogPayload.screenshots);
  const validVideos = validateStringArray(catalogPayload.videos);
  const validGameEngines =
    normalizeCatalogTagNames(catalogPayload.gameEngines) || validateStringArray(catalogPayload.gameEngines);
  const validKeywords = validateStringArray(catalogPayload.keywords);
  const validAlternativeNames = validateStringArray(catalogPayload.alternativeNames);
  const validSimilarGames = validateObjectArray(catalogPayload.similarGames);
  const franchiseForEnsure = normalizeFranchiseOrCollectionToArray(catalogPayload.franchise);
  const collectionForEnsure = normalizeFranchiseOrCollectionToArray(
    catalogPayload.collection ?? catalogPayload.series
  );

  const storedGameTypeId = coerceToGameTypeId(catalogPayload.type);

  return {
    summary: typeof catalogPayload.summary === "string" && catalogPayload.summary.trim() ? catalogPayload.summary : null,
    year: releaseDateObj ? releaseDateObj.year : null,
    month: releaseDateObj ? releaseDateObj.month : null,
    day: releaseDateObj ? releaseDateObj.day : null,
    criticratings:
      catalogPayload.criticRating !== undefined && catalogPayload.criticRating !== null
        ? catalogPayload.criticRating / 10
        : null,
    userratings:
      catalogPayload.userRating !== undefined && catalogPayload.userRating !== null
        ? catalogPayload.userRating / 10
        : null,
    stars: catalogPayload.stars !== undefined && catalogPayload.stars !== null ? catalogPayload.stars : null,
    websites:
      validWebsites && validWebsites.length
        ? validWebsites
            .map((w) => (w && typeof w.url === "string" && w.url.trim() ? w.url.trim() : null))
            .filter(Boolean)
        : null,
    ageRatings: validAgeRatings,
    screenshots: validScreenshots,
    videos: validVideos,
    keywords: validKeywords,
    alternativeNames: validAlternativeNames,
    similarGames:
      validSimilarGames && validSimilarGames.length
        ? [...new Set(validSimilarGames.map((s) => Number(s.id)).filter((id) => !Number.isNaN(id)))]
        : null,
    externalCoverUrl:
      catalogPayload.cover && typeof catalogPayload.cover === "string" && catalogPayload.cover.trim()
        ? catalogPayload.cover.trim()
        : null,
    externalBackgroundUrl:
      catalogPayload.background && typeof catalogPayload.background === "string" && catalogPayload.background.trim()
        ? catalogPayload.background.trim()
        : null,
    type: storedGameTypeId,
    genres: validGenres,
    themes: validThemes,
    platforms: validPlatforms,
    gameModes: validGameModes,
    playerPerspectives: validPlayerPerspectives,
    gameEngines: validGameEngines,
    rawDevelopers,
    rawPublishers,
    franchiseForEnsure,
    collectionForEnsure,
  };
}

function mergeStringArray(local, remote) {
  const base = Array.isArray(local) ? [...local] : [];
  const existing = new Set(base.map((s) => String(s).trim()).filter(Boolean));
  let changed = false;
  if (!Array.isArray(remote) || remote.length === 0) {
    return { value: base.length > 0 ? base : local ?? null, changed: false };
  }
  for (const item of remote) {
    const v = typeof item === "string" ? item.trim() : null;
    if (v && !existing.has(v)) {
      base.push(v);
      existing.add(v);
      changed = true;
    }
  }
  return { value: base.length > 0 ? base : local ?? null, changed };
}

function mergeAgeRatings(local, remote) {
  const base = Array.isArray(local) ? [...local] : [];
  const key = (ar) => (ar && typeof ar === "object" ? `${ar.category}:${ar.rating}` : null);
  const existing = new Set(base.map(key).filter(Boolean));
  let changed = false;
  if (!Array.isArray(remote) || remote.length === 0) {
    return { value: base.length > 0 ? base : local ?? null, changed: false };
  }
  for (const ar of remote) {
    if (ar && typeof ar === "object" && typeof ar.category === "number" && typeof ar.rating === "number") {
      const k = key(ar);
      if (k && !existing.has(k)) {
        base.push({ category: ar.category, rating: ar.rating });
        existing.add(k);
        changed = true;
      }
    }
  }
  return { value: base.length > 0 ? base : local ?? null, changed };
}

function mergeSimilarGameIds(local, remote) {
  const base = Array.isArray(local)
    ? [...local.map(Number).filter((id) => !Number.isNaN(id))]
    : [];
  const existing = new Set(base);
  let changed = false;
  if (!Array.isArray(remote) || remote.length === 0) {
    return { value: base.length > 0 ? base : local ?? null, changed: false };
  }
  for (const item of remote) {
    const id = typeof item === "number" ? item : Number(item?.id);
    if (!Number.isNaN(id) && !existing.has(id)) {
      base.push(id);
      existing.add(id);
      changed = true;
    }
  }
  return { value: base.length > 0 ? base : local ?? null, changed };
}

/**
 * Merge IGDB game payload into local game metadata — only fills missing scalar/array fields.
 */
function mergeCatalogGameMetadata(localGame, catalogPayload) {
  const parsed = parseCatalogGamePayload(catalogPayload);
  if (!parsed) {
    return { game: localGame, changed: false, parsed: null };
  }

  const merged = { ...localGame };
  let changed = false;

  const scalarKeys = [
    "summary",
    "year",
    "month",
    "day",
    "criticratings",
    "userratings",
    "stars",
    "externalCoverUrl",
    "externalBackgroundUrl",
    "type",
  ];
  for (const key of scalarKeys) {
    if (isMissingLocalValue(merged[key]) && !isMissingLocalValue(parsed[key])) {
      merged[key] = parsed[key];
      changed = true;
    }
  }

  const arrayMerges = [
    ["websites", parsed.websites, mergeStringArray],
    ["ageRatings", parsed.ageRatings, mergeAgeRatings],
    ["screenshots", parsed.screenshots, mergeStringArray],
    ["videos", parsed.videos, mergeStringArray],
    ["keywords", parsed.keywords, mergeStringArray],
    ["alternativeNames", parsed.alternativeNames, mergeStringArray],
    ["similarGames", parsed.similarGames, mergeSimilarGameIds],
  ];

  for (const [key, remote, mergeFn] of arrayMerges) {
    if (isMissingLocalValue(remote)) continue;
    const { value, changed: arrChanged } = mergeFn(merged[key], remote);
    if (arrChanged) {
      merged[key] = value;
      changed = true;
    }
  }

  if (changed) {
    log(`merged missing metadata fields for game ${localGame.id ?? "?"}`);
  }

  return { game: merged, changed, parsed };
}

function idsToAdd(localIds, remoteIds) {
  const local = new Set(Array.isArray(localIds) ? localIds.map(Number) : []);
  return (Array.isArray(remoteIds) ? remoteIds : [])
    .map(Number)
    .filter((id) => !Number.isNaN(id) && !local.has(id));
}

function devPubItemsToAdd(localIds, rawItems) {
  const local = new Set(Array.isArray(localIds) ? localIds.map(Number) : []);
  if (!Array.isArray(rawItems)) return [];
  return rawItems.filter((item) => item && !Number.isNaN(Number(item.id)) && !local.has(Number(item.id)));
}

function franchiseCollectionItemsToAdd(localIds, items) {
  const local = new Set(Array.isArray(localIds) ? localIds.map(Number) : []);
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && !Number.isNaN(Number(item.id)) && !local.has(Number(item.id)));
}

module.exports = {
  parseCatalogGamePayload,
  mergeCatalogGameMetadata,
  mergeStringArray,
  mergeAgeRatings,
  mergeSimilarGameIds,
  idsToAdd,
  devPubItemsToAdd,
  franchiseCollectionItemsToAdd,
  isMissingLocalValue,
};
