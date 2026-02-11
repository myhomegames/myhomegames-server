const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("../utils/fileUtils");
const { deleteMediaFile } = require("../utils/gameMediaUtils");

function normalizeRouteBase(routeBase) {
  if (!routeBase.startsWith("/")) {
    return `/${routeBase}`;
  }
  return routeBase;
}

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

function createTagRoutes(config) {
  const {
    routeBase,
    contentFolder,
    coverPrefix,
    responseKey,
    listResponseKey,
    humanName,
    gameField,
    resourceType = contentFolder,
  } = config;

  const normalizedRouteBase = normalizeRouteBase(routeBase);

  function getTagDir(metadataPath, tagId) {
    return path.join(metadataPath, "content", contentFolder, String(tagId));
  }

  function getTagMetadataPath(metadataPath, tagId) {
    const tagDir = getTagDir(metadataPath, tagId);
    return path.join(tagDir, "metadata.json");
  }

  function loadTags(metadataPath) {
    const tagsDir = path.join(metadataPath, "content", contentFolder);
    const tags = [];

    if (!fs.existsSync(tagsDir)) {
      return tags;
    }

    const tagFolders = fs
      .readdirSync(tagsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    tagFolders.forEach((folderName) => {
      const tagId = Number(folderName);
      if (isNaN(tagId)) {
        return;
      }
      const metadataFilePath = path.join(tagsDir, folderName, "metadata.json");
      const metadata = readJsonFile(metadataFilePath, null);
      if (metadata && metadata.title) {
        const tagData = {
          id: tagId,
          title: metadata.title,
          showTitle: metadata.showTitle,
        };
        // Same pattern as library (games): local file or fallback. Library fallback = IGDB; tags fallback = this URL (redirects to FRONTEND_URL)
        const coverPath = path.join(tagsDir, folderName, "cover.webp");
        if (fs.existsSync(coverPath)) {
          tagData.cover = `/${coverPrefix}/${encodeURIComponent(metadata.title)}`;
        } else {
          tagData.cover = `${normalizedRouteBase}/${tagId}/cover.webp`;
        }
        tags.push(tagData);
      }
    });

    tags.sort((a, b) => a.title.localeCompare(b.title));

    return tags;
  }

  function findTagIdByTitle(metadataPath, tagTitle) {
    const tags = loadTags(metadataPath);
    const trimmedTitle = tagTitle.trim();
    const existingTag = tags.find(
      (tag) => tag.title.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (existingTag) {
      return existingTag.id;
    }
    return null;
  }

  function saveTag(metadataPath, tagTitle) {
    const tagId = getTagId(tagTitle);
    const tagDir = getTagDir(metadataPath, tagId);
    ensureDirectoryExists(tagDir);
    const metadataFilePath = getTagMetadataPath(metadataPath, tagId);
    const metadata = { title: tagTitle, showTitle: true };
    writeJsonFile(metadataFilePath, metadata);
  }

  function loadTag(metadataPath, tagTitle) {
    const tagId = findTagIdByTitle(metadataPath, tagTitle);
    if (!tagId) {
      return null;
    }
    const metadataFilePath = getTagMetadataPath(metadataPath, tagId);
    const metadata = readJsonFile(metadataFilePath, null);
    return metadata && metadata.title ? metadata.title : null;
  }

  function updateTagMetadata(metadataPath, tagId, updates) {
    const metadataFilePath = getTagMetadataPath(metadataPath, tagId);
    const metadata = readJsonFile(metadataFilePath, null);
    if (!metadata || !metadata.title) {
      return null;
    }
    const updated = { ...metadata, ...updates };
    writeJsonFile(metadataFilePath, updated);
    return updated;
  }

  function deleteTag(metadataPath, tagTitle) {
    const tagId = findTagIdByTitle(metadataPath, tagTitle);
    if (!tagId) {
      return;
    }
    const tagDir = getTagDir(metadataPath, tagId);
    const metadataFile = getTagMetadataPath(metadataPath, tagId);

    if (fs.existsSync(metadataFile)) {
      try {
        fs.unlinkSync(metadataFile);
      } catch (err) {
        console.error(`Failed to delete metadata.json for ${humanName} ${tagTitle}:`, err.message);
        throw err;
      }
    }

    if (fs.existsSync(tagDir)) {
      removeDirectoryIfEmpty(tagDir);
    }
  }

  function ensureTagExists(metadataPath, tagTitle) {
    if (!tagTitle || typeof tagTitle !== "string" || !tagTitle.trim()) {
      return null;
    }

    const trimmedTitle = tagTitle.trim();
    const tags = loadTags(metadataPath);
    const existingTag = tags.find(
      (tag) => tag.title.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (existingTag) {
      return existingTag.title;
    }

    try {
      saveTag(metadataPath, trimmedTitle);
      return trimmedTitle;
    } catch (e) {
      console.error(`Failed to save ${humanName} ${trimmedTitle}:`, e.message);
      return null;
    }
  }

  /** Ensure multiple tags exist with a single load; only writes new tags. */
  function ensureTagsExist(metadataPath, tagTitles) {
    if (!tagTitles || !Array.isArray(tagTitles) || tagTitles.length === 0) {
      return;
    }
    const tags = loadTags(metadataPath);
    const existingLower = new Set(tags.map((t) => (t.title || "").toLowerCase()));
    for (const raw of tagTitles) {
      if (!raw || typeof raw !== "string" || !raw.trim()) continue;
      const trimmed = raw.trim();
      if (existingLower.has(trimmed.toLowerCase())) continue;
      try {
        saveTag(metadataPath, trimmed);
        existingLower.add(trimmed.toLowerCase());
      } catch (e) {
        console.error(`Failed to save ${humanName} ${trimmed}:`, e.message);
      }
    }
  }

  function registerTagRoutes(app, requireToken, metadataPath, metadataGamesDir, allGames) {
    const upload = multer({ storage: multer.memoryStorage() });

    app.get(`/${coverPrefix}/:tagTitle`, (req, res) => {
      const tagTitle = decodeURIComponent(req.params.tagTitle);
      const tagId = findTagIdByTitle(metadataPath, tagTitle);
      if (!tagId) {
        return res.status(404).send(`${humanName} not found`);
      }
      const coverPath = path.join(metadataPath, "content", contentFolder, String(tagId), "cover.webp");

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");

      if (!fs.existsSync(coverPath)) {
        res.setHeader("Content-Type", "image/webp");
        return res.status(404).end();
      }

      res.type("image/webp");
      res.sendFile(coverPath);
    });

    app.get(`${normalizedRouteBase}/:tagId/cover.webp`, (req, res) => {
      const tagId = Number(req.params.tagId);
      if (isNaN(tagId)) {
        return res.status(400).send(`Invalid ${humanName.toLowerCase()} ID`);
      }

      const coverPath = path.join(metadataPath, "content", contentFolder, String(tagId), "cover.webp");

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");

      if (fs.existsSync(coverPath)) {
        res.type("image/webp");
        return res.sendFile(coverPath);
      }

      const frontendUrl = process.env.FRONTEND_URL;
      if (frontendUrl) {
        const baseUrl = frontendUrl.replace(/\/app\/?$/, "");
        const remoteUrl = `${baseUrl}${normalizedRouteBase}/${tagId}/cover.webp`;
        return res.redirect(remoteUrl);
      }

      res.setHeader("Content-Type", "image/webp");
      return res.status(404).end();
    });

    app.get(normalizedRouteBase, requireToken, (req, res) => {
      const tags = loadTags(metadataPath);
      res.json({
        [listResponseKey]: tags.map((tag) => {
          const tagData = {
            id: tag.id,
            title: tag.title,
          };
          if (tag.cover) {
            tagData.cover = tag.cover;
          }
          if (tag.showTitle !== undefined) {
            tagData.showTitle = tag.showTitle;
          }
          return tagData;
        }),
      });
    });

    app.post(normalizedRouteBase, requireToken, (req, res) => {
      const { title } = req.body;

      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Title is required" });
      }

      const tags = loadTags(metadataPath);
      const trimmedTitle = title.trim();

      const existingTag = tags.find(
        (tag) => tag.title.toLowerCase() === trimmedTitle.toLowerCase()
      );
      if (existingTag) {
        return res.status(409).json({
          error: `${humanName} already exists`,
          [responseKey]: existingTag.title,
        });
      }

      const tagTitle = ensureTagExists(metadataPath, title);

      if (!tagTitle) {
        return res.status(500).json({ error: `Failed to create ${humanName.toLowerCase()}` });
      }

      res.json({
        [responseKey]: tagTitle,
      });
    });

    app.put(`${normalizedRouteBase}/:tagTitle`, requireToken, (req, res) => {
      const tagTitle = decodeURIComponent(req.params.tagTitle);
      const tagId = findTagIdByTitle(metadataPath, tagTitle);

      if (!tagId) {
        return res.status(404).json({ error: `${humanName} not found` });
      }

      const updates = {};
      if (typeof req.body.showTitle === "boolean") {
        updates.showTitle = req.body.showTitle;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      try {
        const metadata = updateTagMetadata(metadataPath, tagId, updates);
        if (!metadata) {
          return res.status(404).json({ error: `${humanName} not found` });
        }

        const tag = loadTags(metadataPath).find((t) => t.id === tagId);
        const tagData = {
          id: tagId,
          title: metadata.title,
        };
        if (metadata.showTitle !== undefined) {
          tagData.showTitle = metadata.showTitle;
        }
        if (tag && tag.cover) {
          tagData.cover = tag.cover;
        }

        res.json({
          status: "success",
          [responseKey]: tagData,
        });
      } catch (err) {
        console.error(`Failed to update ${humanName.toLowerCase()} ${tagTitle}:`, err.message);
        res.status(500).json({ error: `Failed to update ${humanName.toLowerCase()}` });
      }
    });

    app.delete(`${normalizedRouteBase}/:tagTitle`, requireToken, (req, res) => {
      const tagTitle = decodeURIComponent(req.params.tagTitle);
      const tags = loadTags(metadataPath);

      const tag = tags.find(
        (item) => item.title.toLowerCase() === tagTitle.toLowerCase()
      );
      if (!tag) {
        return res.status(404).json({ error: `${humanName} not found` });
      }

      const tagTitleLower = tagTitle.toLowerCase();
      const isUsed = Object.values(allGames).some((game) => {
        const values = game[gameField];
        if (!values) return false;
        if (Array.isArray(values)) {
          return values.some((value) => String(value).toLowerCase() === tagTitleLower);
        }
        return String(values).toLowerCase() === tagTitleLower;
      });

      if (isUsed) {
        return res.status(409).json({
          error: `${humanName} is still in use by one or more games`,
          [responseKey]: tagTitle,
        });
      }

      try {
        deleteTag(metadataPath, tagTitle);
        res.json({ status: "success" });
      } catch (err) {
        console.error(`Failed to delete ${humanName.toLowerCase()} ${tagTitle}:`, err.message);
        res.status(500).json({ error: `Failed to delete ${humanName.toLowerCase()}` });
      }
    });

    app.post(`${normalizedRouteBase}/:tagTitle/upload-cover`, requireToken, upload.single("file"), (req, res) => {
      const tagTitle = decodeURIComponent(req.params.tagTitle);
      const tagId = findTagIdByTitle(metadataPath, tagTitle);

      if (!tagId) {
        return res.status(404).json({ error: `${humanName} not found` });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const mimeType = file.mimetype;
      if (!mimeType.startsWith("image/")) {
        return res.status(400).json({ error: "File must be an image" });
      }

      try {
        const tagDir = getTagDir(metadataPath, tagId);
        ensureDirectoryExists(tagDir);
        const coverPath = path.join(tagDir, "cover.webp");
        fs.writeFileSync(coverPath, file.buffer);

        res.json({
          status: "success",
          [responseKey]: {
            title: tagTitle,
            cover: `/${coverPrefix}/${encodeURIComponent(tagTitle)}`,
          },
        });
      } catch (error) {
        console.error(`Failed to save cover for ${humanName.toLowerCase()} ${tagTitle}:`, error);
        res.status(500).json({ error: "Failed to save cover image" });
      }
    });

    app.delete(`${normalizedRouteBase}/:tagTitle/delete-cover`, requireToken, (req, res) => {
      const tagTitle = decodeURIComponent(req.params.tagTitle);
      const tagId = findTagIdByTitle(metadataPath, tagTitle);
      if (!tagId) {
        return res.status(404).json({ error: `${humanName} not found` });
      }

      try {
        deleteMediaFile({
          metadataPath,
          resourceId: tagId,
          resourceType,
          mediaType: "cover",
        });

        const tagData = {
          title: tagTitle,
        };
        const coverPath = path.join(metadataPath, "content", contentFolder, String(tagId), "cover.webp");
        if (fs.existsSync(coverPath)) {
          tagData.cover = `/${coverPrefix}/${encodeURIComponent(tagTitle)}`;
        }

        res.json({
          status: "success",
          [responseKey]: tagData,
        });
      } catch (error) {
        console.error(`Failed to delete cover for ${humanName.toLowerCase()} ${tagTitle}:`, error);
        res.status(500).json({ error: "Failed to delete cover image" });
      }
    });
  }

  function deleteTagIfUnused(metadataPath, metadataGamesDir, tagTitle, allGamesFromFile) {
    const tags = loadTags(metadataPath);
    const tag = tags.find(
      (item) => item.title.toLowerCase() === tagTitle.toLowerCase()
    );
    if (!tag) {
      return false;
    }

    const tagTitleLower = tagTitle.toLowerCase();
    const isUsed = Object.values(allGamesFromFile).some((game) => {
      const values = game[gameField];
      if (!values) return false;
      if (Array.isArray(values)) {
        return values.some((value) => String(value).toLowerCase() === tagTitleLower);
      }
      return String(values).toLowerCase() === tagTitleLower;
    });

    if (isUsed) {
      return false;
    }

    deleteTag(metadataPath, tagTitle);

    return true;
  }

  return {
    loadTags,
    loadTag,
    ensureTagExists,
    ensureTagsExist,
    deleteTagIfUnused,
    registerTagRoutes,
  };
}

module.exports = {
  createTagRoutes,
};
