const request = require("supertest");

function runTagListTests(config) {
  const {
    routeBase,
    listKey,
    responseKey,
    humanName,
    coverPrefix,
    contentFolder,
    ensureFnName,
    modulePath,
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
  const slug = humanNameLower.replace(/\s+/g, "");

  function getTagId(tagTitle) {
    let hash = 0;
    const str = String(tagTitle).toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
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
        response.body[listKey].forEach((tag) => {
          expect(typeof tag).toBe("object");
          expect(tag).toHaveProperty("id");
          expect(tag).toHaveProperty("title");
          expect(typeof tag.id).toBe("number");
          expect(typeof tag.title).toBe("string");
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

  describe(`POST ${normalizedRouteBase}`, () => {
    test(`should create a new ${humanNameLower}`, async () => {
      const tagTitle = `test${slug}-${Date.now()}`;
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      expect(response.body).toHaveProperty(responseKey);
      expect(typeof response.body[responseKey]).toBe("string");
      expect(response.body[responseKey]).toBe(tagTitle);

      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const tagExists = listResponse.body[listKey].some(
        (tag) => tag.title === tagTitle
      );
      expect(tagExists).toBe(true);
    });

    test(`should return ${humanNameLower} title as string`, async () => {
      const title = `New Test ${humanName}`;
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title })
        .expect(200);

      expect(typeof response.body[responseKey]).toBe("string");
      expect(response.body[responseKey]).toBe(title);
    });

    test(`should create ${humanNameLower} content directory during creation`, async () => {
      const tagTitle = `Test/Slash/${humanName}/${Date.now()}`;
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      expect(response.body).toHaveProperty(responseKey);
      expect(response.body[responseKey]).toBe(tagTitle);

      const fs = require("fs");
      const path = require("path");
      const { testMetadataPath } = require("../setup");
      const tagId = getTagId(tagTitle);
      const tagContentDir = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId)
      );
      expect(fs.existsSync(tagContentDir)).toBe(true);
    });

    test("should preserve title case", async () => {
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: `UPPERCASE ${humanName.toUpperCase()}` })
        .expect(200);

      expect(response.body[responseKey]).toBe(`UPPERCASE ${humanName.toUpperCase()}`);
    });

    test(`should return 409 if ${humanNameLower} already exists`, async () => {
      const duplicateTitle = `duplicate-${slug}`;
      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: duplicateTitle })
        .expect(200);

      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: duplicateTitle })
        .expect(409);

      expect(response.body).toHaveProperty("error", `${humanName} already exists`);
    });

    test("should return 400 if title is missing", async () => {
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error", "Title is required");
    });

    test("should return 400 if title is empty", async () => {
      const response = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: "   " })
        .expect(400);

      expect(response.body).toHaveProperty("error", "Title is required");
    });

    test(`should serve ${humanNameLower} cover with normalized path (removing slashes)`, async () => {
      const tagTitle = `Test/With/Slash/${Date.now()}`;
      const fs = require("fs");
      const path = require("path");
      const { testMetadataPath } = require("../setup");

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      const tagId = getTagId(tagTitle);
      const tagContentDir = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId)
      );
      fs.mkdirSync(tagContentDir, { recursive: true });
      fs.writeFileSync(path.join(tagContentDir, "cover.webp"), "fake webp data");

      const tagTitleForUrl = encodeURIComponent(tagTitle);
      const response = await request(app)
        .get(`/${coverPrefix}/${tagTitleForUrl}`)
        .expect(200);

      expect(response.headers["content-type"]).toContain("image/webp");
    });
  });

  describe(`POST ${normalizedRouteBase}/:tagTitle/upload-cover`, () => {
    test(`should upload a cover image for a ${humanNameLower}`, async () => {
      const tagTitle = `UploadCover${slug}-${Date.now()}`;
      const fileContent = Buffer.from("fake image data");
      const { testMetadataPath } = require("../setup");
      const fs = require("fs");
      const path = require("path");

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      const response = await request(app)
        .post(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}/upload-cover`)
        .set("X-Auth-Token", "test-token")
        .attach("file", fileContent, "cover.webp")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body).toHaveProperty(responseKey);
      expect(response.body[responseKey]).toHaveProperty("title", tagTitle);
      expect(response.body[responseKey]).toHaveProperty("cover");

      const tagId = getTagId(tagTitle);
      const coverPath = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId),
        "cover.webp"
      );
      expect(fs.existsSync(coverPath)).toBe(true);
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .post(`${normalizedRouteBase}/some-tag/upload-cover`)
        .attach("file", Buffer.from("fake"), "cover.webp")
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`DELETE ${normalizedRouteBase}/:tagTitle/delete-cover`, () => {
    test(`should delete a ${humanNameLower} cover image`, async () => {
      const tagTitle = `DeleteCover${slug}-${Date.now()}`;
      const fileContent = Buffer.from("fake image data");
      const { testMetadataPath } = require("../setup");
      const fs = require("fs");
      const path = require("path");

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      await request(app)
        .post(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}/upload-cover`)
        .set("X-Auth-Token", "test-token")
        .attach("file", fileContent, "cover.webp")
        .expect(200);

      const tagId = getTagId(tagTitle);
      const coverPath = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId),
        "cover.webp"
      );
      expect(fs.existsSync(coverPath)).toBe(true);

      const response = await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}/delete-cover`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(response.body).toHaveProperty(responseKey);
      expect(response.body[responseKey]).toHaveProperty("title", tagTitle);
      expect(fs.existsSync(coverPath)).toBe(false);
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .delete(`${normalizedRouteBase}/some-tag/delete-cover`)
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`GET ${normalizedRouteBase}/:tagId/cover.webp`, () => {
    test("should serve local cover if exists", async () => {
      const tagTitle = `CoverTest-${Date.now()}`;
      const fs = require("fs");
      const path = require("path");
      const { testMetadataPath } = require("../setup");

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      const tagId = getTagId(tagTitle);
      const tagContentDir = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId)
      );
      fs.mkdirSync(tagContentDir, { recursive: true });
      fs.writeFileSync(path.join(tagContentDir, "cover.webp"), "fake webp data");

      const response = await request(app)
        .get(`${normalizedRouteBase}/${tagId}/cover.webp`)
        .expect(200);

      expect(response.headers["content-type"]).toContain("image/webp");
      expect(response.body.toString()).toBe("fake webp data");
    });

    test("should redirect to remote URL if local cover does not exist and FRONTEND_URL is set", async () => {
      const tagTitle = `RemoteCoverTest-${Date.now()}`;

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      const tagId = getTagId(tagTitle);
      const originalFrontendUrl = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = "https://example.com/app";

      try {
        const response = await request(app)
          .get(`${normalizedRouteBase}/${tagId}/cover.webp`)
          .expect(302);

        expect(response.headers.location).toBe(
          `https://example.com${normalizedRouteBase}/${tagId}/cover.webp`
        );
      } finally {
        if (originalFrontendUrl) {
          process.env.FRONTEND_URL = originalFrontendUrl;
        } else {
          delete process.env.FRONTEND_URL;
        }
      }
    });

    test("should return 404 if local cover does not exist and FRONTEND_URL is not set", async () => {
      const tagTitle = `NoCoverTest-${Date.now()}`;

      await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: tagTitle })
        .expect(200);

      const tagId = getTagId(tagTitle);
      const originalFrontendUrl = process.env.FRONTEND_URL;
      delete process.env.FRONTEND_URL;

      try {
        const response = await request(app)
          .get(`${normalizedRouteBase}/${tagId}/cover.webp`)
          .expect(404);

        expect(response.headers["content-type"]).toContain("image/webp");
      } finally {
        if (originalFrontendUrl) {
          process.env.FRONTEND_URL = originalFrontendUrl;
        }
      }
    });

    test("should return 400 for invalid tag ID", async () => {
      const response = await request(app)
        .get(`${normalizedRouteBase}/invalid-id/cover.webp`)
        .expect(400);

      expect(response.text).toContain(`Invalid ${humanNameLower} ID`);
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .post(normalizedRouteBase)
        .send({ title: "test" })
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });
  });

  describe(`DELETE ${normalizedRouteBase}/:tagTitle`, () => {
    test(`should delete unused ${humanNameLower}`, async () => {
      const createResponse = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: `unused${slug}` })
        .expect(200);

      const tagTitle = createResponse.body[responseKey];

      const deleteResponse = await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(deleteResponse.body).toHaveProperty("status", "success");

      const listResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const tagExists = listResponse.body[listKey].some(
        (tag) => tag.title === tagTitle
      );
      expect(tagExists).toBe(false);
    });

    test(`should return 409 if ${humanNameLower} is still in use`, async () => {
      const libraryResponse = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (libraryResponse.body.games.length > 0) {
        const gameId = libraryResponse.body.games[0].id;

        const tagsResponse = await request(app)
          .get(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        if (tagsResponse.body[listKey].length > 0) {
          const tag = tagsResponse.body[listKey][0];
          const tagTitle = typeof tag === "string" ? tag : tag.title;

          await request(app)
            .put(`/games/${gameId}`)
            .set("X-Auth-Token", "test-token")
            .send({ [gameField]: [tagTitle] })
            .expect(200);

          const deleteResponse = await request(app)
            .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
            .set("X-Auth-Token", "test-token")
            .expect(409);

          expect(deleteResponse.body).toHaveProperty(
            "error",
            `${humanName} is still in use by one or more games`
          );

          await request(app)
            .put(`/games/${gameId}`)
            .set("X-Auth-Token", "test-token")
            .send({ [gameField]: [] })
            .expect(200);
        }
      }
    });

    test(`should return 404 if ${humanNameLower} does not exist`, async () => {
      const response = await request(app)
        .delete(`${normalizedRouteBase}/nonexistent_${slug}`)
        .set("X-Auth-Token", "test-token")
        .expect(404);

      expect(response.body).toHaveProperty("error", `${humanName} not found`);
    });

    test("should require authentication", async () => {
      const response = await request(app)
        .delete(`${normalizedRouteBase}/some_${slug}`)
        .expect(401);

      expect(response.body).toHaveProperty("error", "Unauthorized");
    });

    test("should delete only metadata.json and remove directory only if empty", async () => {
      const createResponse = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: `test${slug}fordeletion` })
        .expect(200);

      const tagTitle = createResponse.body[responseKey];
      const { testMetadataPath } = require("../setup");
      const fs = require("fs");
      const path = require("path");

      const tagId = getTagId(tagTitle);
      const tagContentDir = path.join(
        testMetadataPath,
        "content",
        contentFolder,
        String(tagId)
      );
      const metadataFile = path.join(tagContentDir, "metadata.json");
      if (!fs.existsSync(tagContentDir)) {
        fs.mkdirSync(tagContentDir, { recursive: true });
      }

      expect(fs.existsSync(metadataFile)).toBe(true);

      const response = await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(response.body).toHaveProperty("status", "success");
      expect(fs.existsSync(metadataFile)).toBe(false);

      if (fs.existsSync(tagContentDir)) {
        const remainingFiles = fs.readdirSync(tagContentDir);
        expect(remainingFiles.length).toBeGreaterThan(0);
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe(`Game update with ${humanNameLower} creation and deletion`, () => {
    test(`should create ${humanNameLower} when updating game with new ${humanNameLower}`, async () => {
      const libraryResponse = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (libraryResponse.body.games.length > 0) {
        const gameId = libraryResponse.body.games[0].id;

        const createTagResponse = await request(app)
          .post(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .send({ title: `newtest${slug}` })
          .expect(200);

        const newTagTitle = createTagResponse.body[responseKey];

        const updateResponse = await request(app)
          .put(`/games/${gameId}`)
          .set("X-Auth-Token", "test-token")
          .send({ [gameField]: [newTagTitle] })
          .expect(200);

        expect(updateResponse.body.game).toHaveProperty(gameField);
        expect(Array.isArray(updateResponse.body.game[gameField])).toBe(true);
        expect(updateResponse.body.game[gameField]).toContain(newTagTitle);

        const tagsResponse = await request(app)
          .get(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        const tagExists = tagsResponse.body[listKey].some(
          (tag) => tag.title === newTagTitle
        );
        expect(tagExists).toBe(true);

        await request(app)
          .put(`/games/${gameId}`)
          .set("X-Auth-Token", "test-token")
          .send({ [gameField]: [] })
          .expect(200);

        await request(app)
          .delete(`${normalizedRouteBase}/${encodeURIComponent(newTagTitle)}`)
          .set("X-Auth-Token", "test-token")
          .expect(200);
      }
    });

    test(`should allow deletion of ${humanNameLower} after removing from last game`, async () => {
      const libraryResponse = await request(app)
        .get("/libraries/library/games")
        .set("X-Auth-Token", "test-token")
        .expect(200);

      if (libraryResponse.body.games.length > 0) {
        const gameId = libraryResponse.body.games[0].id;

        const createTagResponse = await request(app)
          .post(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .send({ title: `temporary${slug}` })
          .expect(200);

        const tagTitle = createTagResponse.body[responseKey];

        await request(app)
          .put(`/games/${gameId}`)
          .set("X-Auth-Token", "test-token")
          .send({ [gameField]: [tagTitle] })
          .expect(200);

        const deleteWhileInUseResponse = await request(app)
          .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
          .set("X-Auth-Token", "test-token")
          .expect(409);

        expect(deleteWhileInUseResponse.body).toHaveProperty(
          "error",
          `${humanName} is still in use by one or more games`
        );

        await request(app)
          .put(`/games/${gameId}`)
          .set("X-Auth-Token", "test-token")
          .send({ [gameField]: [] })
          .expect(200);

        const deleteResponse = await request(app)
          .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        expect(deleteResponse.body).toHaveProperty("status", "success");

        const tagsResponse = await request(app)
          .get(normalizedRouteBase)
          .set("X-Auth-Token", "test-token")
          .expect(200);

        const tagExists = tagsResponse.body[listKey].some(
          (tag) => tag.title === tagTitle
        );
        expect(tagExists).toBe(false);
      }
    });
  });

  describe(`${ensureFnName} helper function`, () => {
    test(`should create ${humanNameLower} if it does not exist`, async () => {
      const tagsBefore = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const initialCount = tagsBefore.body[listKey].length;

      const tagModule = require(modulePath);
      const { testMetadataPath } = require("../setup");

      const tagTitle = tagModule[ensureFnName](testMetadataPath, `Helper Test ${humanName}`);

      expect(tagTitle).toBeTruthy();
      expect(tagTitle).toBe(`Helper Test ${humanName}`);

      const tagsAfter = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(tagsAfter.body[listKey].length).toBe(initialCount + 1);

      const tagExists = tagsAfter.body[listKey].some(
        (tag) => tag.title === `Helper Test ${humanName}`
      );
      expect(tagExists).toBe(true);

      await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);
    });

    test(`should return existing ${humanNameLower} ID if ${humanNameLower} already exists`, async () => {
      const createResponse = await request(app)
        .post(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .send({ title: `Existing Helper ${humanName}` })
        .expect(200);

      const existingTagTitle = createResponse.body[responseKey];

      const tagsBefore = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const initialCount = tagsBefore.body[listKey].length;

      const tagModule = require(modulePath);
      const { testMetadataPath } = require("../setup");

      const tagTitle = tagModule[ensureFnName](testMetadataPath, `Existing Helper ${humanName}`);

      expect(tagTitle).toBe(`Existing Helper ${humanName}`);

      const tagsAfter = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      expect(tagsAfter.body[listKey].length).toBe(initialCount);

      const tagsBeforeDelete = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const tagExists = tagsBeforeDelete.body[listKey].some(
        (tag) => tag.title === tagTitle
      );
      expect(tagExists).toBe(true);

      await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);
    });

    test("should preserve title case", async () => {
      const tagModule = require(modulePath);
      const { testMetadataPath } = require("../setup");

      const tagTitle = tagModule[ensureFnName](
        testMetadataPath,
        `UPPERCASE HELPER ${humanName.toUpperCase()}`
      );

      expect(tagTitle).toBeTruthy();
      expect(tagTitle).toBe(`UPPERCASE HELPER ${humanName.toUpperCase()}`);

      const tagsResponse = await request(app)
        .get(normalizedRouteBase)
        .set("X-Auth-Token", "test-token")
        .expect(200);

      const tagExists = tagsResponse.body[listKey].some(
        (tag) => tag.title === `UPPERCASE HELPER ${humanName.toUpperCase()}`
      );
      expect(tagExists).toBe(true);

      await request(app)
        .delete(`${normalizedRouteBase}/${encodeURIComponent(tagTitle)}`)
        .set("X-Auth-Token", "test-token")
        .expect(200);
    });

    test("should return null for invalid input", async () => {
      const tagModule = require(modulePath);
      const { testMetadataPath } = require("../setup");
      expect(tagModule[ensureFnName](testMetadataPath, null)).toBeNull();
      expect(tagModule[ensureFnName](testMetadataPath, "")).toBeNull();
      expect(tagModule[ensureFnName](testMetadataPath, "   ")).toBeNull();
      expect(tagModule[ensureFnName](testMetadataPath, 123)).toBeNull();
    });
  });
}

module.exports = {
  runTagListTests,
};
