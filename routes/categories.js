const { createTagRoutes } = require("./taglists");

const routes = createTagRoutes({
  routeBase: "/categories",
  contentFolder: "categories",
  coverPrefix: "category-covers",
  responseKey: "category",
  listResponseKey: "categories",
  humanName: "Category",
  gameField: "genre",
});

module.exports = {
  loadCategories: routes.loadTags,
  ensureCategoryExists: routes.ensureTagExists,
  ensureCategoriesExistBatch: routes.ensureTagsExist,
  deleteCategoryIfUnused: routes.deleteTagIfUnused,
  registerCategoriesRoutes: routes.registerTagRoutes,
};
