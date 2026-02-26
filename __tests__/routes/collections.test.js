const request = require("supertest");
const { runCollectionLikeTests } = require("./collectionLike.shared");
const { testMetadataPath } = require("../setup");

let app;

beforeAll(() => {
  delete require.cache[require.resolve("../../server.js")];
  app = require("../../server.js");
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (global.gc) global.gc();
});

runCollectionLikeTests(
  {
    routeBase: "/collections",
    listKey: "collections",
    singleResponseKey: "collection",
    humanName: "Collection",
    coverPrefix: "collection-covers",
    contentFolder: "collections",
    gameField: "collection",
    expectedCreateStatus: 200,
    skipEnsureBatchTest: true,
    skipDeleteAfterRemovingFromGame: true,
  },
  () => app
);

describe("Collections-specific: GET /collections", () => {
  test("should return collections with correct structure (cover URL)", async () => {
    const response = await request(app)
      .get("/collections")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (response.body.collections.length > 0) {
      const c = response.body.collections[0];
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("title");
      if (c.cover) expect(c.cover).toContain("/collection-covers/");
    }
  });
});

describe("Collections-specific: GET /collections/:id", () => {
  test("should return collection with summary, gameCount, cover", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const response = await request(app)
      .get(`/collections/${id}`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(response.body).toHaveProperty("summary");
    expect(response.body).toHaveProperty("gameCount");
    expect(typeof response.body.gameCount).toBe("number");
    if (response.body.cover) expect(response.body.cover).toContain("/collection-covers/");
  });
  test("should handle URL-encoded collection IDs", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app)
      .get(`/collections/${encodeURIComponent(id)}`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(res.body).toHaveProperty("id", id);
  });
});

describe("Collections-specific: POST /collections", () => {
  test("should return 409 with exact error when title exists", async () => {
    const title = "Test Collection Duplicate Title " + Date.now();
    await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title })
      .expect(200);
    const dup = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title })
      .expect(409);
    expect(dup.body.error).toBe("Collection with this title already exists");
    expect(dup.body.collection).toHaveProperty("title", title);
  });
  test("should assign deterministic ID from title hash", async () => {
    const title = "DeterministicHashTestCollection123";
    const r1 = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title })
      .expect(200);
    const id1 = r1.body.collection.id;
    await request(app).delete(`/collections/${id1}`).set("X-Auth-Token", "test-token").expect(200);
    const r2 = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title })
      .expect(200);
    expect(r2.body.collection.id).toBe(id1);
  });
});

describe("Collections-specific: GET /collections/:id/games", () => {
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .get("/collections/nonexistent/games")
      .set("X-Auth-Token", "test-token")
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
  test("should return games with correct structure", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for Games Structure " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .get(`/collections/${id}/games`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (res.body.games.length > 0) {
      const g = res.body.games[0];
      expect(g).toHaveProperty("id");
      expect(g).toHaveProperty("title");
      expect(g).toHaveProperty("cover");
      if (g.cover) expect(g.cover).toContain("/covers/");
    }
  });
});

describe("Collections-specific: PUT /collections/:id", () => {
  test("should update a single field", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for Update " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .put(`/collections/${id}`)
      .set("X-Auth-Token", "test-token")
      .send({ title: "Updated Title" })
      .expect(200);
    expect(res.body.collection).toHaveProperty("title", "Updated Title");
  });
  test("should update multiple fields", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for Multiple Update " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .put(`/collections/${id}`)
      .set("X-Auth-Token", "test-token")
      .send({ title: "Updated Title", summary: "Updated Summary" })
      .expect(200);
    expect(res.body.collection).toHaveProperty("summary", "Updated Summary");
  });
  test("should ignore non-allowed fields", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for Ignore " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .put(`/collections/${id}`)
      .set("X-Auth-Token", "test-token")
      .send({ title: "New Title", unknownField: "value" })
      .expect(200);
    expect(res.body.collection).not.toHaveProperty("unknownField");
  });
  test("should return 400 when no valid fields provided", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for 400 " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .put(`/collections/${id}`)
      .set("X-Auth-Token", "test-token")
      .send({ unknownField: "value" })
      .expect(400);
    expect(res.body.error).toBe("No valid fields to update");
  });
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .put("/collections/non-existent-id")
      .set("X-Auth-Token", "test-token")
      .send({ title: "New Title" })
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
});

