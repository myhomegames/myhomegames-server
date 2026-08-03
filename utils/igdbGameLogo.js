"use strict";

/**
 * IGDB artwork_type IDs for game logos (deprecated enum; still used widely).
 * Prefer color, then white (good on dark UI), then black.
 */
const LOGO_ARTWORK_TYPES = Object.freeze({
  COLOR: 7,
  WHITE: 5,
  BLACK: 6,
});

const LOGO_TYPE_PRIORITY = Object.freeze({
  [LOGO_ARTWORK_TYPES.COLOR]: 0,
  [LOGO_ARTWORK_TYPES.WHITE]: 1,
  [LOGO_ARTWORK_TYPES.BLACK]: 2,
});

const LOGO_ARTWORK_TYPE_IDS = Object.freeze([
  LOGO_ARTWORK_TYPES.COLOR,
  LOGO_ARTWORK_TYPES.WHITE,
  LOGO_ARTWORK_TYPES.BLACK,
]);

/**
 * @param {string} imageId
 * @param {{ alpha?: boolean, size?: string }} [opts]
 * @returns {string}
 */
function buildIgdbImageUrl(imageId, opts = {}) {
  const id = String(imageId || "").trim();
  if (!id) return "";
  const size = opts.size || "t_1080p";
  const ext = opts.alpha ? "png" : "jpg";
  return `https://images.igdb.com/igdb/image/upload/${size}/${id}.${ext}`;
}

/**
 * @param {object} artwork
 * @returns {number}
 */
function artworkTypeId(artwork) {
  if (!artwork || typeof artwork !== "object") return NaN;
  const raw = artwork.artwork_type ?? artwork.image_type;
  if (raw && typeof raw === "object" && raw.id != null) return Number(raw.id);
  return Number(raw);
}

/**
 * Pick the best logo artwork from an IGDB artworks list.
 * @param {Array<object>|null|undefined} artworks
 * @returns {object|null}
 */
function pickBestLogoArtwork(artworks) {
  if (!Array.isArray(artworks) || artworks.length === 0) return null;

  const logos = artworks.filter((a) => {
    if (!a || !a.image_id) return false;
    const typeId = artworkTypeId(a);
    return Number.isFinite(typeId) && Object.prototype.hasOwnProperty.call(LOGO_TYPE_PRIORITY, typeId);
  });
  if (logos.length === 0) return null;

  logos.sort((a, b) => {
    const pa = LOGO_TYPE_PRIORITY[artworkTypeId(a)];
    const pb = LOGO_TYPE_PRIORITY[artworkTypeId(b)];
    if (pa !== pb) return pa - pb;
    const alphaA = a.alpha_channel ? 1 : 0;
    const alphaB = b.alpha_channel ? 1 : 0;
    if (alphaA !== alphaB) return alphaB - alphaA;
    const areaA = (Number(a.width) || 0) * (Number(a.height) || 0);
    const areaB = (Number(b.width) || 0) * (Number(b.height) || 0);
    return areaB - areaA;
  });

  return logos[0];
}

/**
 * @param {Array<object>|null|undefined} artworks
 * @returns {string|null}
 */
function logoUrlFromArtworks(artworks) {
  const best = pickBestLogoArtwork(artworks);
  if (!best?.image_id) return null;
  return buildIgdbImageUrl(best.image_id, { alpha: Boolean(best.alpha_channel) }) || null;
}

module.exports = {
  LOGO_ARTWORK_TYPES,
  LOGO_ARTWORK_TYPE_IDS,
  LOGO_TYPE_PRIORITY,
  buildIgdbImageUrl,
  artworkTypeId,
  pickBestLogoArtwork,
  logoUrlFromArtworks,
};
