const { runDerivedItemTests } = require("./derivedItems.shared");

// Ensure test env and setup run before server is loaded (same as library.test.js)
require("../setup");

runDerivedItemTests({
  routeBase: "/franchises",
  listKey: "franchises",
  responseKey: "franchise",
  humanName: "Franchise",
  contentFolder: "franchises",
  gameField: "franchise",
});
