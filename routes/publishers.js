/**
 * Publishers routes - collection-like, IDs from IGDB company.id
 * Created automatically when games are added; no POST create.
 */

const path = require("path");
const { createCollectionLikeRoutes } = require("./collectionLike");
const { readJsonFile, writeJsonFile } = require("../utils/fileUtils");

const routes = createCollectionLikeRoutes({
  contentFolder: "publishers",
  routeBase: "/publishers",
  coverPrefix: "publisher-covers",
  listResponseKey: "publishers",
  singleResponseKey: "publisher",
  humanName: "Publisher",
  gameField: "publishers",
});

function removePublisherFromAllGames(metadataPath, metadataGamesDir, publisherId, allGames) {
  for (const game of Object.values(allGames)) {
    const pubs = game.publishers;
    if (!pubs || !Array.isArray(pubs)) continue;
    const filtered = pubs.filter((p) => {
      const id = typeof p === "object" && p && p.id != null ? p.id : p;
      return Number(id) !== Number(publisherId);
    });
    if (filtered.length !== pubs.length) {
      const gamePath = path.join(metadataPath, "content", "games", String(game.id), "metadata.json");
      const meta = readJsonFile(gamePath, null);
      if (meta) {
        meta.publishers = filtered.length > 0 ? filtered : null;
        writeJsonFile(gamePath, meta);
      }
      game.publishers = filtered.length > 0 ? filtered : null;
    }
  }
}

function registerPublishersRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  return routes.registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removePublisherFromAllGames);
}

module.exports = {
  loadPublishers: routes.loadItems,
  ensurePublishersExistBatch: routes.ensureBatch,
  removeGameFromPublisher: routes.removeGameFrom,
  removeGameFromAllPublishers: routes.removeGameFromAll,
  removePublisherFromAllGames,
  registerPublishersRoutes,
};
