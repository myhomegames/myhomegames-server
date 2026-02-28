const request = require("supertest");

function runDerivedItemTests(config) {
  const {
    routeBase,
    listKey,
    responseKey,
    humanName,
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

  describe(`GET ${normalizedRouteBase}`, () => {
    test(`should return list of ${humanNameLower}s`, async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty(listKey);
      expect(Array.isArray(response.body[listKey])).toBe(true);
    });

    test(`should return ${humanNameLower}s with correct structure`, async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (response.body[listKey].length > 0) {
        const item = response.body[listKey][0];
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("hasCover");
        expect(typeof item.hasCover).toBe("boolean");
        if (item.cover) {
          expect(item.cover).toContain(`${normalizedRouteBase}/`);
          expect(item.hasCover).toBe(true);
        } else {
          expect(item.hasCover).toBe(false);
        }
      }
    });

    test(`should return ${humanNameLower}s sorted alphabetically by title`, async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const items = response.body[listKey];
      if (items.length > 1) {
        // Verify alphabetical sorting
        for (let i = 0; i < items.length - 1; i++) {
          const currentTitle = String(items[i].title).toLowerCase();
          const nextTitle = String(items[i + 1].title).toLowerCase();
          expect(currentTitle <= nextTitle).toBe(true);
        }
      }
    });

    test(`should derive ${humanNameLower}s from games`, async () => {
      // First, get all games to see which ones have the field
      const gamesResponse = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const gamesWithField = gamesResponse.body.games.filter(
        (game) => game[gameField] && (Array.isArray(game[gameField]) ? game[gameField].length > 0 : true)
      );

      if (gamesWithField.length > 0) {
        // Get the derived items list
        const itemsResponse = await request(app)
          .get(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        const items = itemsResponse.body[listKey];
        const itemIds = new Set(items.map((item) => item.id));

        // Verify that at least one game's field value appears in the items list
        let foundMatch = false;
        for (const game of gamesWithField) {
          const fieldValues = Array.isArray(game[gameField]) ? game[gameField] : [game[gameField]];
          for (const value of fieldValues) {
            if (typeof value === "number" && itemIds.has(value)) {
              foundMatch = true;
              break;
            }
          }
          if (foundMatch) break;
        }

        // If we have games with the field, we should have at least one matching item
        // (unless all games have invalid/non-numeric values)
        expect(foundMatch || items.length === 0).toBe(true);
      }
    });

    test(`should include ${humanNameLower}s from games with ${gameField} field`, async () => {
      const unique = Date.now() % 100000;
      const testIgdbId = 90000 + unique;
      const testFieldId = 10000 + unique;
      const testFieldName = `Test ${humanName} ${testFieldId}`;

      const addGameResponse = await request(app)
        .post(`/games/add-from-igdb`)
        .set("X-Auth-Token", "test-token")
        .send({
          igdbId: testIgdbId,
          name: `Test Game for ${humanName}`,
          summary: "Test summary",
          releaseDate: 1609459200,
          [gameField]: { id: testFieldId, name: testFieldName },
        })
        .expect(200);

      const gameId = addGameResponse.body.gameId;

      // Get the derived items list
      const itemsResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const items = itemsResponse.body[listKey];
      const foundItem = items.find((item) => item.id === testFieldId);

      // The item should be present in the list
      expect(foundItem).toBeDefined();
      expect(foundItem).toHaveProperty("id", testFieldId);
      expect(foundItem).toHaveProperty("title", testFieldName);

      // Cleanup: delete the test game
      await request(app)
        .delete(`/games/${gameId}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .get(normalizedRouteBase)
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`PUT ${normalizedRouteBase}/:id`, () => {
    test(`should update ${humanNameLower} metadata`, async () => {
      // First get an item ID from the list
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        const response = await request(app)
          .put(`${normalizedRouteBase}/${itemId}`)
          .set("X-Auth-Token", "test-token")
          .send({ showTitle: false })
          .expect(200);

        expect(response.body).toHaveProperty(responseKey);
        expect(response.body[responseKey]).toHaveProperty("id", itemId);
        expect(response.body[responseKey]).toHaveProperty("showTitle", false);
      }
    });

    test("should return 404 for non-existent item", async () => {
      const response = await request(app)
        .put(`${normalizedRouteBase}/999999`)
        .set("X-Auth-Token", "test-token")
        .send({ showTitle: false })
        .expect(404);

      expect(response.body).toHaveProperty("error", "Not found");
    });

    test("should return 400 for invalid id", async () => {
      const response = await request(app)
        .put(`${normalizedRouteBase}/invalid`)
        .set("X-Auth-Token", "test-token")
        .send({ showTitle: false })
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid id");
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .put(`${normalizedRouteBase}/1`)
        .send({ showTitle: false })
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`POST ${normalizedRouteBase}/:id/upload-cover`, () => {
    test(`should upload cover for ${humanNameLower}`, async () => {
      // First get an item ID from the list
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        // Create a simple test image buffer (1x1 PNG)
        const testImageBuffer = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64"
        );

        const response = await request(app)
          .post(`${normalizedRouteBase}/${itemId}/upload-cover`)
          .set("X-Auth-Token", "test-token")
          .attach("file", testImageBuffer, "test.png")
          .expect(200);

        expect(response.body).toHaveProperty(responseKey);
        expect(response.body[responseKey]).toHaveProperty("id", itemId);
        expect(response.body[responseKey]).toHaveProperty("cover");
        expect(response.body[responseKey].cover).toContain(`${normalizedRouteBase}/${itemId}/cover.webp`);
        expect(response.body[responseKey]).toHaveProperty("hasCover", true);
      }
    });

    test("should return 400 if no file provided", async () => {
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        const response = await request(app)
          .post(`${normalizedRouteBase}/${itemId}/upload-cover`)
          .set("X-Auth-Token", "test-token")
          .expect(400);

        expect(response.body).toHaveProperty("error", "No file provided");
      }
    });

    test("should return 400 if file is not an image", async () => {
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        const response = await request(app)
          .post(`${normalizedRouteBase}/${itemId}/upload-cover`)
          .set("X-Auth-Token", "test-token")
          .attach("file", Buffer.from("not an image"), "test.txt")
          .expect(400);

        expect(response.body).toHaveProperty("error", "File must be an image");
      }
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .post(`${normalizedRouteBase}/1/upload-cover`)
        .attach("file", Buffer.from("test"), "test.png")
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`DELETE ${normalizedRouteBase}/:id/delete-cover`, () => {
    test(`should delete cover for ${humanNameLower}`, async () => {
      // First get an item ID from the list
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        const response = await request(app)
          .delete(`${normalizedRouteBase}/${itemId}/delete-cover`)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        expect(response.body).toHaveProperty(responseKey);
        expect(response.body[responseKey]).toHaveProperty("id", itemId);
        expect(response.body[responseKey]).toHaveProperty("hasCover", false);
        expect(response.body[responseKey]).not.toHaveProperty("cover");
      }
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .delete(`${normalizedRouteBase}/1/delete-cover`)
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`GET ${normalizedRouteBase}/:id/cover.webp`, () => {
    test(`should serve cover image for ${humanNameLower}`, async () => {
      // First get an item ID from the list
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      // Find an item with a cover
      const itemWithCover = listResponse.body[listKey].find((item) => item.cover);
      if (itemWithCover) {
        const response = await request(app)
          .get(`${normalizedRouteBase}/${itemWithCover.id}/cover.webp`)
          .expect(200);

        expect(response.headers["content-type"]).toContain("image/webp");
      }
    });

    test("should return 404 if cover does not exist", async () => {
      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (listResponse.body[listKey].length > 0) {
        const itemId = listResponse.body[listKey][0].id;

        // Try to get cover for an item that likely doesn't have one
        const response = await request(app)
          .get(`${normalizedRouteBase}/${itemId}/cover.webp`)
          .expect(404);
      }
    });

    test("should return 400 for invalid id", async () => {
      const response = await request(app)
        .get(`${normalizedRouteBase}/invalid/cover.webp`)
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid id");
    });
  });
}

module.exports = { runDerivedItemTests };
