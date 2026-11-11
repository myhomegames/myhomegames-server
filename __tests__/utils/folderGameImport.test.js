const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  guessTitleFromBasename,
  isJunkGameBasename,
  pickBestIgdbMatch,
  isAcceptableIgdbMatch,
  resolveUserFolderPath,
  scanFolderForGameCandidates,
  writeLocalPathLaunchScript,
} = require("../../utils/folderGameImport");

describe("guessTitleFromBasename", () => {
  test("strips extension and dump tags", () => {
    expect(guessTitleFromBasename("Super Mario World (USA).smc")).toBe("Super Mario World");
    expect(guessTitleFromBasename("Zelda_[!]_v1.0.nes")).toBe("Zelda");
  });

  test("normalizes separators", () => {
    expect(guessTitleFromBasename("chrono_trigger-final")).toBe("chrono trigger final");
  });
});

describe("isJunkGameBasename", () => {
  test("flags setup / dosbox / B1 style names", () => {
    expect(isJunkGameBasename("SETUP.EXE")).toBe(true);
    expect(isJunkGameBasename("dosbox.conf")).toBe(true);
    expect(isJunkGameBasename("B1")).toBe(true);
    expect(isJunkGameBasename("B2.SND")).toBe(true);
    expect(isJunkGameBasename("INSTALL.BAT")).toBe(true);
  });

  test("keeps real game names", () => {
    expect(isJunkGameBasename("fallout.sh")).toBe(false);
    expect(isJunkGameBasename("Xonix")).toBe(false);
    expect(isJunkGameBasename("Grand_Prix_Circuit")).toBe(false);
  });
});

describe("pickBestIgdbMatch", () => {
  test("prefers exact case-insensitive name", () => {
    const match = pickBestIgdbMatch("Doom", [
      { id: 1, name: "Doom II" },
      { id: 2, name: "Doom" },
    ]);
    expect(match.id).toBe(2);
  });

  test("prefers platform hint from AI when titles are close", () => {
    const match = pickBestIgdbMatch(
      "Alien Rampage",
      [
        { id: 1, name: "Alien Rampage", platforms: ["PlayStation"] },
        { id: 2, name: "Alien Rampage", platforms: ["DOS", "PC (Microsoft Windows)"] },
      ],
      { platform: "DOS" }
    );
    expect(match.id).toBe(2);
  });

  test("falls back to first hit", () => {
    const match = pickBestIgdbMatch("Unknown Title", [{ id: 9, name: "Something Else" }]);
    expect(match.id).toBe(9);
  });

  test("returns null for empty list", () => {
    expect(pickBestIgdbMatch("Doom", [])).toBeNull();
  });
});

describe("isAcceptableIgdbMatch", () => {
  test("accepts close official titles", () => {
    expect(isAcceptableIgdbMatch("Fallout", { name: "Fallout" })).toBe(true);
    expect(isAcceptableIgdbMatch("Grand Prix Circuit", { name: "Grand Prix Circuit" })).toBe(true);
  });

  test("rejects unrelated first search hit", () => {
    expect(isAcceptableIgdbMatch("SETUP", { name: "Settlers" })).toBe(false);
    expect(isAcceptableIgdbMatch("B1", { name: "Baldur's Gate" })).toBe(false);
  });
});

describe("resolveUserFolderPath", () => {
  test("expands home directory", () => {
    const resolved = resolveUserFolderPath("~/Games");
    expect(resolved).toBe(path.resolve(path.join(os.homedir(), "Games")));
  });

  test("returns empty for blank input", () => {
    expect(resolveUserFolderPath("  ")).toBe("");
  });
});

