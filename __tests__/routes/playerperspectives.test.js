const { runTagListTests } = require("./taglists.shared");

runTagListTests({
  routeBase: "/player-perspectives",
  listKey: "playerPerspectives",
  responseKey: "playerPerspective",
  humanName: "Player perspective",
  coverPrefix: "player-perspective-covers",
  contentFolder: "player-perspectives",
  ensureFnName: "ensurePlayerPerspectiveExists",
  modulePath: "../../routes/playerperspectives",
  gameField: "playerPerspectives",
});
