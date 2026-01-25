const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/player-perspectives",
  contentFolder: "player-perspectives",
  coverPrefix: "player-perspective-covers",
  responseKey: "playerPerspective",
  listResponseKey: "playerPerspectives",
  humanName: "Player perspective",
  gameField: "playerPerspectives",
  resourceType: "player-perspectives",
});

module.exports = {
  loadPlayerPerspectives: routes.loadTags,
  ensurePlayerPerspectiveExists: routes.ensureTagExists,
  deletePlayerPerspectiveIfUnused: routes.deleteTagIfUnused,
  registerPlayerPerspectivesRoutes: routes.registerTagRoutes,
};