describe("scanFolderForGameCandidates", () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-folder-import-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("finds nested roms and skips track .bin when .cue exists", () => {
    const nested = path.join(tmpRoot, "SNES");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "Secret of Mana (USA).smc"), "rom");
    const disc = path.join(tmpRoot, "PS1", "Game");
    fs.mkdirSync(disc, { recursive: true });
    fs.writeFileSync(path.join(disc, "Game.cue"), "cue");
    fs.writeFileSync(path.join(disc, "Game.bin"), "bin");

    const found = scanFolderForGameCandidates(tmpRoot);
    expect(found.some((c) => c.title === "Secret of Mana" || /Secret of Mana/.test(c.sourceName))).toBe(
      true
    );
    expect(found.some((c) => c.sourceName === "Game" || c.title === "Game")).toBe(true);
    expect(found.some((c) => /\.bin$/i.test(c.sourceName))).toBe(false);
  });

  test("DOS collection uses game folders + tree, not SETUP executables", () => {
    fs.mkdirSync(path.join(tmpRoot, "games", "Fallout_1997"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "games", "Xonix"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "games", "Grand_Prix_Circuit"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "games", "Fallout_1997", "SETUP.EXE"), "x");
    fs.writeFileSync(path.join(tmpRoot, "games", "Fallout_1997", "FALLOUT.EXE"), "x");
    fs.writeFileSync(path.join(tmpRoot, "games", "Xonix", "XONIX.EXE"), "x");
    fs.writeFileSync(path.join(tmpRoot, "games", "Grand_Prix_Circuit", "GPC.EXE"), "x");
    fs.writeFileSync(path.join(tmpRoot, "scripts", "fallout.sh"), "#!/bin/bash\n");
    fs.writeFileSync(path.join(tmpRoot, "scripts", "xonix.sh"), "#!/bin/bash\n");
    fs.writeFileSync(path.join(tmpRoot, "scripts", "granprixcircuit.sh"), "#!/bin/bash\n");

    const found = scanFolderForGameCandidates(tmpRoot);
    const names = found.map((c) => c.sourceName).sort();
    expect(names).toEqual(["Fallout_1997", "Grand_Prix_Circuit", "Xonix"]);
    expect(found.every((c) => c.kind === "game-folder")).toBe(true);
    expect(found.every((c) => Array.isArray(c.tree) && c.tree.length > 0)).toBe(true);
    expect(found.some((c) => /setup/i.test(c.sourceName))).toBe(false);
    const fallout = found.find((c) => c.sourceName === "Fallout_1997");
    expect(fallout.tree.some((line) => /FALLOUT\.EXE/i.test(line))).toBe(true);
    expect(fallout.tree.some((line) => /SETUP\.EXE/i.test(line))).toBe(true);
    // Launch may use matching script, but naming unit is the folder.
    expect(path.basename(fallout.filePath)).toMatch(/fallout\.sh|Fallout_1997/i);
  });

  test("MAME-style flat ROM folder becomes one candidate per ROM with path tree", () => {
    const mame = path.join(tmpRoot, "roms", "mame");
    fs.mkdirSync(mame, { recursive: true });
    fs.writeFileSync(path.join(mame, "pacman.zip"), "rom");
    fs.writeFileSync(path.join(mame, "dkong.zip"), "rom");

    const found = scanFolderForGameCandidates(tmpRoot);
    expect(found.map((c) => c.sourceName).sort()).toEqual(["dkong.zip", "pacman.zip"]);
    expect(found.every((c) => c.kind === "rom-file")).toBe(true);
    expect(found.find((c) => c.sourceName === "pacman.zip").tree.join("\n")).toMatch(/mame/);
  });

  test("throws ENOENT for missing folder", () => {
    expect(() => scanFolderForGameCandidates(path.join(tmpRoot, "missing"))).toThrow(
      /does not exist/i
    );
  });
});

describe("writeLocalPathLaunchScript", () => {
  let tmpMeta;

  beforeEach(() => {
    tmpMeta = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-meta-"));
  });

  afterEach(() => {
    fs.rmSync(tmpMeta, { recursive: true, force: true });
  });

  test("writes an executable launch script under game scripts", () => {
    const gamePath = path.join(tmpMeta, "Some Game.app");
    const scriptPath = writeLocalPathLaunchScript(tmpMeta, 42, gamePath, {
      label: "Some Game",
    });
    expect(fs.existsSync(scriptPath)).toBe(true);
    const body = fs.readFileSync(scriptPath, "utf8");
    expect(body).toContain(gamePath);
    expect(path.basename(scriptPath)).toMatch(/^01-Some_Game\.(sh|bat)$/);
  });

  test("executes .sh launchers directly", () => {
    const launcher = path.join(tmpMeta, "fallout.sh");
    fs.writeFileSync(launcher, "#!/bin/bash\necho hi\n");
    const scriptPath = writeLocalPathLaunchScript(tmpMeta, 7, launcher, {
      label: "fallout",
      kind: "script",
    });
    const body = fs.readFileSync(scriptPath, "utf8");
    expect(body).toMatch(/exec /);
    expect(body).toContain(launcher);
  });
});
