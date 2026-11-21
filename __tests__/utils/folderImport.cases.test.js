/**
 * Folder-import regression cases.
 *
 * These cover the AI skeleton scan + identify path used by
 * POST /games/import-from-folder (no live Groq/IGDB).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildCompressedFindSkeleton,
  isAssetEvidenceOnlyChunk,
  isNonGameAssetPath,
} = require("../../utils/pathSkeleton");
const {
  identifyGamesFromSkeleton,
  parseSkeletonIdentifyResponse,
} = require("../../utils/aiGameIdentify");
const {
  findLaunchScriptsForGame,
  normalizeTitleKey,
  writeLocalPathLaunchScript,
} = require("../../utils/folderGameImport");

function makeFlatLaunchFolder(scriptNames) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-import-case-"));
  const folder = path.join(root, "launchers");
  fs.mkdirSync(folder, { recursive: true });
  for (const name of scriptNames) {
    fs.writeFileSync(path.join(folder, name), "#!/bin/sh\necho play\n", { mode: 0o755 });
  }
  return { root, folder };
}

/**
 * Mock completion: one identified game per allowed .sh/.bat that appears in the
 * prompt (ignores example names in the system/user instructions).
 */
function createLaunchScriptIdentifyMock(allowedBasenames) {
  const allowed = new Set(
    (Array.isArray(allowedBasenames) ? allowedBasenames : []).map((n) =>
      String(n).toLowerCase()
    )
  );
  return jest.fn(async ({ messages }) => {
    const prompt = String(messages?.[1]?.content || "");
    const found = [...prompt.matchAll(/\b([\w.-]+\.(?:sh|bat))\b/gi)]
      .map((m) => m[1])
      .filter((name) => allowed.has(name.toLowerCase()));
    const unique = [...new Set(found.map((n) => n.toLowerCase()))];
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              games: unique.map((file) => ({
                path: file,
                title: path.basename(file, path.extname(file)).replace(/[-_]+/g, " "),
                year: 1990,
                platform: "DOS",
                confidence: 0.95,
              })),
            }),
          },
        },
      ],
    };
  });
}

