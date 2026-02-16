const { runDerivedItemTests } = require("./derivedItems.shared");

runDerivedItemTests({
  routeBase: "/series",
  listKey: "series",
  responseKey: "series",
  humanName: "Series",
  contentFolder: "series",
  gameField: "collection",
});
