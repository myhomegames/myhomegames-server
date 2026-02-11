const { runCollectionLikeTests } = require("./collectionLike.shared");

runCollectionLikeTests({
  routeBase: "/developers",
  listKey: "developers",
  singleResponseKey: "developer",
  humanName: "Developer",
  coverPrefix: "developer-covers",
  contentFolder: "developers",
  gameField: "developers",
});
