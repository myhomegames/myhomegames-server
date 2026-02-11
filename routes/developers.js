/**
 * Developers routes - collection-like, IDs from IGDB company.id
 * Created automatically when games are added; no POST create.
 */

const path = require("path");
const { createCollectionLikeRoutes } = require("./collectionLike");
const { readJsonFile, writeJsonFile } = require("../utils/fileUtils");

const routes = createCollectionLikeRoutes({
  contentFolder: "developers",
  routeBase: "/developers",
  coverPrefix: "developer-covers",
  listResponseKey: "developers",
  singleResponseKey: "developer",
  humanName: "Developer",
  gameField: "developers",
});

function removeDeveloperFromAllGames(metadataPath, metadataGamesDir, developerId, allGames) {
  for (const game of Object.values(allGames)) {
    const devs = game.developers;
    if (!devs || !Array.isArray(devs)) continue;
    const filtered = devs.filter((d) => {
      const id = typeof d === "object" && d && d.id != null ? d.id : d;
      return Number(id) !== Number(developerId);
    });
    if (filtered.length !== devs.length) {
      const gamePath = path.join(metadataPath, "content", "games", String(game.id), "metadata.json");
      const meta = readJsonFile(gamePath, null);
      if (meta) {
        meta.developers = filtered.length > 0 ? filtered : null;
        writeJsonFile(gamePath, meta);
      }
      game.developers = filtered.length > 0 ? filtered : null;
    }
  }
}

function registerDevelopersRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
  return routes.registerRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames, removeDeveloperFromAllGames);
}

module.exports = {
  loadDevelopers: routes.loadItems,
  ensureDevelopersExistBatch: routes.ensureBatch,
  removeGameFromDeveloper: routes.removeGameFrom,
  removeGameFromAllDevelopers: routes.removeGameFromAll,
  removeDeveloperFromAllGames,
  registerDevelopersRoutes,
};
