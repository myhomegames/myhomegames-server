const { runTagListTests } = require("./taglists.shared");

runTagListTests({
  routeBase: "/themes",
  listKey: "themes",
  responseKey: "theme",
  humanName: "Theme",
  coverPrefix: "theme-covers",
  contentFolder: "themes",
  ensureFnName: "ensureThemeExists",
  modulePath: "../../routes/themes",
  gameField: "themes",
});
