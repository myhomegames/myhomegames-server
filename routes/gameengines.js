const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/game-engines",
  contentFolder: "game-engines",
  coverPrefix: "game-engine-covers",
  responseKey: "gameEngine",
  listResponseKey: "gameEngines",
  humanName: "Game engine",
  gameField: "gameEngines",
  resourceType: "game-engines",
});

module.exports = {
  loadGameEngines: routes.loadTags,
  ensureGameEngineExists: routes.ensureTagExists,
  ensureGameEnginesExistBatch: routes.ensureTagsExist,
  deleteGameEngineIfUnused: routes.deleteTagIfUnused,
  registerGameEnginesRoutes: routes.registerTagRoutes,
};