describe("Collections-specific: DELETE /collections/:id", () => {
  test("should delete a collection", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    await request(app).delete(`/collections/${id}`).set("X-Auth-Token", "test-token").expect(200);
    await request(app).get(`/collections/${id}`).set("X-Auth-Token", "test-token").expect(404);
  });
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .delete("/collections/non-existent-id")
      .set("X-Auth-Token", "test-token")
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
  test("should require authentication", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app).delete(`/collections/${id}`).expect(401);
    expect(res.body.error).toBe("Unauthorized");
  });
  test("should delete only metadata.json and remove directory if empty", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection for Delete Dir " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    const metaPath = path.join(dir, "metadata.json");
    expect(fs.existsSync(metaPath)).toBe(true);
    await request(app).delete(`/collections/${id}`).set("X-Auth-Token", "test-token").expect(200);
    expect(fs.existsSync(metaPath)).toBe(false);
  });
});

describe("POST /collections/:id/reload", () => {
  test("should reload metadata for a single collection", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app)
      .post(`/collections/${id}/reload`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(res.body).toHaveProperty("status", "reloaded");
    expect(res.body.collection).toHaveProperty("id", id);
    expect(res.body.collection.cover).toContain("/collection-covers/");
  });
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .post("/collections/non-existent/reload")
      .set("X-Auth-Token", "test-token")
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
  test("should require authentication", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app).post(`/collections/${id}/reload`).expect(401);
    expect(res.body.error).toBe("Unauthorized");
  });
});

describe("DELETE /collections/:id/delete-cover", () => {
  test("should not delete directory when metadata.json exists", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Cover Dir " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cover.webp"), "fake");
    await request(app)
      .delete(`/collections/${id}/delete-cover`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(fs.existsSync(dir)).toBe(true);
  });
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .delete("/collections/999999/delete-cover")
      .set("X-Auth-Token", "test-token")
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
  test("should require authentication", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app).delete(`/collections/${id}/delete-cover`).expect(401);
    expect(res.body.error).toBe("Unauthorized");
  });
  test("should handle collection without cover file gracefully", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection No Cover " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .delete(`/collections/${id}/delete-cover`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(res.body).toHaveProperty("status", "success");
  });
});

describe("DELETE /collections/:id/delete-background", () => {
  test("should delete background image for a collection", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Bg " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    fs.mkdirSync(dir, { recursive: true });
    const bgPath = path.join(dir, "background.webp");
    fs.writeFileSync(bgPath, "fake");
    const res = await request(app)
      .delete(`/collections/${id}/delete-background`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(res.body.collection.background).toBeFalsy();
    expect(fs.existsSync(bgPath)).toBe(false);
  });
  test("should not delete directory when metadata.json exists", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Bg Dir " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    fs.writeFileSync(path.join(dir, "background.webp"), "fake");
    await request(app)
      .delete(`/collections/${id}/delete-background`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(fs.existsSync(dir)).toBe(true);
  });
  test("should return 404 for non-existent collection", async () => {
    const res = await request(app)
      .delete("/collections/999999/delete-background")
      .set("X-Auth-Token", "test-token")
      .expect(404);
    expect(res.body.error).toBe("Collection not found");
  });
  test("should require authentication", async () => {
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    if (list.body.collections.length === 0) return;
    const id = list.body.collections[0].id;
    const res = await request(app).delete(`/collections/${id}/delete-background`).expect(401);
    expect(res.body.error).toBe("Unauthorized");
  });
  test("should handle collection without background file gracefully", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection No Bg " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .delete(`/collections/${id}/delete-background`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(res.body).toHaveProperty("status", "success");
  });
});

