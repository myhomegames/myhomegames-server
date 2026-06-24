const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadRoleItems,
  loadRoleItemById,
  saveRoleItem,
  deleteRoleItem,
  migrateLegacyRoleMetadata,
  syncParentCompanyChildLink,
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

  test("syncParentCompanyChildLink links child under parentCompany", () => {
    saveRoleItem(metadataPath, "publishers", {
      id: 10,
      title: "Child Publisher",
      summary: "",
      games: [1],
      childs: [],
      parentCompany: { id: 20, name: "Parent Corp" },
    });

    const linked = syncParentCompanyChildLink(metadataPath, "publishers", {
      id: 10,
      title: "Child Publisher",
      parentCompany: { id: 20, name: "Parent Corp" },
    });

    expect(linked).toBe(true);
    const parent = loadRoleItemById(metadataPath, "publishers", 20);
    expect(parent).not.toBeNull();
    expect(parent.title).toBe("Parent Corp");
    expect(parent.childs).toEqual([10]);
    expect(parent.games).toEqual([]);
  });

  test("syncParentCompanyChildLink applies IGDB profile patch when creating parent", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 10,
      title: "Child Dev",
      summary: "",
      games: [1],
      childs: [],
      parentCompany: { id: 20, name: "Parent Corp" },
    });

    syncParentCompanyChildLink(
      metadataPath,
      "developers",
      { id: 10, parentCompany: { id: 20, name: "Parent Corp" } },
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

  test("syncParentCompanyChildLink fills missing parent cover on later patch", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 10,
      title: "Child Dev",
      summary: "",
      games: [1],
      childs: [],
      parentCompany: { id: 20, name: "Parent Corp" },
    });

    syncParentCompanyChildLink(metadataPath, "developers", {
      id: 10,
      parentCompany: { id: 20, name: "Parent Corp" },
    });

    syncParentCompanyChildLink(
      metadataPath,
      "developers",
      { id: 10, parentCompany: { id: 20, name: "Parent Corp" } },
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

  test("syncParentCompanyChildLink is idempotent when link already exists", () => {
    saveRoleItem(metadataPath, "developers", {
      id: 5,
      title: "Child Dev",
      summary: "",
      games: [2],
      childs: [],
      parentCompany: { id: 20, name: "Parent Dev" },
    });

    const childEntry = {
      id: 5,
      parentCompany: { id: 20, name: "Parent Dev" },
    };

    expect(syncParentCompanyChildLink(metadataPath, "developers", childEntry)).toBe(true);
    expect(syncParentCompanyChildLink(metadataPath, "developers", childEntry)).toBe(false);

    const parent = loadRoleItemById(metadataPath, "developers", 20);
    expect(parent.childs).toEqual([5]);
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
