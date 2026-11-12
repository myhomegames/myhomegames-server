const {
  compressPathSkeleton,
  compressPathSkeletonBrace,
  compressPathSkeletonSpaces,
  expandCompressedSkeleton,
  expandBraceSkeleton,
  chunkCompressedSkeleton,
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

  test("default compressPathSkeleton uses brace mode", () => {
    const compressed = compressPathSkeleton([
      "root",
      "root/a",
      "root/a/one",
      "root/a/two",
      "root/b",
      "root/b/three",
    ]);
    expect(compressed).toEqual(["root/a/{one,two}", "root/b/three"]);
  });

  test("expandBraceSkeleton restores leaf paths", () => {
    expect(expandBraceSkeleton(["dosprograms/games/x/{O0,O1}"])).toEqual([
      "dosprograms/games/x/O0",
      "dosprograms/games/x/O1",
    ]);
  });
});

describe("chunkCompressedSkeleton", () => {
  test("starts each chunk with a full brace line", () => {
    const compressed = compressPathSkeleton([
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