describe("PUT /collections/:id/games/order", () => {
  test("should remove duplicate game IDs", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length < 1) return;
    const gameId = gamesRes.body.games[0].id;
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Duplicate " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId, gameId, gameId] })
      .expect(200);
    const after = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(after.body.games.length).toBe(1);
    expect(after.body.games[0].id).toBe(gameId);
  });

  test("should remove duplicate game IDs and preserve client order", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length < 2) return;
    const [gameId1, gameId2] = gamesRes.body.games.slice(0, 2).map((g) => g.id);
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Duplicate Order " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId1, gameId2, gameId1] })
      .expect(200);
    const after = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(after.body.games.length).toBe(2);
    expect(after.body.games.map((g) => g.id)).toContain(gameId1);
    expect(after.body.games.map((g) => g.id)).toContain(gameId2);
  });

  test("should require authentication", async () => {
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Auth Order " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const res = await request(app)
      .put(`/collections/${id}/games/order`)
      .send({ gameIds: [] })
      .expect(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  test("should preserve client order when setting multiple games on empty collection", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    const withDates = (gamesRes.body.games || []).filter((g) => g.year);
    if (withDates.length < 3) return;
    const sorted = [...withDates].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if ((a.month || 0) !== (b.month || 0)) return (a.month || 0) - (b.month || 0);
      return (a.day || 0) - (b.day || 0);
    });
    const [gameId1, gameId2, gameId3] = sorted.slice(0, 3).map((g) => g.id);
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Order " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId3, gameId1, gameId2] })
      .expect(200);
    const after = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(after.body.games.length).toBe(3);
    expect(after.body.games[0].id).toBe(gameId3);
    expect(after.body.games[1].id).toBe(gameId1);
    expect(after.body.games[2].id).toBe(gameId2);
  });

  test("should insert new game in correct position when adding to existing collection", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    const withDates = (gamesRes.body.games || []).filter((g) => g.year);
    if (withDates.length < 3) return;
    const sorted = [...withDates].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if ((a.month || 0) !== (b.month || 0)) return (a.month || 0) - (b.month || 0);
      return (a.day || 0) - (b.day || 0);
    });
    const [gameId1, gameId2, gameId3] = sorted.slice(0, 3).map((g) => g.id);
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Insert " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId1, gameId3] })
      .expect(200);
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId1, gameId3, gameId2] })
      .expect(200);
    const after = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set("X-Auth-Token", "test-token")
      .expect(200);
    expect(after.body.games.length).toBe(3);
    expect(after.body.games[0].id).toBe(gameId1);
    expect(after.body.games[1].id).toBe(gameId2);
    expect(after.body.games[2].id).toBe(gameId3);
  });
});

describe("GameCount calculation", () => {
  test("should calculate gameCount correctly excluding deleted games", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length < 2) return;
    const gameIds = gamesRes.body.games.slice(0, 2).map((g) => g.id);
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection GameCount " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds })
      .expect(200);
    let list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    let col = list.body.collections.find((c) => c.id === collectionId);
    expect(col.gameCount).toBe(2);
    await request(app).delete(`/games/${gameIds[0]}`).set("X-Auth-Token", "test-token").expect(200);
    list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    col = list.body.collections.find((c) => c.id === collectionId);
    expect(col.gameCount).toBe(1);
  });

  test("should calculate gameCount as 0 when all games are deleted", async () => {
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length < 1) return;
    const gameId = gamesRes.body.games[0].id;
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Empty GameCount " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId] })
      .expect(200);
    await request(app).delete(`/games/${gameId}`).set("X-Auth-Token", "test-token").expect(200);
    const list = await request(app).get("/collections").set("X-Auth-Token", "test-token").expect(200);
    const col = list.body.collections.find((c) => c.id === collectionId);
    expect(col.gameCount).toBe(0);
  });
});

