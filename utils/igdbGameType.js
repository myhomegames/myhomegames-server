/**
 * IGDB game_type id (Game → game_type reference).
 * @see https://api-docs.igdb.com/#game-type
 *
 * metadata.json and JSON API expose only the numeric id; labels are resolved on the client.
 */

/**
 * Normalize client/API input to a single id for metadata.json (number only).
 * Accepts: null, number, or { id } (legacy { id, name } ok).
 */
function coerceToGameTypeId(input) {
  if (input == null) return null;
  if (typeof input === "number" && !Number.isNaN(input)) return input;
  if (typeof input === "object" && input !== null && input.id != null) {
    const id = Number(input.id);
    return Number.isNaN(id) ? null : id;
  }
  return null;
}

module.exports = {
  coerceToGameTypeId,
};
