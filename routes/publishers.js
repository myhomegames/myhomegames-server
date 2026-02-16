/**
 * Publishers routes - collection-like, IDs from IGDB company.id
 * Created automatically when games are added; no POST create.
 */

const { createCollectionLikeRoutes } = require("./collectionLike");
const { addGameToItem, getResourceToGameIdsMap } = require("../utils/collectionsShared");

const routes = createCollectionLikeRoutes({
  contentFolder: "publishers",
  routeBase: "/publishers",
  coverPrefix: "publisher-covers",
  listResponseKey: "publishers",
  singleResponseKey: "publisher",
  humanName: "Publisher",
  gameField: "publishers",
});

/** Add game to a publisher's games array (for migration / linking). Publishers are stored only in blocks. */
function addGameToPublisher(metadataPath, publisherId, gameId) {
  return addGameToItem(metadataPath, "publishers", publisherId, gameId);
}

/** Map(publisherId -> gameIds[]) for building game.publishers from blocks. */
function getPublisherToGameIdsMap(metadataPath) {
  return getResourceToGameIdsMap(metadataPath, "publishers");
}

/** Update in-memory allGames only; publisher links are stored in publisher blocks, not in game metadata. */
function removePublisherFromAllGames(metadataPath, metadataGamesDir, publisherId, allGames) {
  for (const game of Object.values(allGames)) {
    const pubs = game.publishers;
    if (!pubs || !Array.isArray(pubs)) continue;
    const filtered = pubs.filter((p) => {
      const id = typeof p === "object" && p && p.id != null ? p.id : p;
      return Number(id) !== Number(publisherId);
    });
    if (filtered.length !== pubs.length) {
      game.publishers = filtered.length > 0 ? filtered : null;
    }
  }
}

function registerPublishersRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  return routes.registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removePublisherFromAllGames);
}

function deletePublisherIfUnused(metadataPath, publisherId) {
  return routes.deleteItemIfUnused(metadataPath, publisherId);
}

module.exports = {
  loadPublishers: routes.loadItems,
  ensurePublishersExistBatch: routes.ensureBatch,
  removeGameFromPublisher: routes.removeGameFrom,
  removeGameFromAllPublishers: routes.removeGameFromAll,
  deletePublisherIfUnused,
  addGameToPublisher,
  getPublisherToGameIdsMap,
  removePublisherFromAllGames,
  registerPublishersRoutes,
};