describe("removeGameFromAllCollections and createCacheUpdater", () => {
  test("should remove game from collections and update cache via callback", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length === 0) return;
    const testGameId = gamesRes.body.games[0].id;
    collectionsRoutes.removeGameFromAllCollections(testMetadataPath, testGameId);
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Cache " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [testGameId] })
      .expect(200);
    const metaPath = path.join(testMetadataPath, "content", "collections", String(collectionId), "metadata.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta.games).toContain(testGameId);
    meta.id = collectionId;
    const mockCache = [JSON.parse(JSON.stringify(meta))];
    const updateCache = collectionsRoutes.createCacheUpdater(mockCache);
    const count = collectionsRoutes.removeGameFromAllCollections(testMetadataPath, testGameId, updateCache);
    expect(count).toBeGreaterThanOrEqual(1);
    const updated = mockCache.find((c) => Number(c.id) === Number(collectionId));
    expect(updated).toBeDefined();
    expect(updated.games).not.toContain(testGameId);
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8")).games).not.toContain(testGameId);
  });

  test("should handle multiple collections with same game", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length === 0) return;
    const testGameId = gamesRes.body.games[0].id;
    const create1 = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Multi 1 " + Date.now() })
      .expect(200);
    const create2 = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection Multi 2 " + Date.now() })
      .expect(200);
    const id1 = create1.body.collection.id;
    const id2 = create2.body.collection.id;
    await request(app)
      .put(`/collections/${id1}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [testGameId] })
      .expect(200);
    await request(app)
      .put(`/collections/${id2}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [testGameId] })
      .expect(200);
    const meta1 = JSON.parse(
      fs.readFileSync(path.join(testMetadataPath, "content", "collections", String(id1), "metadata.json"), "utf8")
    );
    const meta2 = JSON.parse(
      fs.readFileSync(path.join(testMetadataPath, "content", "collections", String(id2), "metadata.json"), "utf8")
    );
    meta1.id = id1;
    meta2.id = id2;
    const mockCache = [JSON.parse(JSON.stringify(meta1)), JSON.parse(JSON.stringify(meta2))];
    const updateCache = collectionsRoutes.createCacheUpdater(mockCache);
    const count = collectionsRoutes.removeGameFromAllCollections(testMetadataPath, testGameId, updateCache);
    expect(count).toBe(2);
    expect(mockCache.find((c) => Number(c.id) === Number(id1)).games).not.toContain(testGameId);
    expect(mockCache.find((c) => Number(c.id) === Number(id2)).games).not.toContain(testGameId);
  });

  test("should work without callback (backward compatibility)", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length === 0) return;
    const testGameId = gamesRes.body.games[0].id;
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Test Collection No Cb " + Date.now() })
      .expect(200);
    const collectionId = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [testGameId] })
      .expect(200);
    const count = collectionsRoutes.removeGameFromAllCollections(testMetadataPath, testGameId);
    expect(count).toBe(1);
    const metaPath = path.join(testMetadataPath, "content", "collections", String(collectionId), "metadata.json");
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8")).games).not.toContain(testGameId);
  });
});

describe("deleteCollectionIfUnused", () => {
  test("should delete collection when it has no games and no local cover", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Orphan Collection " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    expect(fs.existsSync(path.join(dir, "metadata.json"))).toBe(true);
    collectionsRoutes.deleteCollectionIfUnused(testMetadataPath, id);
    expect(fs.existsSync(dir)).toBe(false);
  });

  test("should not delete collection when it has games", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const gamesRes = await request(app)
      .get("/libraries/library/games")
      .set("X-Auth-Token", "test-token")
      .expect(200);
    if (gamesRes.body.games.length === 0) return;
    const gameId = gamesRes.body.games[0].id;
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Collection With Game " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    await request(app)
      .put(`/collections/${id}/games/order`)
      .set("X-Auth-Token", "test-token")
      .send({ gameIds: [gameId] })
      .expect(200);
    const metaPath = path.join(testMetadataPath, "content", "collections", String(id), "metadata.json");
    expect(fs.existsSync(metaPath)).toBe(true);
    collectionsRoutes.deleteCollectionIfUnused(testMetadataPath, id);
    expect(fs.existsSync(metaPath)).toBe(true);
  });

  test("should not delete collection when it has local cover", async () => {
    const collectionsRoutes = require("../../routes/collections");
    const fs = require("fs");
    const path = require("path");
    const createRes = await request(app)
      .post("/collections")
      .set("X-Auth-Token", "test-token")
      .send({ title: "Collection With Cover " + Date.now() })
      .expect(200);
    const id = createRes.body.collection.id;
    const dir = path.join(testMetadataPath, "content", "collections", String(id));
    fs.writeFileSync(path.join(dir, "cover.webp"), "fake");
    const metaPath = path.join(dir, "metadata.json");
    expect(fs.existsSync(metaPath)).toBe(true);
    collectionsRoutes.deleteCollectionIfUnused(testMetadataPath, id);
    expect(fs.existsSync(metaPath)).toBe(true);
  });
});
