const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/platforms",
  contentFolder: "platforms",
  coverPrefix: "platform-covers",
  responseKey: "platform",
  listResponseKey: "platforms",
  humanName: "Platform",
  gameField: "platforms",
});

module.exports = {
  loadPlatforms: routes.loadTags,
  ensurePlatformExists: routes.ensureTagExists,
  deletePlatformIfUnused: routes.deleteTagIfUnused,
  registerPlatformsRoutes: routes.registerTagRoutes,
};
