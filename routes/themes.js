const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/themes",
  contentFolder: "themes",
  coverPrefix: "theme-covers",
  responseKey: "theme",
  listResponseKey: "themes",
  humanName: "Theme",
  gameField: "themes",
});

module.exports = {
  loadThemes: routes.loadTags,
  ensureThemeExists: routes.ensureTagExists,
  ensureThemesExistBatch: routes.ensureTagsExist,
  deleteThemeIfUnused: routes.deleteTagIfUnused,
  registerThemesRoutes: routes.registerTagRoutes,
  resolveThemeIdsToObjects: routes.resolveTagIdsToObjects,
  normalizeThemeFieldToIds: routes.normalizeTagFieldToIds,
};
