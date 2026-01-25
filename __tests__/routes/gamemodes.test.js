const { runTagListTests } = require("./taglists.shared");

runTagListTests({
  routeBase: "/game-modes",
  listKey: "gameModes",
  responseKey: "gameMode",
  humanName: "Game mode",
  coverPrefix: "game-mode-covers",
  contentFolder: "game-modes",
  ensureFnName: "ensureGameModeExists",
  modulePath: "../../routes/gamemodes",
  gameField: "gameModes",
});
