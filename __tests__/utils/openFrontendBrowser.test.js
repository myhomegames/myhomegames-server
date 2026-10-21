const { urlMatchesFrontend, openFrontendUrl } = require("../../utils/openFrontendBrowser");

describe("urlMatchesFrontend", () => {
  const target = "https://myhomegames.vige.it/app/";

  it("matches the app and its routes", () => {
    expect(urlMatchesFrontend("https://myhomegames.vige.it/app/", target)).toBe(true);
    expect(urlMatchesFrontend("https://myhomegames.vige.it/app", target)).toBe(true);
    expect(urlMatchesFrontend("https://myhomegames.vige.it/app/#/library", target)).toBe(true);
    expect(urlMatchesFrontend("https://myhomegames.vige.it/app/games?id=1", target)).toBe(true);
  });

  it("ignores a different page on the same host", () => {
    expect(urlMatchesFrontend("https://myhomegames.vige.it/", target)).toBe(false);
    expect(urlMatchesFrontend("https://myhomegames.vige.it/application", target)).toBe(false);
    expect(urlMatchesFrontend("https://example.com/app/", target)).toBe(false);
  });
});

describe("openFrontendUrl", () => {
  function fakeSpawn() {
    const calls = [];
    const spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { on() {}, unref() {} };
    };
    return { spawn, calls };
  }

  it("focuses an existing tab and does not open another page", () => {
    const { spawn, calls } = fakeSpawn();
    const log = jest.fn();
    const opened = openFrontendUrl("https://localhost:5173/app/", {
      platform: "darwin",
      spawn,
      log,
      focusExisting: () => true,
    });
    expect(opened).toBe(true);
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith("Browser already open at https://localhost:5173/app/");
  });

  it("opens the default browser when no tab matches", () => {
    const { spawn, calls } = fakeSpawn();
    const opened = openFrontendUrl("https://localhost:5173/app/", {
      platform: "darwin",
      spawn,
      log: () => {},
      focusExisting: () => false,
    });
    expect(opened).toBe(true);
    expect(calls).toEqual([
      { cmd: "open", args: ["https://localhost:5173/app/"], opts: { detached: true, stdio: "ignore" } },
    ]);
  });

  it("does nothing when FRONTEND_URL is missing", () => {
    const { spawn, calls } = fakeSpawn();
    expect(openFrontendUrl("", { spawn, focusExisting: () => true })).toBe(false);
    expect(calls).toEqual([]);
  });
});
