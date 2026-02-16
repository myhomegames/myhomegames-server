const { runDerivedItemTests } = require("./derivedItems.shared");

runDerivedItemTests({
  routeBase: "/franchises",
  listKey: "franchises",
  responseKey: "franchise",
  humanName: "Franchise",
  contentFolder: "franchises",
  gameField: "franchise",
});
