const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/game-modes",
  contentFolder: "game-modes",
  coverPrefix: "game-mode-covers",
  responseKey: "gameMode",
  listResponseKey: "gameModes",
  humanName: "Game mode",
  gameField: "gameModes",
  resourceType: "game-modes",
});

module.exports = {
  loadGameModes: routes.loadTags,
  ensureGameModeExists: routes.ensureTagExists,
  ensureGameModesExistBatch: routes.ensureTagsExist,
  deleteGameModeIfUnused: routes.deleteTagIfUnused,
  registerGameModesRoutes: routes.registerTagRoutes,
};
