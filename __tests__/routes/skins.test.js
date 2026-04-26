const request = require("supertest");
const path = require("path");
const fs = require("fs");
const os = require("os");
const AdmZip = require("adm-zip");

describe("skins routes", () => {
  let app;
  let meta;
  const token = "test-token";

  beforeAll(() => {
    meta = path.join(os.tmpdir(), `mhg-skins-api-${Date.now()}`);
    process.env.METADATA_PATH = meta;
    process.env.API_TOKEN = token;
    process.env.NODE_ENV = "test";
    delete require.cache[require.resolve("../../routes/skins.js")];
    delete require.cache[require.resolve("../../server.js")];
    app = require("../../server.js");
  });

  afterAll(() => {
    if (fs.existsSync(meta)) {
      fs.rmSync(meta, { recursive: true, force: true });
    }
  });

  test("GET /skins returns empty list", async () => {
    const res = await request(app).get("/skins");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skins: [] });
  });

  test("POST /skins installs zip with skin.json and bundle.css", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "skin.json",
      Buffer.from(JSON.stringify({ name: "Test Theme" }), "utf8")
    );
    zip.addFile("bundle.css", Buffer.from("body { --mhg-skin-test: 1; }", "utf8"));
    const buf = zip.toBuffer();

    const res = await request(app)
      .post("/skins")
      .set("X-Auth-Token", token)
      .field("displayName", "Override Name")
      .attach("archive", buf, "my-skin.zip");

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("Override Name");

    const list = await request(app).get("/skins");
    expect(list.status).toBe(200);
    expect(list.body.skins.length).toBe(1);
    expect(list.body.skins[0].id).toBe(res.body.id);
    expect(list.body.skins[0].name).toBe("Override Name");
    expect(list.body.skins[0].snapshotUrl).toBe(`/skins/${res.body.id}/snapshot`);
    expect(list.body.skins[0].web).toEqual({
      persistentLibraryShell: false,
      collectionsShortcutList: false,
      libraryPagesVerticalList: false,
      libraryHoverSelect: false,
      headerTitleFilter: false,
      disableAlphabetNavigator: false,
      sidebarSearchPopup: false,
      ownedGamesFirstInGamesSidebar: false,
      compactCollectionLikeDetail: false,
    });

    const css = await request(app).get(`/skins/${res.body.id}/bundle.css`);
    expect(css.status).toBe(200);
    expect(css.text).toContain("mhg-skin-test");

    const snapshot = await request(app).get(`/skins/${res.body.id}/snapshot`);
    expect(snapshot.status).toBe(404);

    const del = await request(app).delete(`/skins/${res.body.id}`).set("X-Auth-Token", token);
    expect(del.status).toBe(204);

    const after = await request(app).get("/skins");
    expect(after.body.skins).toEqual([]);
  });

  test("POST /skins with same display name replaces existing skin (same id)", async () => {
    const zip1 = new AdmZip();
    zip1.addFile("skin.json", Buffer.from(JSON.stringify({ name: "Dup Theme" }), "utf8"));
    zip1.addFile("bundle.css", Buffer.from("body { --v: 1; }", "utf8"));
    const res1 = await request(app)
      .post("/skins")
      .set("X-Auth-Token", token)
      .attach("archive", zip1.toBuffer(), "a.zip");
    expect(res1.status).toBe(201);
    const id1 = res1.body.id;

    const zip2 = new AdmZip();
    zip2.addFile("skin.json", Buffer.from(JSON.stringify({ name: "Dup Theme" }), "utf8"));
    zip2.addFile("bundle.css", Buffer.from("body { --v: 2; }", "utf8"));
    const res2 = await request(app)
      .post("/skins")
      .set("X-Auth-Token", token)
      .attach("archive", zip2.toBuffer(), "b.zip");
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBe(id1);

    const list = await request(app).get("/skins");
    expect(list.body.skins.length).toBe(1);
    const css = await request(app).get(`/skins/${id1}/bundle.css`);
    expect(css.text).toContain("--v: 2");

    await request(app).delete(`/skins/${id1}`).set("X-Auth-Token", token);
  });

  test("GET /skins exposes skin.json web flags", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "skin.json",
      Buffer.from(
        JSON.stringify({
          name: "Web Flags Theme",
          web: {
            persistentLibraryShell: true,
            collectionsShortcutList: true,
            libraryPagesVerticalList: true,
            libraryHoverSelect: true,
            headerTitleFilter: true,
            disableAlphabetNavigator: true,
            extraIgnored: "x",
          },
        }),
        "utf8"
      )
    );
    zip.addFile("bundle.css", Buffer.from("body {}", "utf8"));
    const res = await request(app)
      .post("/skins")
      .set("X-Auth-Token", token)
      .attach("archive", zip.toBuffer(), "w.zip");
    expect(res.status).toBe(201);

    const list = await request(app).get("/skins");
    expect(list.status).toBe(200);
    const row = list.body.skins.find((s) => s.id === res.body.id);
    expect(row.web).toEqual({
      persistentLibraryShell: true,
      collectionsShortcutList: true,
      libraryPagesVerticalList: true,
      libraryHoverSelect: true,
      headerTitleFilter: true,
      disableAlphabetNavigator: true,
      sidebarSearchPopup: true,
      ownedGamesFirstInGamesSidebar: false,
      compactCollectionLikeDetail: false,
    });

    await request(app).delete(`/skins/${res.body.id}`).set("X-Auth-Token", token);
  });

  test("POST /skins without token returns 401 when auth required", async () => {
    const zip = new AdmZip();
    zip.addFile("skin.json", Buffer.from(JSON.stringify({ name: "X" }), "utf8"));
    zip.addFile("bundle.css", Buffer.from("a{}", "utf8"));
    const res = await request(app).post("/skins").attach("archive", zip.toBuffer(), "x.zip");
    expect(res.status).toBe(401);
  });

  test("PUT /settings with activeSkinId hydrates settings.skinWeb from skin.json", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "skin.json",
      Buffer.from(
        JSON.stringify({
          name: "Settings Hydration Theme",
          web: {
            persistentLibraryShell: true,
            collectionsShortcutList: true,
            compactCollectionLikeDetail: true,
          },
        }),
        "utf8"
      )
    );
    zip.addFile("bundle.css", Buffer.from("body {}", "utf8"));
    const uploaded = await request(app)
      .post("/skins")
      .set("X-Auth-Token", token)
      .attach("archive", zip.toBuffer(), "sh.zip");
    expect(uploaded.status).toBe(201);

    const putRes = await request(app)
      .put("/settings")
      .set("X-Auth-Token", token)
      .send({ activeSkinId: uploaded.body.id });
    expect(putRes.status).toBe(200);
    expect(putRes.body.settings.activeSkinId).toBe(uploaded.body.id);
    expect(putRes.body.settings.skinWeb).toEqual({
      persistentLibraryShell: true,
      collectionsShortcutList: true,
      libraryPagesVerticalList: false,
      libraryHoverSelect: false,
      headerTitleFilter: false,
      disableAlphabetNavigator: false,
      sidebarSearchPopup: false,
      ownedGamesFirstInGamesSidebar: false,
      compactCollectionLikeDetail: true,
    });

    // A subsequent partial update only touches the requested flag.
    const tweak = await request(app)
      .put("/settings")
      .set("X-Auth-Token", token)
      .send({ skinWeb: { compactCollectionLikeDetail: false } });
    expect(tweak.status).toBe(200);
    expect(tweak.body.settings.skinWeb.compactCollectionLikeDetail).toBe(false);
    expect(tweak.body.settings.skinWeb.persistentLibraryShell).toBe(true);

    await request(app).delete(`/skins/${uploaded.body.id}`).set("X-Auth-Token", token);
  });
});
