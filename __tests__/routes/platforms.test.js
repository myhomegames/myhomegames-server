const { runTagListTests } = require("./taglists.shared");

runTagListTests({
  routeBase: "/platforms",
  listKey: "platforms",
  responseKey: "platform",
  humanName: "Platform",
  coverPrefix: "platform-covers",
  contentFolder: "platforms",
  ensureFnName: "ensurePlatformExists",
  modulePath: "../../routes/platforms",
  gameField: "platforms",
});
