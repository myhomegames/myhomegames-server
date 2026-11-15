const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  getExecutablesWithOrder,
  syncGameExecutablesFromDisk,
} = require("../../utils/gameExecutables");

describe("gameExecutables", () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-exec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeScript(gameId, fileName) {
    const scriptsDir = path.join(tmpRoot, "content", "games", String(gameId), "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, fileName), "#!/bin/sh\n", "utf8");
  }

  test("getExecutablesWithOrder reads labels from disk in N- order", () => {
    writeScript(42, "02-second.sh");
    writeScript(42, "01-first-6.sh");
    expect(getExecutablesWithOrder(tmpRoot, 42)).toEqual(["first", "second"]);
  });

  test("getExecutablesWithOrder returns [] when scripts were removed", () => {
    expect(getExecutablesWithOrder(tmpRoot, 99)).toEqual([]);
  });

  test("syncGameExecutablesFromDisk clears stale in-memory executables", () => {
    const game = { id: 7, title: "X", executables: ["stale"] };
    expect(syncGameExecutablesFromDisk(tmpRoot, game)).toBeNull();
    expect(game.executables).toBeUndefined();
  });

  test("syncGameExecutablesFromDisk updates game when scripts exist", () => {
    writeScript(7, "01-play.sh");
    const game = { id: 7, title: "X", executables: ["stale"] };
    expect(syncGameExecutablesFromDisk(tmpRoot, game)).toEqual(["play"]);
    expect(game.executables).toEqual(["play"]);
  });
});
