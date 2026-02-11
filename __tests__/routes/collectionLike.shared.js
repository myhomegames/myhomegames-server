/**
 * Shared tests for collection-like resources: developers, publishers.
 * Same pattern as taglists.shared.js for themes, platforms, etc.
 *
 * Developers/publishers are created when games are added (no POST create).
 * Tests create items by updating a game with developers/publishers.
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
    const libraryResponse = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);

    if (libraryResponse.body.games.length > 0) {
      const testId = 99999000 + Math.floor(Math.random() * 1000);
      const testName = `Test ${humanName} ${Date.now()}`;

      const gameId = libraryResponse.body.games[0].id;
      const putRes = await request(app)
        .put(`/games/${gameId}`)
        .set("X-Auth-Token", "test-token")
        .send({ [gameField]: [{ id: testId, name: testName }] });

      if (putRes.status === 200) {
        await request(app)
          .post("/reload-games")
          .set("X-Auth-Token", "test-token")
          .expect(200);
        sharedItem = { id: testId, name: testName };
      }
    }
  });

  function getItem() {
    return sharedItem;
  }

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