describe("folder import cases", () => {
  /**
   * Marked successful: importing a flat folder of launch scripts
   * (real-world: …/dosprograms/scripts — name must not matter).
   * Regression: without sibling batches the AI returned ~12–25 of 300+.
   */
  describe("case: flat launch-script folder import succeeds", () => {
    let tmpRoot;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
      }
    });

    test("scans, chunks ≤20 siblings, and identifies every .sh", async () => {
      const scriptCount = 45;
      const names = Array.from({ length: scriptCount }, (_, i) => {
        const slug = `game${String(i).padStart(2, "0")}`;
        return `${slug}.sh`;
      });
      const made = makeFlatLaunchFolder(names);
      tmpRoot = made.root;

      const skeleton = buildCompressedFindSkeleton(made.folder, {
        maxChars: Math.max(1500, Math.floor(4500 * 0.75)),
        maxLaunchScriptSiblings: 20,
      });

      expect(skeleton.pathCount).toBeGreaterThanOrEqual(scriptCount);
      expect(skeleton.chunks.length).toBe(Math.ceil(scriptCount / 20));
      for (const chunk of skeleton.chunks) {
        const scriptsInChunk = (chunk.match(/\.sh\b/gi) || []).length;
        expect(scriptsInChunk).toBeGreaterThan(0);
        expect(scriptsInChunk).toBeLessThanOrEqual(20);
      }

      const create = createLaunchScriptIdentifyMock(names);
      const identified = await identifyGamesFromSkeleton(skeleton, {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
        chunkGapMs: 0,
      });

      expect(identified.used).toBe(true);
      expect(identified.error).toBeFalsy();
      expect(identified.stats.apiCalls).toBe(skeleton.chunks.length);
      expect(identified.games).toHaveLength(scriptCount);

      const byBase = new Set(
        identified.games.map((g) => path.basename(String(g.path || "")).toLowerCase())
      );
      expect([...byBase].sort()).toEqual([...names].map((n) => n.toLowerCase()).sort());

      for (const game of identified.games) {
        expect(game.absPath).toBe(path.join(made.folder, path.basename(game.path)));
        expect(game.pathMissing).toBe(false);
        expect(game.platform).toBe("DOS");
        expect(game.confidence).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  /**
   * Mid-import resume: AI first picks a cd/*.GOG dump (no collection launcher),
   * game is created with that title and empty scripts/. Later the same title
   * arrives with games/<folder> → import treats it as exists and re-attaches
   * scripts/ launchers (import-from-folder attachLaunchersWithoutCatalog path).
   */
  describe("case: cd dump first, game folder later re-attaches launchers", () => {
    let tmpRoot;
    let metadataPath;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
      }
      if (metadataPath) {
        fs.rmSync(metadataPath, { recursive: true, force: true });
        metadataPath = null;
      }
    });

    test("GOG path finds no launcher; same title on game folder attaches scripts/", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-carpet-layout-"));
      const collection = path.join(tmpRoot, "dosprograms");
      const cdFile = path.join(collection, "cd", "magicarpetplus.GOG");
      const gameDir = path.join(collection, "games", "magiccarpetplus");
      const scriptsDir = path.join(collection, "scripts");
      fs.mkdirSync(path.dirname(cdFile), { recursive: true });
      fs.mkdirSync(gameDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(cdFile, "fake-gog-iso");
      fs.writeFileSync(path.join(gameDir, "dosbox.conf"), "[autoexec]\n");
      const launcherPath = path.join(scriptsDir, "magiccarpetplus.sh");
      fs.writeFileSync(
        launcherPath,
        `#!/bin/sh\nexec /usr/bin/true -conf ${gameDir}/dosbox.conf\n`,
        { mode: 0o755 }
      );

      // Phase 1 — AI path is the cd dump: no .sh/.bat → nothing to attach.
      expect(findLaunchScriptsForGame(cdFile)).toEqual([]);

      metadataPath = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-carpet-meta-"));
      const gameId = 1795068774222;
      const gameMetaDir = path.join(metadataPath, "content", "games", String(gameId));
      fs.mkdirSync(gameMetaDir, { recursive: true });
      const title = "Magic Carpet 2";
      fs.writeFileSync(
        path.join(gameMetaDir, "metadata.json"),
        JSON.stringify({ id: gameId, title, platforms: [13] }, null, 2)
      );
      expect(fs.existsSync(path.join(gameMetaDir, "scripts"))).toBe(false);

      // Phase 2 — same title, better abs path (games folder): exists → re-attach.
      const titleKeyEarly = normalizeTitleKey(title);
      const titleKeyLater = normalizeTitleKey("Magic Carpet 2");
      expect(titleKeyLater).toBe(titleKeyEarly);

      const launchers = findLaunchScriptsForGame(gameDir);
      expect(launchers.map((l) => l.path)).toContain(launcherPath);
      expect(launchers.some((l) => l.label === "magiccarpetplus")).toBe(true);

      for (const launcher of launchers) {
        writeLocalPathLaunchScript(metadataPath, gameId, launcher.path, {
          label: launcher.label,
          kind: "script",
          platformId: "13",
        });
      }

      const attached = fs
        .readdirSync(path.join(gameMetaDir, "scripts"))
        .filter((f) => /\.(sh|bat)$/i.test(f));
      expect(attached.length).toBeGreaterThanOrEqual(1);
      expect(attached.some((f) => /magiccarpetplus/i.test(f))).toBe(true);

      const body = fs.readFileSync(
        path.join(gameMetaDir, "scripts", attached.find((f) => /magiccarpetplus/i.test(f))),
        "utf8"
      );
      expect(body).toContain(launcherPath);

      // exists/re-attach again must not duplicate wrappers (Lemmings/Battle Chess bug).
      const before = fs
        .readdirSync(path.join(gameMetaDir, "scripts"))
        .filter((f) => /\.(sh|bat)$/i.test(f));
      for (const launcher of launchers) {
        writeLocalPathLaunchScript(metadataPath, gameId, launcher.path, {
          label: launcher.label,
          kind: "script",
          platformId: "13",
        });
      }
      const after = fs
        .readdirSync(path.join(gameMetaDir, "scripts"))
        .filter((f) => /\.(sh|bat)$/i.test(f));
      expect(after).toEqual(before);
    });

    test("different AI title later does not share titleKey (second game, no exists re-attach)", () => {
      // First import titled "Magic Carpet 2" from cd dump; later chunk says "Magic Carpet Plus".
      expect(normalizeTitleKey("Magic Carpet 2")).not.toBe(
        normalizeTitleKey("Magic Carpet Plus")
      );
      expect(normalizeTitleKey("Magic Carpet 2")).toBe("magiccarpet2");
      expect(normalizeTitleKey("Magic Carpet Plus")).toBe("magiccarpetplus");
    });
  });

  /**
   * Collection scripts/ name match uses substring equality on normalized keys.
   * games/MagicCarpet therefore also matches asterixmagiccarpet / magiccarpet2 /
   * magiccarpetplus — observed during dosprograms import (over-attach).
   */
  describe("case: scripts/ fuzzy name match is overly broad for MagicCarpet", () => {
    let tmpRoot;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
      }
    });

    test("MagicCarpet folder matches unrelated carpet* launchers by substring", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-carpet-fuzzy-"));
      const collection = path.join(tmpRoot, "dosprograms");
      const gameDir = path.join(collection, "games", "MagicCarpet");
      const otherPlus = path.join(collection, "games", "magiccarpetplus");
      const otherMc2 = path.join(collection, "games", "mc2");
      const scriptsDir = path.join(collection, "scripts");
      fs.mkdirSync(gameDir, { recursive: true });
      fs.mkdirSync(otherPlus, { recursive: true });
      fs.mkdirSync(otherMc2, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(gameDir, "dosbox.conf"), "[autoexec]\n");
      fs.writeFileSync(path.join(otherPlus, "dosbox.conf"), "[autoexec]\n");
      fs.writeFileSync(path.join(otherMc2, "dosbox.conf"), "[autoexec]\n");

      const magiccarpet = path.join(scriptsDir, "magiccarpet.sh");
      const asterix = path.join(scriptsDir, "asterixmagiccarpet.sh");
      const mc2 = path.join(scriptsDir, "magiccarpet2.sh");
      const plus = path.join(scriptsDir, "magiccarpetplus.sh");
      fs.writeFileSync(
        magiccarpet,
        `#!/bin/sh\nexec /usr/bin/true -conf ${gameDir}/dosbox.conf\n`,
        { mode: 0o755 }
      );
      fs.writeFileSync(asterix, "#!/bin/sh\nexec /usr/bin/true\n", { mode: 0o755 });
      fs.writeFileSync(
        mc2,
        `#!/bin/sh\nexec /usr/bin/true -conf ${otherMc2}/dosbox.conf\n`,
        { mode: 0o755 }
      );
      fs.writeFileSync(
        plus,
        `#!/bin/sh\nexec /usr/bin/true -conf ${otherPlus}/dosbox.conf\n`,
        { mode: 0o755 }
      );

      const found = findLaunchScriptsForGame(gameDir);
      const labels = found.map((f) => f.label).sort();
      // Exact + fuzzy substring hits (current behavior — pins over-matching).
      expect(labels).toEqual(
        ["asterixmagiccarpet", "magiccarpet", "magiccarpet2", "magiccarpetplus"].sort()
      );
      // Content-only would prefer magiccarpet.sh; fuzzy still pulls the others in.
      expect(found.map((f) => f.path)).toContain(magiccarpet);
      expect(found.map((f) => f.path)).toContain(asterix);
    });

    test("mc2 folder attaches magiccarpet2.sh via content path, not folder-name equality", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-mc2-"));
      const collection = path.join(tmpRoot, "dosprograms");
      const gameDir = path.join(collection, "games", "mc2");
      const scriptsDir = path.join(collection, "scripts");
      fs.mkdirSync(gameDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(gameDir, "dosbox.conf"), "[autoexec]\n");
      const launcher = path.join(scriptsDir, "magiccarpet2.sh");
      fs.writeFileSync(
        launcher,
        `#!/bin/sh\nexec /usr/bin/true -conf ${gameDir}/dosbox.conf\n`,
        { mode: 0o755 }
      );
      // Unrelated carpet script must not match folder "mc2" by name.
      fs.writeFileSync(
        path.join(scriptsDir, "magiccarpet.sh"),
        "#!/bin/sh\nexec /usr/bin/true\n",
        { mode: 0o755 }
      );

      const found = findLaunchScriptsForGame(gameDir);
      expect(found.map((f) => f.label)).toEqual(["magiccarpet2"]);
      expect(found[0].path).toBe(launcher);
    });
  });

  /**
   * Voice packs under an install (winginstall/TALK) stay as compact evidence so the
   * parent game can still be recognized; .P0x / TALK leaves must not become games.
   */
  describe("case: voice-pack assets are evidence, not games", () => {
    let tmpRoot;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
      }
    });

    test("compacts TALK clips and keeps BAT launchers in the skeleton", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-wing-"));
      const wing = path.join(tmpRoot, "dosprograms", "cd", "winginstall");
      const talk = path.join(wing, "TALK", "ACKBAR");
      fs.mkdirSync(talk, { recursive: true });
      fs.writeFileSync(path.join(wing, "XWINGCD.BAT"), "@echo xwing\n");
      fs.writeFileSync(path.join(wing, "XWINGCD2.BAT"), "@echo xwing2\n");
      for (let i = 0; i < 40; i += 1) {
        fs.writeFileSync(path.join(talk, `CLIP${i}.P02`), "x");
      }

      const sk = buildCompressedFindSkeleton(path.join(tmpRoot, "dosprograms"), {
        maxChars: 8000,
        maxLaunchScriptSiblings: 20,
      });
      const joined = sk.chunks.join("\n");
      expect(joined).toMatch(/XWINGCD\.BAT/i);
      expect(joined).toMatch(/TALK/i);
      expect(joined).toMatch(/\.\.\.\(\d+\s+assets?\)/i);
      expect(joined).not.toMatch(/CLIP0\.P02/i);
      expect(joined).not.toMatch(/HELLO\.P02/i);
    });

    test("asset-only chunks are detected; .P0x AI paths are dropped", () => {
      expect(
        isAssetEvidenceOnlyChunk(
          "dosprograms{cd{winginstall{TALK{ACKBAR{...(40 assets)}}}}}"
        )
      ).toBe(true);
      expect(
        isAssetEvidenceOnlyChunk(
          "dosprograms{cd{winginstall{XWINGCD.BAT,TALK{...(40 assets)}}}}"
        )
      ).toBe(false);

      expect(isNonGameAssetPath("cd/winginstall/TALK/ACKBAR/HELLO.P02")).toBe(true);
      expect(isNonGameAssetPath("cd/winginstall/TALK/ACKBAR")).toBe(true);
      expect(isNonGameAssetPath("cd/winginstall")).toBe(false);
      expect(isNonGameAssetPath("cd/winginstall/XWINGCD.BAT")).toBe(false);

      const parsed = parseSkeletonIdentifyResponse(
        JSON.stringify({
          games: [
            {
              path: "cd/winginstall/TALK/ACKBAR/HELLO.P02",
              title: "Hello",
              year: null,
              platform: "DOS",
              confidence: 0.9,
            },
            {
              path: "cd/winginstall",
              title: "X-Wing",
              year: 1993,
              platform: "DOS",
              confidence: 0.95,
            },
          ],
        }),
        path.join("/tmp", "dosprograms")
      );
      expect(parsed.map((g) => g.title)).toEqual(["X-Wing"]);
    });

    test("identify skips asset-evidence-only chunks without calling the model", async () => {
      const create = jest.fn(async () => {
        throw new Error("model should not be called for asset-only chunks");
      });
      const out = await identifyGamesFromSkeleton(
        {
          rootPath: path.join("/tmp", "dosprograms"),
          rootName: "dosprograms",
          chunks: ["dosprograms{cd{winginstall{TALK{ACKBAR{HELLO.P02,DSTAR1.P02}}}}}"],
        },
        {
          env: { OPENAI_API_KEY: "sk-test" },
          client: { chat: { completions: { create } } },
          chunkGapMs: 0,
        }
      );
      expect(out.used).toBe(true);
      expect(create).not.toHaveBeenCalled();
      expect(out.games).toEqual([]);
    });
  });

  /**
   * Opaque DOS folders (COLC) and ISO dumps: title evidence in the prompt,
   * bulk media compacted, ISO+unpacked collapsed to one retail title.
   */
  describe("case: title evidence and lean skeletons", () => {
    let tmpRoot;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
      }
    });

    function writeMinimalIso(filePath, { volumeId = "TEST", application = "" } = {}) {
      const sector = 2048;
      const buf = Buffer.alloc(17 * sector, 0);
      const pvd = Buffer.alloc(sector, 0x20);
      pvd[0] = 1;
      pvd.write("CD001", 1, "ascii");
      pvd.write(String(volumeId).padEnd(32).slice(0, 32), 40, "ascii");
      pvd.write(String(application).padEnd(128).slice(0, 128), 574, "ascii");
      pvd.copy(buf, 16 * sector);
      fs.writeFileSync(filePath, buf);
    }

    test("COLC skeleton keeps file_id.diz and compacts LANGE media trees", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-colc-sk-"));
      const root = path.join(tmpRoot, "dosprograms");
      const colc = path.join(root, "games", "COLC");
      const lange = path.join(colc, "LANGE", "S101");
      fs.mkdirSync(lange, { recursive: true });
      fs.writeFileSync(path.join(colc, "CITE.EXE"), "x");
      fs.writeFileSync(
        path.join(colc, "file_id.diz"),
        "Name:City of Lost Children, The\nYear:1997\nPublisher:Psygnosis Limited\n"
      );
      for (let i = 0; i < 20; i += 1) {
        fs.writeFileSync(path.join(lange, `101PE${i}.WAV`), "x");
      }

      const sk = buildCompressedFindSkeleton(root, { maxChars: 8000 });
      const joined = sk.chunks.join("\n");
      expect(joined).toMatch(/CITE\.EXE/i);
      expect(joined).toMatch(/file_id\.diz/i);
      expect(joined).toMatch(/LANGE/i);
      expect(joined).toMatch(/\.\.\.\(\d+\s+assets?\)/i);
      expect(joined).not.toMatch(/101PE0\.WAV/i);
      // Listing is much smaller than expanding every WAV.
      expect(joined.length).toBeLessThan(2500);
    });

    test("identify prompt includes COLC file_id.diz evidence for naming", async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-colc-ai-"));
      const root = path.join(tmpRoot, "dosprograms");
      const colc = path.join(root, "games", "COLC");
      fs.mkdirSync(colc, { recursive: true });
      fs.writeFileSync(path.join(colc, "CITE.EXE"), "x");
      fs.writeFileSync(
        path.join(colc, "file_id.diz"),
        "Name:City of Lost Children, The\nYear:1997\n"
      );

      const sk = buildCompressedFindSkeleton(root, { maxChars: 8000 });
      const create = jest.fn(async ({ messages }) => {
        const prompt = String(messages[1].content);
        expect(prompt).toMatch(/Title evidence/i);
        expect(prompt).toMatch(/City of Lost Children/i);
        expect(prompt).toMatch(/Prefer Title evidence/i);
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  games: [
                    {
                      path: "games/COLC",
                      title: "The City of Lost Children",
                      year: 1997,
                      platform: "DOS",
                      confidence: 0.95,
                    },
                  ],
                }),
              },
            },
          ],
        };
      });

      const out = await identifyGamesFromSkeleton(sk, {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
        chunkGapMs: 0,
      });
      expect(create).toHaveBeenCalled();
      expect(out.games).toHaveLength(1);
      expect(out.games[0].title).toMatch(/City of Lost Children/i);
    });

    test("ISO PVD evidence is attached and ISO+unpacked merge to one title", async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ai130-"));
      const root = path.join(tmpRoot, "dosprograms");
      const cd = path.join(root, "cd");
      const unpacked = path.join(root, "games", "alienincident");
      fs.mkdirSync(cd, { recursive: true });
      fs.mkdirSync(unpacked, { recursive: true });
      writeMinimalIso(path.join(cd, "AI130.iso"), {
        volumeId: "AI130",
        application: "Alien Incident v1.11",
      });
      fs.writeFileSync(path.join(unpacked, "AI.EXE"), "x");
      fs.writeFileSync(
        path.join(unpacked, "file_id.diz"),
        "Name:Alien Incident\nYear:1996\n"
      );

      const sk = buildCompressedFindSkeleton(root, { maxChars: 8000 });
      const create = jest.fn(async ({ messages }) => {
        const prompt = String(messages[1].content);
        const games = [];
        if (/AI130\.iso/i.test(prompt)) {
          expect(prompt).toMatch(/Alien Incident/i);
          games.push({
            path: "cd/AI130.iso",
            title: "Alien Incident",
            year: 1996,
            platform: "DOS",
            confidence: 0.85,
          });
        }
        if (/alienincident/i.test(prompt)) {
          expect(prompt).toMatch(/Alien Incident/i);
          games.push({
            path: "games/alienincident",
            title: "Alien Incident",
            year: 1996,
            platform: "DOS",
            confidence: 0.95,
          });
        }
        return {
          choices: [{ message: { content: JSON.stringify({ games }) } }],
        };
      });

      const imported = [];
      const out = await identifyGamesFromSkeleton(sk, {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
        chunkGapMs: 0,
        onChunkGames: async (games) => {
          imported.push(...games.map((g) => ({ path: g.path, title: g.title })));
        },
      });

      expect(out.games).toHaveLength(1);
      expect(out.games[0].title).toBe("Alien Incident");
      expect(out.games[0].path).toBe("games/alienincident");
      expect(out.games[0].alternatePaths || []).toEqual(
        expect.arrayContaining(["cd/AI130.iso"])
      );
      // Both paths were offered to the importer (re-attach), same retail title.
      const titles = new Set(imported.map((g) => normalizeTitleKey(g.title)));
      expect(titles.has("alienincident")).toBe(true);
      expect([...titles]).toHaveLength(1);
    });
  });
});
