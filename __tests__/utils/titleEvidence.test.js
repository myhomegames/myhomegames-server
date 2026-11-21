"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  collectTitleEvidence,
  collectChunkTitleEvidence,
  readIso9660VolumeHints,
  mergeGamesByTitleKey,
  preferGameIdentity,
  isEvidenceFileName,
} = require("../../utils/titleEvidence");
const { normalizeTitleKey } = require("../../utils/folderGameImport");

/** Minimal ISO 9660 image with a Primary Volume Descriptor at sector 16. */
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

describe("titleEvidence", () => {
  let tmpRoot;

  afterEach(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  test("isEvidenceFileName recognizes file_id.diz and README", () => {
    expect(isEvidenceFileName("file_id.diz")).toBe(true);
    expect(isEvidenceFileName("README.TXT")).toBe(true);
    expect(isEvidenceFileName("game.nfo")).toBe(true);
    expect(isEvidenceFileName("CITE.EXE")).toBe(false);
  });

  test("collectTitleEvidence reads COLC-style file_id.diz", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-colc-"));
    const colc = path.join(tmpRoot, "COLC");
    fs.mkdirSync(colc);
    fs.writeFileSync(path.join(colc, "CITE.EXE"), "x");
    fs.writeFileSync(
      path.join(colc, "file_id.diz"),
      "City of Lost Children, The [a1]\nName:City of Lost Children, The\nYear:1997\nPublisher:Psygnosis Limited\n"
    );

    const out = collectTitleEvidence(colc);
    expect(out.hints.length).toBeGreaterThanOrEqual(1);
    expect(out.hints[0].source).toBe("file_id.diz");
    expect(out.hints[0].text).toMatch(/City of Lost Children/i);
    expect(out.hints[0].text).toMatch(/1997/);
  });

  test("readIso9660VolumeHints exposes Alien Incident application id", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-iso-"));
    const iso = path.join(tmpRoot, "AI130.iso");
    writeMinimalIso(iso, {
      volumeId: "AI130",
      application: "Alien Incident v1.11",
    });

    const hints = readIso9660VolumeHints(iso);
    expect(hints).toBeTruthy();
    expect(hints.volumeId).toMatch(/AI130/);
    expect(hints.application).toMatch(/Alien Incident/i);

    const collected = collectTitleEvidence(iso);
    expect(collected.hints[0].text).toMatch(/Alien Incident/i);
  });

  test("collectChunkTitleEvidence attaches hints only for paths in the chunk", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ev-chunk-"));
    const root = path.join(tmpRoot, "dosprograms");
    const colc = path.join(root, "games", "COLC");
    const other = path.join(root, "games", "OTHER");
    fs.mkdirSync(colc, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(
      path.join(colc, "file_id.diz"),
      "Name:City of Lost Children, The\nYear:1997\n"
    );
    fs.writeFileSync(path.join(other, "file_id.diz"), "Name:Should Not Appear\n");
    fs.writeFileSync(path.join(colc, "CITE.EXE"), "x");

    const findPaths = [
      "dosprograms",
      "dosprograms/games",
      "dosprograms/games/COLC",
      "dosprograms/games/COLC/CITE.EXE",
      "dosprograms/games/COLC/file_id.diz",
      "dosprograms/games/OTHER",
      "dosprograms/games/OTHER/file_id.diz",
    ];
    const chunk = "dosprograms{games{COLC{CITE.EXE,file_id.diz}}}";
    const text = collectChunkTitleEvidence(root, chunk, findPaths, {
      listingPrefix: "dosprograms",
    });
    expect(text).toMatch(/City of Lost Children/i);
    expect(text).not.toMatch(/Should Not Appear/);
  });

  test("mergeGamesByTitleKey collapses ISO + unpacked and prefers folder root", () => {
    const merged = mergeGamesByTitleKey(
      [
        {
          path: "cd/AI130.iso",
          title: "Alien Incident",
          year: 1996,
          platform: "DOS",
          confidence: 0.7,
        },
        {
          path: "games/alienincident",
          title: "Alien Incident",
          year: 1996,
          platform: "DOS",
          confidence: 0.9,
        },
        {
          path: "games/alienincident/GAMES/AI/SETUP.BAT",
          title: "Alien Incident",
          confidence: 0.6,
        },
      ],
      normalizeTitleKey
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].path).toBe("games/alienincident");
    expect(merged[0].alternatePaths).toEqual(
      expect.arrayContaining(["cd/AI130.iso", "games/alienincident/GAMES/AI/SETUP.BAT"])
    );
    expect(merged[0].confidence).toBe(0.9);
  });

  test("preferGameIdentity favors shallower directories over deep files", () => {
    const winner = preferGameIdentity(
      { path: "games/COLC/CITE.EXE", confidence: 0.9 },
      { path: "games/COLC", confidence: 0.85 }
    );
    expect(winner.path).toBe("games/COLC");
  });
});
