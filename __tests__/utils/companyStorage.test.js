const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadRoleItems,
  loadRoleItemById,
  saveRoleItem,
  deleteRoleItem,
  getRoleToGameIdsMap,
  migrateLegacyRoleMetadata,
  linkCompanyUnderParent,
  removeGameFromAllRoleItems,
  pruneOrphanRoleItems,
} = require("../../utils/companyStorage");

describe("companyStorage", () => {
  let metadataPath;

  beforeEach(() => {
    metadataPath = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-companies-"));
    fs.mkdirSync(path.join(metadataPath, "content", "developers"), { recursive: true });
    fs.mkdirSync(path.join(metadataPath, "content", "publishers"), { recursive: true });
    fs.mkdirSync(path.join(metadataPath, "content", "companies"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(metadataPath, { recursive: true, force: true });
  });

  test("saveRoleItem stores profile in companies and games in developers", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 37,
      title: "LucasArts",
      summary: "Studio",
      games: [101, 102],
      childs: [],
      showTitle: true,
    });

    const companyMeta = JSON.parse(
      fs.readFileSync(path.join(metadataPath, "content", "companies", "37", "metadata.json"), "utf8"),
    );
    const developerMeta = JSON.parse(
      fs.readFileSync(path.join(metadataPath, "content", "developers", "37", "metadata.json"), "utf8"),
    );

    expect(companyMeta.title).toBe("LucasArts");
    expect(companyMeta.summary).toBe("Studio");
    expect(companyMeta.games).toBeUndefined();
    expect(developerMeta).toEqual({ games: [101, 102] });
  });

  test("loadRoleItems merges company profile with role games", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 37,
      title: "LucasArts",
      summary: "",
      games: [5],
      childs: [],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 37,
      title: "LucasArts",
      summary: "",
      games: [9],
      childs: [],
    });

    const developers = loadRoleItems(metadataPath, "developers");
    const publishers = loadRoleItems(metadataPath, "publishers");

    expect(developers).toHaveLength(1);
    expect(publishers).toHaveLength(1);
    expect(developers[0].games).toEqual([5]);
    expect(publishers[0].games).toEqual([9]);
    expect(developers[0].title).toBe("LucasArts");
    expect(publishers[0].title).toBe("LucasArts");
  });

  test("getRoleToGameIdsMap returns company id to game ids from role blocks", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 37,
      title: "LucasArts",
      summary: "",
      games: [5, 6],
      childs: [],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 88,
      title: "Sega",
      summary: "",
      games: [9],
      childs: [],
    });

    const devMap = getRoleToGameIdsMap(metadataPath, "developers");
    const pubMap = getRoleToGameIdsMap(metadataPath, "publishers");

    expect(devMap.get(37)).toEqual([5, 6]);
    expect(pubMap.get(88)).toEqual([9]);
  });

  test("migrates legacy developer metadata on read", () => {
    const legacyDir = path.join(metadataPath, "content", "developers", "37");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "metadata.json"),
      JSON.stringify({
        title: "Legacy Co",
        summary: "Old summary",
        games: [1, 2],
        childs: [195],
      }),
    );

    const entry = loadRoleItemById(metadataPath, "developers", 37);
    expect(entry.title).toBe("Legacy Co");
    expect(entry.games).toEqual([1, 2]);
    expect(entry.childs).toEqual([195]);

    const developerMeta = JSON.parse(
      fs.readFileSync(path.join(legacyDir, "metadata.json"), "utf8"),
    );
    expect(developerMeta).toEqual({ games: [1, 2] });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(metadataPath, "content", "companies", "37", "metadata.json"), "utf8"),
      ).title,
    ).toBe("Legacy Co");
  });

  test("loadRoleItems keeps child linked in other role when pruning developers list", () => {
    saveRoleItem(metadataPath, "publishers", {
      id: 100,
      title: "Parent Publisher",
      summary: "",
      games: [],
      childs: [101],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 101,
      title: "Child Publisher",
      summary: "",
      games: [],
      childs: [],
    });
    saveRoleItem(metadataPath, "developers", {
      id: 100,
      title: "Parent Publisher",
      summary: "",
      games: [500],
      childs: [],
    });

    loadRoleItems(metadataPath, "developers");

    const companyMeta = JSON.parse(
      fs.readFileSync(path.join(metadataPath, "content", "companies", "100", "metadata.json"), "utf8"),
    );
    expect(companyMeta.childs).toEqual([101]);

    const publishers = loadRoleItems(metadataPath, "publishers");
    const parent = publishers.find((item) => item.id === 100);
    expect(parent?.childs).toEqual([101]);
  });

  test("adding developer role for existing publisher does not clear shared childs", () => {
    saveRoleItem(metadataPath, "publishers", {
      id: 200,
      title: "Parent Corp",
      summary: "",
      games: [],
      childs: [201],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 201,
      title: "Child Corp",
      summary: "",
      games: [],
      childs: [],
    });

    saveRoleItem(metadataPath, "developers", {
      id: 200,
      title: "Parent Corp",
      summary: "",
      games: [42],
      childs: [],
    });

    const companyMeta = JSON.parse(
      fs.readFileSync(path.join(metadataPath, "content", "companies", "200", "metadata.json"), "utf8"),
    );
    expect(companyMeta.childs).toEqual([201]);
  });

  test("linkCompanyUnderParent links child under parent childs", () => {
    saveRoleItem(metadataPath, "publishers", {
      id: 10,
      title: "Child Publisher",
      summary: "",
      games: [1],
      childs: [],
    });

    const linked = linkCompanyUnderParent(metadataPath, "publishers", 10, {
      id: 20,
      name: "Parent Corp",
    });

    expect(linked).toBe(true);
    const parent = loadRoleItemById(metadataPath, "publishers", 20);
    expect(parent).not.toBeNull();
    expect(parent.title).toBe("Parent Corp");
    expect(parent.childs).toEqual([10]);
    expect(parent.games).toEqual([]);

    const child = loadRoleItemById(metadataPath, "publishers", 10);
    expect(child.parentCompany).toBeUndefined();
  });

  test("linkCompanyUnderParent applies IGDB profile patch when creating parent", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 10,
      title: "Child Dev",
      summary: "",
      games: [1],
      childs: [],
    });

    linkCompanyUnderParent(
      metadataPath,
      "developers",
      10,
      { id: 20, name: "Parent Corp" },
      {
        parentProfilePatch: {
          title: "Mattel, Inc.",
          summary: "American toy company.",
          externalCoverUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/logo.png",
          status: "Active",
          countryCode: 840,
        },
      },
    );

    const parent = loadRoleItemById(metadataPath, "developers", 20);
    expect(parent.title).toBe("Mattel, Inc.");
    expect(parent.summary).toBe("American toy company.");
    expect(parent.externalCoverUrl).toBe("https://images.igdb.com/igdb/image/upload/t_1080p/logo.png");
    expect(parent.status).toBe("Active");
    expect(parent.countryCode).toBe(840);
    expect(parent.childs).toEqual([10]);
  });

  test("linkCompanyUnderParent fills missing parent cover on later patch", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 10,
      title: "Child Dev",
      summary: "",
      games: [1],
      childs: [],
    });

    linkCompanyUnderParent(metadataPath, "developers", 10, { id: 20, name: "Parent Corp" });

    linkCompanyUnderParent(
      metadataPath,
      "developers",
      10,
      { id: 20, name: "Parent Corp" },
      {
        parentProfilePatch: {
          title: "Mattel, Inc.",
          summary: "American toy company.",
          externalCoverUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/logo.png",
          status: "Active",
        },
      },
    );

    const parent = loadRoleItemById(metadataPath, "developers", 20);
    expect(parent.externalCoverUrl).toBe("https://images.igdb.com/igdb/image/upload/t_1080p/logo.png");
    expect(parent.status).toBe("Active");
  });

  test("linkCompanyUnderParent is idempotent when link already exists", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 5,
      title: "Child Dev",
      summary: "",
      games: [2],
      childs: [],
    });

    expect(
      linkCompanyUnderParent(metadataPath, "developers", 5, { id: 20, name: "Parent Dev" }),
    ).toBe(true);
    expect(
      linkCompanyUnderParent(metadataPath, "developers", 5, { id: 20, name: "Parent Dev" }),
    ).toBe(false);

    const parent = loadRoleItemById(metadataPath, "developers", 20);
    expect(parent.childs).toEqual([5]);
  });

  test("pruneOrphanRoleItems removes developer hierarchy when child still exists as publisher", () => {
    saveRoleItem(metadataPath, "publishers", {
      id: 1000,
      title: "Company A",
      summary: "",
      games: [100],
      childs: [1001],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 1001,
      title: "Company B",
      summary: "",
      games: [100],
      childs: [],
    });
    saveRoleItem(metadataPath, "developers", {
      id: 1001,
      title: "Company B",
      summary: "",
      games: [200],
      childs: [],
    });
    linkCompanyUnderParent(metadataPath, "developers", 1001, { id: 1000, name: "Company A" });

    expect(loadRoleItems(metadataPath, "developers")).toHaveLength(2);

    removeGameFromAllRoleItems(metadataPath, "developers", 200);

    expect(loadRoleItems(metadataPath, "developers")).toHaveLength(0);
    expect(loadRoleItems(metadataPath, "publishers")).toHaveLength(2);
    expect(loadRoleItemById(metadataPath, "publishers", 1000)?.childs).toEqual([1001]);
  });

  test("pruneOrphanRoleItems keeps parent when child still exists in same role", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 3000,
      title: "Parent Dev",
      summary: "",
      games: [400],
      childs: [3001],
    });
    saveRoleItem(metadataPath, "developers", {
      id: 3001,
      title: "Child Dev",
      summary: "",
      games: [401],
      childs: [],
    });

    removeGameFromAllRoleItems(metadataPath, "developers", 400);

    const developers = loadRoleItems(metadataPath, "developers");
    expect(developers).toHaveLength(2);
    const parent = developers.find((item) => item.id === 3000);
    expect(parent?.childs).toEqual([3001]);
  });

  test("deleteRoleItem removes developer link but keeps company for publisher", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 37,
      title: "Shared Co",
      summary: "",
      games: [],
      childs: [],
    });
    saveRoleItem(metadataPath, "publishers", {
      id: 37,
      title: "Shared Co",
      summary: "",
      games: [3],
      childs: [],
    });

    deleteRoleItem(metadataPath, "developers", 37);

    expect(loadRoleItemById(metadataPath, "developers", 37)).toBeNull();
    expect(loadRoleItemById(metadataPath, "publishers", 37)?.games).toEqual([3]);
    expect(
      fs.existsSync(path.join(metadataPath, "content", "companies", "37", "metadata.json")),
    ).toBe(true);
  });
});
