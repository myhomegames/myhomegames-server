const { runTagListTests } = require("./taglists.shared");

runTagListTests({
  routeBase: "/game-engines",
  listKey: "gameEngines",
  responseKey: "gameEngine",
  humanName: "Game engine",
  coverPrefix: "game-engine-covers",
  contentFolder: "game-engines",
  ensureFnName: "ensureGameEngineExists",
  modulePath: "../../routes/gameengines",
  gameField: "gameEngines",
});
