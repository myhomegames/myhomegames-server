const { runTagListTests } = require("./taglists.shared");

// Ensure test env and setup run before server is loaded (same as library.test.js)
require("../setup");

runTagListTests({
  routeBase: "/categories",
  listKey: "categories",
  responseKey: "category",
  humanName: "Category",
  coverPrefix: "category-covers",
  contentFolder: "categories",
  ensureFnName: "ensureCategoryExists",
  modulePath: "../../routes/categories",
  gameField: "genre",
});
