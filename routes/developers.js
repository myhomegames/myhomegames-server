/**
 * Developers routes - collection-like, IDs from IGDB company.id
 * Created automatically when games are added; no POST create.
 */

const { createCollectionLikeRoutes } = require("./collectionLike");
const { addGameToItem, getResourceToGameIdsMap } = require("../utils/collectionsShared");

const routes = createCollectionLikeRoutes({
  contentFolder: "developers",
  routeBase: "/developers",
  coverPrefix: "developer-covers",
  listResponseKey: "developers",
  singleResponseKey: "developer",
  humanName: "Developer",
  gameField: "developers",
});

/** Add game to a developer's games array (for migration / linking). Developers are stored only in blocks. */
function addGameToDeveloper(metadataPath, developerId, gameId) {
  return addGameToItem(metadataPath, "developers", developerId, gameId);
}

/** Map(developerId -> gameIds[]) for building game.developers from blocks. */
function getDeveloperToGameIdsMap(metadataPath) {
  return getResourceToGameIdsMap(metadataPath, "developers");
}

/** Update in-memory allGames only; developer links are stored in developer blocks, not in game metadata. */
function removeDeveloperFromAllGames(metadataPath, metadataGamesDir, developerId, allGames) {
  for (const game of Object.values(allGames)) {
    const devs = game.developers;
    if (!devs || !Array.isArray(devs)) continue;
    const filtered = devs.filter((d) => {
      const id = typeof d === "object" && d && d.id != null ? d.id : d;
      return Number(id) !== Number(developerId);
    });
    if (filtered.length !== devs.length) {
      game.developers = filtered.length > 0 ? filtered : null;
    }
  }
}

function registerDevelopersRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  return routes.registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removeDeveloperFromAllGames);
}

function deleteDeveloperIfUnused(metadataPath, developerId) {
  return routes.deleteItemIfUnused(metadataPath, developerId);
}

module.exports = {
  loadDevelopers: routes.loadItems,
  ensureDevelopersExistBatch: routes.ensureBatch,
  removeGameFromDeveloper: routes.removeGameFrom,
  removeGameFromAllDevelopers: routes.removeGameFromAll,
  deleteDeveloperIfUnused,
  addGameToDeveloper,
  getDeveloperToGameIdsMap,
  removeDeveloperFromAllGames,
  registerDevelopersRoutes,
};
