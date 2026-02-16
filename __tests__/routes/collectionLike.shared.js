/**
 * Shared tests for collection-like resources: developers, publishers.
 * Same pattern as taglists.shared.js for themes, platforms, etc.
 *
 * Items can be created via POST (create endpoint) or when games are added (PUT game with positive id).
 * Negative ids in game payload are skipped (no new folder created).
 */

const request = require("supertest");

function runCollectionLikeTests(config) {
  const {
    routeBase,
    listKey,
    singleResponseKey,
    humanName,
    coverPrefix,
    contentFolder,
    gameField,
  } = config;

  require("../setup");

  let app;

  beforeAll(() => {
    delete require.cache[require.resolve("../../server.js")];
    app = require("../../server.js");
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (global.gc) {
      global.gc();
    }
  });

  const normalizedRouteBase = routeBase.startsWith("/") ? routeBase : `/${routeBase}`;
  const humanNameLower = humanName.toLowerCase();

  let sharedItem = null;

  beforeAll(async () => {
    const uniqueTitle = `Test ${humanName} ${Date.now()}`;
    const postRes = await request(app)
      .post(normalizedRouteBase)
      .set("X-Auth-Token", "test-token")
      .send({ title: uniqueTitle, summary: "Test summary" });

    if (postRes.status === 201 && postRes.body[singleResponseKey]) {
      const created = postRes.body[singleResponseKey];
      sharedItem = { id: created.id, name: created.title };
    }
  });

  function getItem() {
    return sharedItem;
  }

  describe(`POST ${normalizedRouteBase}`, () => {
    test("should require authentication", async () => {
      await request(app)
        .post(normalizedRouteBase)
        .send({ title: "New Item" })
        .expect(401);
    });

    test("should return 400 when title is missing", async () => {
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({})
        .expect(400);
      expect(response.body).toHaveProperty("error", "Title is required");
    });

    test(`should create ${humanNameLower} and return 201 with body`, async () => {
      const title = `New ${humanName} ${Date.now()}`;
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title, summary: "A summary" })
        .expect(201);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body).toHaveProperty(singleResponseKey);
      expect(response.body[singleResponseKey]).toHaveProperty("id");
      expect(response.body[singleResponseKey]).toHaveProperty("title", title);
      expect(response.body[singleResponseKey]).toHaveProperty("summary", "A summary");
      expect(response.body[singleResponseKey]).toHaveProperty("gameCount", 0);
    });

    test("should return 409 when title already exists", async () => {
      const created = getItem();
      if (!created) return;

      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: created.name })
        .expect(409);

      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty(singleResponseKey);
      expect(response.body[singleResponseKey]).toHaveProperty("id", created.id);
      expect(response.body[singleResponseKey]).toHaveProperty("title", created.name);
    });
  });

  describe("ensureBatch skips negative ids", () => {
    test(`PUT game with negative ${gameField} id should not create new ${humanNameLower}`, async () => {
      const listBefore = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);
      const countBefore = (listBefore.body[listKey] || []).length;

      const libraryRes = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);
      if (libraryRes.body.games.length === 0) return;

      const gameId = libraryRes.body.games[0].id;
      await request(app)
        .put(`/games/${gameId}`)
        .set("X-Auth-Token", "test-token")
        .send({ [gameField]: [{ id: -999999, name: "Negative Id Item" }] })
        .expect(200);

      const listAfter = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);
      const countAfter = (listAfter.body[listKey] || []).length;

      expect(countAfter).toBe(countBefore);
      const negativeItem = (listAfter.body[listKey] || []).find(
        (i) => Number(i.id) === -999999 || i.title === "Negative Id Item"
      );
      expect(negativeItem).toBeUndefined();
    });
  });

  describe(`GET ${normalizedRouteBase}`, () => {
    test(`should return list of ${humanNameLower}s`, async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty(listKey);
      expect(Array.isArray(response.body[listKey])).toBe(true);
    });

    test(`should return ${humanNameLower}s as array of objects with id and title`, async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty(listKey);
      expect(Array.isArray(response.body[listKey])).toBe(true);

      if (response.body[listKey].length > 0) {
        response.body[listKey].forEach((item) => {
          expect(typeof item).toBe("object");
          expect(item).toHaveProperty("id");
          expect(item).toHaveProperty("title");
          expect(typeof item.title).toBe("string");
        });
      }
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`GET ${normalizedRouteBase}/:id`, () => {
    test(`should return ${humanNameLower} by id`, async () => {
      const created = getItem();
      if (!created) return;

      const response = await request(app)
        .get(`${normalizedRouteBase}/${created.id}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("id", created.id);
      expect(response.body).toHaveProperty("title", created.name);
    });

    test(`should return 404 for non-existent ${humanNameLower}`, async () => {
      const response = await request(app)
        .get(`${normalizedRouteBase}/999999999`)
        .set("X-Auth-Token", "test-token")
        .expect(404);

      expect(response.body).toHaveProperty("error", `${humanName} not found`);
    });
  });

  describe(`GET ${normalizedRouteBase}/:id/games`, () => {
    test(`should return games for ${humanNameLower}`, async () => {
      const created = getItem();
      if (!created) return;

      const response = await request(app)
        .get(`${normalizedRouteBase}/${created.id}/games`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("games");
      expect(Array.isArray(response.body.games)).toBe(true);
    });
  });

  describe(`PUT ${normalizedRouteBase}/:id`, () => {
    test(`should update ${humanNameLower} title and summary`, async () => {
      const created = getItem();
      if (!created) return;

      const newTitle = `Updated ${humanName} ${Date.now()}`;
      const response = await request(app)
        .put(`${normalizedRouteBase}/${created.id}`)
        .set("X-Auth-Token", "test-token")
        .send({ title: newTitle, summary: "Test summary" })
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body[singleResponseKey]).toHaveProperty("title", newTitle);
    });
  });

  describe(`POST ${normalizedRouteBase}/:id/upload-cover`, () => {
    test(`should upload a cover image for ${humanNameLower}`, async () => {
      const created = getItem();
      if (!created) return;

      const fs = require("fs");
      const path = require("path");
      const { testMetadataPath } = require("../setup");
      const dir = path.join(testMetadataPath, "content", contentFolder, String(created.id));
      fs.mkdirSync(dir, { recursive: true });

      const response = await request(app)
        .post(`${normalizedRouteBase}/${created.id}/upload-cover`)
        .set("X-Auth-Token", "test-token")
        .attach("file", Buffer.from("fake image data"), "cover.webp")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body[singleResponseKey]).toHaveProperty("title");
    });
  });

  describe(`DELETE ${normalizedRouteBase}/:id/delete-cover`, () => {
    test(`should delete ${humanNameLower} cover image`, async () => {
      const created = getItem();
      if (!created) return;

      const fs = require("fs");
      const path = require("path");
      const { testMetadataPath } = require("../setup");
      const dir = path.join(testMetadataPath, "content", contentFolder, String(created.id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "cover.webp"), "fake webp data");

      const response = await request(app)
        .delete(`${normalizedRouteBase}/${created.id}/delete-cover`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
    });
  });

  describe(`DELETE ${normalizedRouteBase}/:id`, () => {
    test(`should delete ${humanNameLower} after removing from game`, async () => {
      const created = getItem();
      if (!created) return;

      const libraryResponse = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const gameId = libraryResponse.body.games[0].id;
      const gameResponse = await request(app)
        .get(`/games/${gameId}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const current = gameResponse.body[gameField] || [];
      const filtered = current.filter(
        (x) => Number(typeof x === "object" ? x.id : x) !== Number(created.id)
      );

      await request(app)
        .put(`/games/${gameId}`)
        .set("X-Auth-Token", "test-token")
        .send({ [gameField]: filtered })
        .expect(200);

      const response = await request(app)
        .delete(`${normalizedRouteBase}/${created.id}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
    });
  });
}

module.exports = {
  runCollectionLikeTests,
};
