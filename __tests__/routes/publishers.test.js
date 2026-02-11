const { runCollectionLikeTests } = require("./collectionLike.shared");

runCollectionLikeTests({
  routeBase: "/publishers",
  listKey: "publishers",
  singleResponseKey: "publisher",
  humanName: "Publisher",
  coverPrefix: "publisher-covers",
  contentFolder: "publishers",
  gameField: "publishers",
});
