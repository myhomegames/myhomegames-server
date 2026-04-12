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

    const css = await request(app).get(`/skins/${res.body.id}/bundle.css`);
    expect(css.status).toBe(200);
    expect(css.text).toContain("mhg-skin-test");

    const del = await request(app).delete(`/skins/${res.body.id}`).set("X-Auth-Token", token);
    expect(del.status).toBe(204);

    const after = await request(app).get("/skins");
    expect(after.body.skins).toEqual([]);
  });

  test("POST /skins without token returns 401 when auth required", async () => {
    const zip = new AdmZip();
    zip.addFile("skin.json", Buffer.from(JSON.stringify({ name: "X" }), "utf8"));
    zip.addFile("bundle.css", Buffer.from("a{}", "utf8"));
    const res = await request(app).post("/skins").attach("archive", zip.toBuffer(), "x.zip");
    expect(res.status).toBe(401);
  });
});
