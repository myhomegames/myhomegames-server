const fs = require("fs");
const path = require("path");
const { removeDirectoryIfEmpty } = require("./fileUtils");

/**
 * Get local media path if it exists (generic function)
 * @param {Object} options - Configuration object
 * @param {string} options.metadataPath - Path to metadata directory
 * @param {string|number} options.resourceId - Resource ID (game ID or collection ID)
 * @param {string} options.resourceType - Type of resource: 'games' or 'collections'
 * @param {string} options.mediaType - Type of media: 'cover' or 'background'
 * @param {string} options.urlPrefix - URL prefix (e.g., '/covers', '/backgrounds', '/collection-covers', '/collection-backgrounds')
 * @returns {string|null} - Media path or null if not found
 */
function getLocalMediaPath({ metadataPath, resourceId, resourceType, mediaType, urlPrefix }) {
  let normalizedId;
  let contentDir;
  
  const tagResourceTypes = new Set([
    "categories",
    "themes",
    "platforms",
    "game-engines",
    "game-modes",
    "player-perspectives",
  ]);

  if (resourceType === "games") {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", "games", normalizedId);
  } else if (resourceType === "collections") {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", "collections", normalizedId);
  } else if (tagResourceTypes.has(resourceType)) {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", resourceType, normalizedId);
  } else {
    return null;
  }
  
  const fileName = `${mediaType}.webp`;
  const filePath = path.join(contentDir, fileName);
  
  if (fs.existsSync(filePath)) {
    return `${urlPrefix}/${encodeURIComponent(resourceId)}`;
  }
  
  return null;
}

/**
 * Get media URL (local if exists, otherwise fallback to external URL)
 * @param {Object} options - Configuration object
 * @param {string} options.metadataPath - Path to metadata directory
 * @param {string|number} options.resourceId - Resource ID (game ID or collection ID)
 * @param {string} options.resourceType - Type of resource: 'games' or 'collections'
 * @param {string} options.mediaType - Type of media: 'cover' or 'background'
 * @param {string} options.urlPrefix - URL prefix (e.g., '/covers', '/backgrounds', '/collection-covers', '/collection-backgrounds')
 * @param {string|null} options.externalUrl - External URL (e.g., IGDB URL for games, null for collections)
 * @returns {string|null} - Media URL or null
 */
function getMediaUrl({ metadataPath, resourceId, resourceType, mediaType, urlPrefix, externalUrl = null }) {
  // First check if local media exists
  const localPath = getLocalMediaPath({ metadataPath, resourceId, resourceType, mediaType, urlPrefix });
  if (localPath) {
    return localPath;
  }
  // Fallback to external URL if available
  if (externalUrl) {
    return externalUrl;
  }
  return null;
}

// Convenience functions for backward compatibility and ease of use

/**
 * Get the local cover path if it exists (for games)
 * @param {string} metadataPath - Path to metadata directory
 * @param {number|string} gameId - Game ID
 * @returns {string|null} - Cover path or null if not found
 */
function getCoverPath(metadataPath, gameId) {
  return getLocalMediaPath({
    metadataPath,
    resourceId: gameId,
    resourceType: 'games',
    mediaType: 'cover',
    urlPrefix: '/covers'
  });
}

/**
 * Get the local background path if it exists (for games)
 * @param {string} metadataPath - Path to metadata directory
 * @param {number|string} gameId - Game ID
 * @returns {string|null} - Background path or null if not found
 */
function getBackgroundPath(metadataPath, gameId) {
  return getLocalMediaPath({
    metadataPath,
    resourceId: gameId,
    resourceType: 'games',
    mediaType: 'background',
    urlPrefix: '/backgrounds'
  });
}

/**
 * Get cover URL (local if exists, otherwise IGDB)
 * @param {object} game - Game object with id and igdbCover
 * @param {string} metadataPath - Path to metadata directory
 * @returns {string|null} - Cover URL or null
 */
function getCoverUrl(game, metadataPath) {
  return getMediaUrl({
    metadataPath,
    resourceId: game.id,
    resourceType: 'games',
    mediaType: 'cover',
    urlPrefix: '/covers',
    externalUrl: game.igdbCover || null
  });
}

/**
 * Get background URL (local if exists, otherwise IGDB)
 * @param {object} game - Game object with id and igdbBackground
 * @param {string} metadataPath - Path to metadata directory
 * @returns {string|null} - Background URL or null
 */
function getBackgroundUrl(game, metadataPath) {
  return getMediaUrl({
    metadataPath,
    resourceId: game.id,
    resourceType: 'games',
    mediaType: 'background',
    urlPrefix: '/backgrounds',
    externalUrl: game.igdbBackground || null
  });
}

/**
 * Delete a media file (cover or background) for a resource (game or collection)
 * @param {Object} options - Configuration object
 * @param {string} options.metadataPath - Path to metadata directory
 * @param {string|number} options.resourceId - Resource ID (game ID or collection ID)
 * @param {string} options.resourceType - Type of resource: 'games' or 'collections'
 * @param {string} options.mediaType - Type of media: 'cover' or 'background'
 * @returns {boolean} - True if file was deleted, false if it didn't exist
 * @throws {Error} - If deletion fails
 */
function deleteMediaFile({ metadataPath, resourceId, resourceType, mediaType }) {
  let normalizedId;
  let contentDir;
  
  const tagResourceTypes = new Set([
    "categories",
    "themes",
    "platforms",
    "game-engines",
    "game-modes",
    "player-perspectives",
  ]);

  if (resourceType === "games") {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", "games", normalizedId);
  } else if (resourceType === "collections") {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", "collections", normalizedId);
  } else if (tagResourceTypes.has(resourceType)) {
    normalizedId = String(resourceId);
    contentDir = path.join(metadataPath, "content", resourceType, normalizedId);
  } else {
    throw new Error(`Invalid resourceType: ${resourceType}`);
  }
  
  const fileName = `${mediaType}.webp`;
  const filePath = path.join(contentDir, fileName);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    // Remove directory only if it's empty after deleting the file
    removeDirectoryIfEmpty(contentDir);
    return true;
  }
  
  return false;
}

module.exports = {
  // Generic functions
  getLocalMediaPath,
  getMediaUrl,
  deleteMediaFile,
  // Convenience functions for games
  getCoverPath,
  getBackgroundPath,
  getCoverUrl,
  getBackgroundUrl,
};
