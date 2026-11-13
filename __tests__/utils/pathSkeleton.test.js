const {
  compressPathSkeleton,
  compressPathSkeletonBrace,
  compressPathSkeletonNested,
  compressPathSkeletonSpaces,
  expandCompressedSkeleton,
  expandBraceSkeleton,
  chunkCompressedSkeleton,
  chunkNestedSkeleton,
  splitNestedBraceInHalf,
  splitOversizedSkeletonChunk,
  buildNestedTreeFromPaths,
  skeletonPathToAbsolute,
  commonDirPrefixLength,
} = require("../../utils/pathSkeleton");
const path = require("path");

describe("compressPathSkeletonSpaces", () => {
  test("elides repeated directory prefixes with spaces (legacy example)", () => {
    const compressed = compressPathSkeletonSpaces([
      "dosprograms/games/ancient-art-of-war/O1",
      "dosprograms/games/ancient-art-of-war/O0",
      "dosprograms/games/ancient-art-of-war/O7",
    ]);
    expect(compressed[0]).toBe("dosprograms/games/ancient-art-of-war/O1");
    expect(compressed[1]).toBe("                                     O0");
    expect(compressed[2]).toBe("                                     O7");
    expect(expandCompressedSkeleton(compressed)).toEqual([
      "dosprograms/games/ancient-art-of-war/O1",
      "dosprograms/games/ancient-art-of-war/O0",
      "dosprograms/games/ancient-art-of-war/O7",
    ]);
  });
});

describe("compressPathSkeletonBrace", () => {
  test("groups sibling leaves as parent/{a,b,c}", () => {
    const compressed = compressPathSkeletonBrace([
      "dosprograms",
      "dosprograms/games",
      "dosprograms/games/ancient-art-of-war",
      "dosprograms/games/ancient-art-of-war/O1",
      "dosprograms/games/ancient-art-of-war/O0",
      "dosprograms/games/ancient-art-of-war/O7",
    ]);
    expect(compressed).toContain("dosprograms/games/ancient-art-of-war/{O0,O1,O7}");
  });

  test("expandBraceSkeleton restores leaf paths", () => {
    expect(expandBraceSkeleton(["dosprograms/games/x/{O0,O1}"])).toEqual([
      "dosprograms/games/x/O0",
      "dosprograms/games/x/O1",
    ]);
  });
});

describe("compressPathSkeletonNested", () => {
  test("nests directories as a{b{c{…}}}", () => {
    const compressed = compressPathSkeletonNested([
      "dosprograms",
      "dosprograms/games",
      "dosprograms/games/night-shift",
      "dosprograms/games/night-shift/night",
      "dosprograms/games/night-shift/night/INSTALL.BAT",
      "dosprograms/games/night-shift/night/DISK_1.CMP",
      "dosprograms/games/night-shift/night/BEAST_2.CMP",
      "dosprograms/games/night-shift/night/DELTA_9.CMP",
      "dosprograms/games/night-shift/night/BEAST_3.CMP",
      "dosprograms/games/night-shift/night/BEAST_1.CMP",
      "dosprograms/games/night-shift/night/DELTA_19.CMP",
      "dosprograms/games/night-shift/night/DELTA_27.CMP",
      "dosprograms/games/midnightresque",
      "dosprograms/games/midnightresque/DATTRIB.GRA",
      "dosprograms/games/midnightresque/SSR.TGA",
      "dosprograms/games/midnightresque/CLOSE.GRA",
      "dosprograms/games/midnightresque/DMENUS.GRA",
      "dosprograms/games/midnightresque/DOPEN.GRA",
      "dosprograms/games/midnightresque/dosbox.conf",
    ]);
    expect(compressed).toHaveLength(1);
    expect(compressed[0]).toBe(
      "dosprograms{games{midnightresque{CLOSE.GRA,DATTRIB.GRA,DMENUS.GRA,DOPEN.GRA,dosbox.conf,SSR.TGA},night-shift{night{BEAST_1.CMP,BEAST_2.CMP,BEAST_3.CMP,DELTA_19.CMP,DELTA_27.CMP,DELTA_9.CMP,DISK_1.CMP,INSTALL.BAT}}}}"
    );
  });

  test("default compressPathSkeleton uses nested mode", () => {
    const compressed = compressPathSkeleton([
      "root",
      "root/a",
      "root/a/one",
      "root/a/two",
      "root/b",
      "root/b/three",
    ]);
    expect(compressed).toEqual(["root{a{one,two},b{three}}"]);
  });
});

describe("chunkNestedSkeleton", () => {
  test("splits oversized nested trees into multiple rooted chunks", () => {
    const tree = buildNestedTreeFromPaths([
      "root",
      "root/a",
      "root/a/one",
      "root/a/two",
      "root/b",
      "root/b/three",
      "root/c",
      "root/c/four",
    ]);
    const chunks = chunkNestedSkeleton(tree, "root", 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith("root{")).toBe(true);
    }
  });
});

describe("splitNestedBraceInHalf / splitOversizedSkeletonChunk", () => {
  test("halves a nested one-liner by top-level siblings", () => {
    const chunk = "dosprograms{games{a{1},b{2},c{3},d{4}}}";
    const halves = splitNestedBraceInHalf(chunk);
    expect(halves).toEqual([
      "dosprograms{games{a{1},b{2}}}",
      "dosprograms{games{c{3},d{4}}}",
    ]);
  });

  test("recurses when the outer body has a single child", () => {
    const chunk = "root{only{a,b,c,d}}";
    const halves = splitNestedBraceInHalf(chunk);
    expect(halves).toEqual(["root{only{a,b}}", "root{only{c,d}}"]);
  });

  test("splitOversizedSkeletonChunk prefers line splits then nested", () => {
    expect(splitOversizedSkeletonChunk("a\nb\nc")).toEqual(["a\nb", "c"]);
    expect(splitOversizedSkeletonChunk("root{a,b}")).toEqual(["root{a}", "root{b}"]);
  });
});

describe("chunkCompressedSkeleton", () => {
  test("starts each chunk with a full brace line", () => {
    const compressed = compressPathSkeletonBrace([
      "root/a/one",
      "root/a/two",
      "root/b/three",
      "root/b/four",
      "root/c/five",
      "root/c/six",
    ]);
    const chunks = chunkCompressedSkeleton(compressed, 28);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const first = chunk.split("\n")[0];
      expect(first.startsWith(" ")).toBe(false);
      expect(first.startsWith("root/")).toBe(true);
    }
  });
});

describe("skeletonPathToAbsolute", () => {
  test("maps skeleton path under chosen root", () => {
    const root = path.join("/Volumes/Elements/Dropbox/private", "dosprograms");
    expect(skeletonPathToAbsolute(root, "dosprograms/games/alleycat")).toBe(
      path.join(root, "games", "alleycat")
    );
    expect(skeletonPathToAbsolute(root, "dosprograms")).toBe(root);
  });
});

describe("commonDirPrefixLength", () => {
  test("cuts on directory boundary", () => {
    expect(
      commonDirPrefixLength(
        "dosprograms/games/ancient-art-of-war/O1",
        "dosprograms/games/ancient-art-of-war/O0"
      )
    ).toBe("dosprograms/games/ancient-art-of-war/".length);
  });
});
