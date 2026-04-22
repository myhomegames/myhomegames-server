// routes/igdb.js
// IGDB API routes for game search and details

const https = require("https");
const { coerceToGameTypeId } = require("../utils/igdbGameType");

// IGDB Access Token cache (per clientId)
const igdbTokenCache = new Map();

/**
 * Get IGDB access token (with caching per clientId)
 * @param {string} clientId - Twitch Client ID
 * @param {string} clientSecret - Twitch Client Secret
 * @returns {Promise<string>} Access token
 */
async function getIGDBAccessToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error("IGDB credentials (clientId and clientSecret) are required");
  }

  // Check cache for this specific clientId
  const cacheKey = clientId;
  const cached = igdbTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  return new Promise((resolve, reject) => {
    const postData = `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;

    const options = {
      hostname: "id.twitch.tv",
      path: "/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            const token = json.access_token;
            const expiry = Date.now() + json.expires_in * 1000 - 60000; // Refresh 1 min before expiry
            // Cache token for this clientId
            igdbTokenCache.set(cacheKey, { token, expiry });
            resolve(token);
          } else {
            reject(new Error("Failed to get IGDB access token"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Run one IGDB search and return raw games array.
 * @param {string} searchQuery - Exact string to send to IGDB search (e.g. "aero fighters assault" or "aerofightersassault")
 * @param {string} accessToken - IGDB access token
 * @param {string} clientId - Twitch Client ID
 * @param {number|null} yearToFilter - Optional year to filter first_release_date
 * @returns {Promise<Array>} Raw game objects from IGDB
 */
function runIGDBSearch(searchQuery, accessToken, clientId, yearToFilter) {
  let postData = `search "${searchQuery}"; fields id,name,summary,cover.url,first_release_date,genres.name,rating,aggregated_rating,collections.name,franchises.name,game_type;`;
  if (yearToFilter !== null && yearToFilter !== undefined) {
    const yearStart = Math.floor(new Date(yearToFilter, 0, 1).getTime() / 1000);
    const yearEnd = Math.floor(new Date(yearToFilter, 11, 31, 23, 59, 59).getTime() / 1000);
    postData += ` where first_release_date >= ${yearStart} & first_release_date <= ${yearEnd};`;
  }
  postData += ` limit 20;`;

  const options = {
    hostname: "api.igdb.com",
    path: "/v4/games",
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      if (res.statusCode !== 200) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => reject(new Error(`IGDB API error ${res.statusCode}: ${data}`)));
        return;
      }
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const games = JSON.parse(data);
          resolve(Array.isArray(games) ? games : []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch a single game from IGDB by id (same fields as search for consistent response shape).
 * @param {number} id - IGDB game ID
 * @param {string} accessToken - IGDB access token
 * @param {string} clientId - Twitch Client ID
 * @returns {Promise<Array>} Raw game objects from IGDB (0 or 1 element)
 */
function runIGDBGameById(id, accessToken, clientId) {
  const postData = `fields id,name,summary,cover.url,first_release_date,genres.name,rating,aggregated_rating,collections.name,franchises.name,game_type; where id = ${id}; limit 1;`;

  const options = {
    hostname: "api.igdb.com",
    path: "/v4/games",
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      if (res.statusCode !== 200) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => reject(new Error(`IGDB API error ${res.statusCode}: ${data}`)));
        return;
      }
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const games = JSON.parse(data);
          resolve(Array.isArray(games) ? games : []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch game names from IGDB by id list.
 * @param {number[]} ids - IGDB game IDs
 * @param {string} accessToken - IGDB access token
 * @param {string} clientId - Twitch Client ID
 * @returns {Promise<Map<number, string>>} Map of id -> name (only for found games)
 */
function fetchIGDBGameNamesByIds(ids, accessToken, clientId) {
  if (!ids || ids.length === 0) return Promise.resolve(new Map());
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id)))];
  if (uniqueIds.length === 0) return Promise.resolve(new Map());

  const postData = `fields id,name; where id = (${uniqueIds.join(",")});`;

  const options = {
    hostname: "api.igdb.com",
    path: "/v4/games",
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      if (res.statusCode !== 200) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => reject(new Error(`IGDB API error ${res.statusCode}: ${data}`)));
        return;
      }
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const games = JSON.parse(data);
          const map = new Map();
          (Array.isArray(games) ? games : []).forEach((g) => {
            if (g != null && g.id != null && g.name != null) {
              map.set(Number(g.id), String(g.name).trim());
            }
          });
          resolve(map);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch game names, covers and release year from IGDB by id list.
 * @param {number[]} ids - IGDB game IDs
 * @param {string} accessToken - IGDB access token
 * @param {string} clientId - Twitch Client ID
 * @returns {Promise<Map<number, { name: string, cover?: string, releaseDate?: number }>>} Map of id -> { name, cover?, releaseDate? }
 */
function fetchIGDBGameDetailsByIds(ids, accessToken, clientId) {
  if (!ids || ids.length === 0) return Promise.resolve(new Map());
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id)))];
  if (uniqueIds.length === 0) return Promise.resolve(new Map());

  const postData = `fields id,name,cover.url,first_release_date; where id = (${uniqueIds.join(",")});`;

  const options = {
    hostname: "api.igdb.com",
    path: "/v4/games",
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      if (res.statusCode !== 200) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => reject(new Error(`IGDB API error ${res.statusCode}: ${data}`)));
        return;
      }
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const games = JSON.parse(data);
          const map = new Map();
          const { formatIGDBReleaseDate } = require("../utils/dateUtils");
          (Array.isArray(games) ? games : []).forEach((g) => {
            if (g != null && g.id != null && g.name != null) {
              let coverUrl = g.cover && g.cover.url ? String(g.cover.url).trim() : null;
              if (coverUrl) {
                if (coverUrl.startsWith("//")) coverUrl = `https:${coverUrl}`;
                coverUrl = coverUrl.replace("t_thumb", "t_1080p").replace("t_cover_small", "t_1080p").replace("t_cover_big", "t_1080p");
              }
              const { releaseDate } = formatIGDBReleaseDate(g.first_release_date);
              map.set(Number(g.id), {
                name: String(g.name).trim(),
                cover: coverUrl || undefined,
                releaseDate: releaseDate ?? undefined,
              });
            }
          });
          resolve(map);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Register IGDB routes
 * @param {express.App} app - Express app instance
 * @param {Function} requireToken - Authentication middleware
 */
function registerIGDBRoutes(app, requireToken) {
  // Endpoint: search games on IGDB
  const handleSearch = async (req, res) => {
    const rawQuery = (req.method === "POST" && req.body && typeof req.body.query === "string")
      ? req.body.query
      : req.query.q;
    if (!rawQuery || typeof rawQuery !== "string") {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Missing search query" });
    }
    const query = rawQuery.trim().replace(/\s+/g, " ");
    if (query === "") {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Missing search query" });
    }

    // Get optional year filter (legacy) or full release date for filtering/sorting by closest
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    let releaseDateTimestamp = null;
    const releaseDateParam = req.query.releaseDate;
    if (releaseDateParam !== undefined && releaseDateParam !== null && releaseDateParam !== "") {
      const parsed = Number(releaseDateParam);
      if (!Number.isNaN(parsed) && parsed > 0) {
        releaseDateTimestamp = parsed < 10000000000 ? parsed : Math.floor(parsed / 1000);
      } else if (typeof releaseDateParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(releaseDateParam.trim())) {
        releaseDateTimestamp = Math.floor(new Date(releaseDateParam.trim()).getTime() / 1000);
      }
    }

    // Get Twitch credentials from headers or query params
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;

    if (!clientId || !clientSecret) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required. Send them via X-Twitch-Client-Id and X-Twitch-Client-Secret headers, or clientId and clientSecret query parameters." });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);
      // Filter by year only when explicitly requested (query param year). When releaseDate is passed,
      // do not filter by year so we get all name matches and then sort by closest date.
      const yearToFilter = year !== null && !isNaN(year) ? year : null;

      let rawGames;

      // Search by IGDB ID if query is a single numeric id
      const numericId = /^\d+$/.test(query) ? parseInt(query, 10) : null;
      if (numericId !== null) {
        rawGames = await runIGDBGameById(numericId, accessToken, clientId);
      } else {
        const words = query.split(/\s+/).filter(Boolean);
        const seenIds = new Set();

        const mergeResults = (games) => {
          for (const g of games) {
            if (!seenIds.has(g.id)) {
              seenIds.add(g.id);
              rawGames.push(g);
            }
          }
        };

        rawGames = [];
        const initial = await runIGDBSearch(query, accessToken, clientId, yearToFilter);
        initial.forEach((g) => {
          if (!seenIds.has(g.id)) {
            seenIds.add(g.id);
            rawGames.push(g);
          }
        });

        const extraQueries = [];
        if (words.length >= 2) {
          const firstTwoMerged = words[0] + words[1] + (words.length > 2 ? " " + words.slice(2).join(" ") : "");
          if (firstTwoMerged !== query) extraQueries.push(firstTwoMerged);
        }
        const queryNoSpaces = query.replace(/\s/g, "");
        if (queryNoSpaces.length > 0 && queryNoSpaces !== query) extraQueries.push(queryNoSpaces);

        for (const q of extraQueries) {
          try {
            const more = await runIGDBSearch(q, accessToken, clientId, yearToFilter);
            mergeResults(more);
          } catch (_) {
            /* ignore: use only first search result */
          }
        }
      }

      const { formatIGDBReleaseDate } = require("../utils/dateUtils");
      const formattedGames = rawGames.map((game) => {
        const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(game.first_release_date);
        const typeId = coerceToGameTypeId(game.game_type);
        return {
          id: game.id,
          name: game.name,
          summary: game.summary || "",
          cover: game.cover
            ? `https:${game.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
            : null,
          releaseDate,
          releaseDateFull,
          genres: game.genres ? game.genres.map((g) => g.name || g).filter(Boolean) : [],
          criticRating: game.aggregated_rating ? Math.round(game.aggregated_rating / 10) : null,
          userRating: game.rating ? Math.round(game.rating / 10) : null,
          series: (game.collections || []).map((c) => ({ id: c.id, name: c.name || "" })).filter((c) => c.name),
          franchise: (game.franchises || []).map((f) => ({ id: f.id, name: f.name || "" })).filter((f) => f.name),
          ...(typeId != null ? { type: typeId } : {}),
        };
      });

      if (releaseDateTimestamp !== null) {
        formattedGames.sort((a, b) => {
          const aTs = a.releaseDateFull?.timestamp;
          const bTs = b.releaseDateFull?.timestamp;
          const aDist = aTs != null ? Math.abs(aTs - releaseDateTimestamp) : Infinity;
          const bDist = bTs != null ? Math.abs(bTs - releaseDateTimestamp) : Infinity;
          if (aDist !== bDist) return aDist - bDist;
          if (aTs != null && bTs != null) return aTs - bTs;
          return (aTs != null ? 0 : 1) - (bTs != null ? 0 : 1);
        });
      } else {
        formattedGames.sort((a, b) => {
          const aHasDate = a.releaseDateFull && a.releaseDateFull.timestamp != null;
          const bHasDate = b.releaseDateFull && b.releaseDateFull.timestamp != null;
          if (aHasDate && bHasDate) return a.releaseDateFull.timestamp - b.releaseDateFull.timestamp;
          if (aHasDate && !bHasDate) return -1;
          if (!aHasDate && bHasDate) return 1;
          return 0;
        });
      }

      res.setHeader('Content-Type', 'application/json');
      res.json({ games: formattedGames });
    } catch (err) {
      console.error("IGDB search error:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: "Failed to search IGDB", detail: err.message });
    }
  };

  app.get("/igdb/search", requireToken, handleSearch);
  app.post("/igdb/search", requireToken, handleSearch);

  // Endpoint: get game names by IGDB ids (for resolving similar games not in library)
  app.get("/igdb/game-names-by-ids", requireToken, async (req, res) => {
    const rawIds = req.query.ids;
    if (!rawIds || typeof rawIds !== "string") {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Missing query parameter: ids (comma-separated IGDB game IDs)" });
    }
    const ids = rawIds
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((id) => !Number.isNaN(id));
    if (ids.length === 0) {
      res.setHeader("Content-Type", "application/json");
      return res.json({ names: {}, covers: {}, releaseDates: {} });
    }
    if (ids.length > 500) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "At most 500 ids allowed" });
    }

    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required (X-Twitch-Client-Id, X-Twitch-Client-Secret)." });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);
      const detailsMap = await fetchIGDBGameDetailsByIds(ids, accessToken, clientId);
      const names = {};
      const covers = {};
      const releaseDates = {};
      detailsMap.forEach((details, id) => {
        names[String(id)] = details.name;
        if (details.cover) covers[String(id)] = details.cover;
        if (details.releaseDate != null) releaseDates[String(id)] = details.releaseDate;
      });
      res.setHeader("Content-Type", "application/json");
      res.json({ names, covers, releaseDates });
    } catch (err) {
      console.error("IGDB game-names-by-ids error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch names from IGDB", detail: err.message });
    }
  });

  function parseExcludeIds(req) {
    const fromQuery = req.query.excludeIds;
    const fromBody = req.body && req.body.excludeIds;
    if (Array.isArray(fromBody)) {
      return fromBody.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
    }
    if (fromBody && typeof fromBody === "string") {
      return fromBody.split(",").map((s) => parseInt(s.trim(), 10)).filter((id) => !Number.isNaN(id));
    }
    if (fromQuery && typeof fromQuery === "string") {
      return fromQuery.split(",").map((s) => parseInt(s.trim(), 10)).filter((id) => !Number.isNaN(id));
    }
    return [];
  }

  // Endpoint: get IGDB games by franchise ID (excludes library games)
  const handleGamesByFranchise = async (req, res) => {
    const franchiseId = parseInt(req.params.franchiseId, 10);
    const excludeIds = parseExcludeIds(req);
    if (Number.isNaN(franchiseId) || franchiseId < 1) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Invalid franchise ID" });
    }

    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);
      const postData = `fields id,name,cover.url,first_release_date; where franchises = (${franchiseId}); limit 100;`;

      const options = {
        hostname: "api.igdb.com",
        path: "/v4/games",
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      let games = await new Promise((resolve, reject) => {
        const req2 = https.request(options, (res2) => {
          let data = "";
          res2.on("data", (chunk) => { data += chunk; });
          res2.on("end", () => {
            try {
              if (res2.statusCode !== 200) {
                reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
                return;
              }
              const parsed = JSON.parse(data);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              reject(e);
            }
          });
        });
        req2.on("error", reject);
        req2.write(postData);
        req2.end();
      });

      if (excludeIds.length > 0) {
        const excludeSet = new Set(excludeIds);
        games = games.filter((g) => !excludeSet.has(g.id));
      }

      const { formatIGDBReleaseDate } = require("../utils/dateUtils");
      const formatted = games.map((g) => {
        const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
        const cover = g.cover && g.cover.url
          ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
          : null;
        return {
          id: g.id,
          name: g.name || "",
          cover,
          releaseDate: releaseDateFull?.year ?? null,
          firstReleaseDate: g.first_release_date,
        };
      });

      formatted.sort((a, b) => {
        const aTs = a.firstReleaseDate ?? 0;
        const bTs = b.firstReleaseDate ?? 0;
        return aTs - bTs;
      });

      res.setHeader("Content-Type", "application/json");
      res.json({ games: formatted });
    } catch (err) {
      console.error("IGDB games-by-franchise error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
    }
  };

  app.get("/igdb/games-by-franchise/:franchiseId", requireToken, handleGamesByFranchise);
  app.post("/igdb/games-by-franchise/:franchiseId", requireToken, handleGamesByFranchise);

  // Endpoint: get IGDB games by collection ID (series) - excludes library games
  const handleGamesByCollection = async (req, res) => {
    const collectionId = parseInt(req.params.collectionId, 10);
    const excludeIds = parseExcludeIds(req);
    if (Number.isNaN(collectionId) || collectionId < 1) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Invalid collection ID" });
    }

    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);
      const postData = `fields id,name,cover.url,first_release_date; where collections = (${collectionId}); limit 100;`;

      const options = {
        hostname: "api.igdb.com",
        path: "/v4/games",
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      let games = await new Promise((resolve, reject) => {
        const req2 = https.request(options, (res2) => {
          let data = "";
          res2.on("data", (chunk) => { data += chunk; });
          res2.on("end", () => {
            try {
              if (res2.statusCode !== 200) {
                reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
                return;
              }
              const parsed = JSON.parse(data);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              reject(e);
            }
          });
        });
        req2.on("error", reject);
        req2.write(postData);
        req2.end();
      });

      if (excludeIds.length > 0) {
        const excludeSet = new Set(excludeIds);
        games = games.filter((g) => !excludeSet.has(g.id));
      }

      const { formatIGDBReleaseDate } = require("../utils/dateUtils");
      const formatted = games.map((g) => {
        const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
        const cover = g.cover && g.cover.url
          ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
          : null;
        return {
          id: g.id,
          name: g.name || "",
          cover,
          releaseDate: releaseDateFull?.year ?? null,
          firstReleaseDate: g.first_release_date,
        };
      });

      formatted.sort((a, b) => {
        const aTs = a.firstReleaseDate ?? 0;
        const bTs = b.firstReleaseDate ?? 0;
        return aTs - bTs;
      });

      res.setHeader("Content-Type", "application/json");
      res.json({ games: formatted });
    } catch (err) {
      console.error("IGDB games-by-collection error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
    }
  };

  app.get("/igdb/games-by-collection/:collectionId", requireToken, handleGamesByCollection);
  app.post("/igdb/games-by-collection/:collectionId", requireToken, handleGamesByCollection);

  // Helper: fetch IGDB games by a single relation (themes, platforms, game_modes, player_perspectives, game_engines, genres)
  const igdbRelationFieldMap = {
    themes: "themes",
    platforms: "platforms",
    "game-modes": "game_modes",
    "player-perspectives": "player_perspectives",
    "game-engines": "game_engines",
    genres: "genres",
  };

  function createGamesByRelationHandler(relationRouteKey) {
    const igdbField = igdbRelationFieldMap[relationRouteKey];
    return async (req, res) => {
      const tagId = parseInt(req.params.tagId, 10);
      const excludeIds = parseExcludeIds(req);
      if (Number.isNaN(tagId) || tagId < 1) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Invalid tag ID" });
      }

      const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
      const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
      if (!clientId || !clientSecret) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
      }

      try {
        const accessToken = await getIGDBAccessToken(clientId, clientSecret);
        const postData = `fields id,name,cover.url,first_release_date; where ${igdbField} = (${tagId}); limit 100;`;
        const options = {
          hostname: "api.igdb.com",
          path: "/v4/games",
          method: "POST",
          headers: {
            "Client-ID": clientId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "text/plain",
            "Content-Length": Buffer.byteLength(postData),
          },
        };

        let games = await new Promise((resolve, reject) => {
          const req2 = https.request(options, (res2) => {
            let data = "";
            res2.on("data", (chunk) => { data += chunk; });
            res2.on("end", () => {
              try {
                if (res2.statusCode !== 200) {
                  reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                reject(e);
              }
            });
          });
          req2.on("error", reject);
          req2.write(postData);
          req2.end();
        });

        if (excludeIds.length > 0) {
          const excludeSet = new Set(excludeIds);
          games = games.filter((g) => !excludeSet.has(g.id));
        }

        const { formatIGDBReleaseDate } = require("../utils/dateUtils");
        const formatted = games.map((g) => {
          const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
          const cover = g.cover && g.cover.url
            ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
            : null;
          return {
            id: g.id,
            name: g.name || "",
            cover,
            releaseDate: releaseDateFull?.year ?? null,
            firstReleaseDate: g.first_release_date,
          };
        });

        formatted.sort((a, b) => {
          const aTs = a.firstReleaseDate ?? 0;
          const bTs = b.firstReleaseDate ?? 0;
          return aTs - bTs;
        });

        res.setHeader("Content-Type", "application/json");
        res.json({ games: formatted });
      } catch (err) {
        console.error(`IGDB games-by-${relationRouteKey} error:`, err);
        res.setHeader("Content-Type", "application/json");
        res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
      }
    };
  }

  app.get("/igdb/games-by-theme/:tagId", requireToken, createGamesByRelationHandler("themes"));
  app.post("/igdb/games-by-theme/:tagId", requireToken, createGamesByRelationHandler("themes"));
  app.get("/igdb/games-by-platform/:tagId", requireToken, createGamesByRelationHandler("platforms"));
  app.post("/igdb/games-by-platform/:tagId", requireToken, createGamesByRelationHandler("platforms"));
  app.get("/igdb/games-by-game-mode/:tagId", requireToken, createGamesByRelationHandler("game-modes"));
  app.post("/igdb/games-by-game-mode/:tagId", requireToken, createGamesByRelationHandler("game-modes"));
  app.get("/igdb/games-by-player-perspective/:tagId", requireToken, createGamesByRelationHandler("player-perspectives"));
  app.post("/igdb/games-by-player-perspective/:tagId", requireToken, createGamesByRelationHandler("player-perspectives"));
  app.get("/igdb/games-by-game-engine/:tagId", requireToken, createGamesByRelationHandler("game-engines"));
  app.post("/igdb/games-by-game-engine/:tagId", requireToken, createGamesByRelationHandler("game-engines"));
  app.get("/igdb/games-by-genre/:tagId", requireToken, createGamesByRelationHandler("genres"));
  app.post("/igdb/games-by-genre/:tagId", requireToken, createGamesByRelationHandler("genres"));

  // By-name: resolve tag name to IGDB id then fetch games (for library-style hash URLs when name is in query or from tagLabels)
  const igdbTagPathMapForName = {
    themes: "/v4/themes",
    platforms: "/v4/platforms",
    "game-modes": "/v4/game_modes",
    "player-perspectives": "/v4/player_perspectives",
    "game-engines": "/v4/game_engines",
    genres: "/v4/genres",
  };

  function createGamesByRelationByNameHandler(relationRouteKey) {
    const igdbField = igdbRelationFieldMap[relationRouteKey];
    const tagPath = igdbTagPathMapForName[relationRouteKey];
    return async (req, res) => {
      const name = (req.body && typeof req.body.name === "string" ? req.body.name : req.params.tagName || "").trim();
      const excludeIds = parseExcludeIds(req);
      if (!name) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Tag name is required" });
      }

      const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
      const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
      if (!clientId || !clientSecret) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
      }

      try {
        const accessToken = await getIGDBAccessToken(clientId, clientSecret);
        const escapedName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const tagPostData = `fields id,name; where name = "${escapedName}"; limit 1;`;
        const tagOptions = {
          hostname: "api.igdb.com",
          path: tagPath,
          method: "POST",
          headers: {
            "Client-ID": clientId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "text/plain",
            "Content-Length": Buffer.byteLength(tagPostData),
          },
        };

        const tagResult = await new Promise((resolve, reject) => {
          const reqTag = https.request(tagOptions, (resTag) => {
            let data = "";
            resTag.on("data", (chunk) => { data += chunk; });
            resTag.on("end", () => {
              try {
                if (resTag.statusCode !== 200) {
                  resolve([]);
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                resolve([]);
              }
            });
          });
          reqTag.on("error", reject);
          reqTag.write(tagPostData);
          reqTag.end();
        });

        const tagId = tagResult.length > 0 && tagResult[0].id != null ? tagResult[0].id : null;
        if (tagId == null) {
          res.setHeader("Content-Type", "application/json");
          return res.json({ games: [] });
        }

        const postData = `fields id,name,cover.url,first_release_date; where ${igdbField} = (${tagId}); limit 100;`;
        const options = {
          hostname: "api.igdb.com",
          path: "/v4/games",
          method: "POST",
          headers: {
            "Client-ID": clientId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "text/plain",
            "Content-Length": Buffer.byteLength(postData),
          },
        };

        let games = await new Promise((resolve, reject) => {
          const req2 = https.request(options, (res2) => {
            let data = "";
            res2.on("data", (chunk) => { data += chunk; });
            res2.on("end", () => {
              try {
                if (res2.statusCode !== 200) {
                  reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                reject(e);
              }
            });
          });
          req2.on("error", reject);
          req2.write(postData);
          req2.end();
        });

        if (excludeIds.length > 0) {
          const excludeSet = new Set(excludeIds);
          games = games.filter((g) => !excludeSet.has(g.id));
        }

        const { formatIGDBReleaseDate } = require("../utils/dateUtils");
        const formatted = games.map((g) => {
          const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
          const cover = g.cover && g.cover.url
            ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
            : null;
          return {
            id: g.id,
            name: g.name || "",
            cover,
            releaseDate: releaseDateFull?.year ?? null,
            firstReleaseDate: g.first_release_date,
          };
        });

        formatted.sort((a, b) => {
          const aTs = a.firstReleaseDate ?? 0;
          const bTs = b.firstReleaseDate ?? 0;
          return aTs - bTs;
        });

        res.setHeader("Content-Type", "application/json");
        res.json({ games: formatted });
      } catch (err) {
        console.error(`IGDB games-by-${relationRouteKey}-by-name error:`, err);
        res.setHeader("Content-Type", "application/json");
        res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
      }
    };
  }

  app.post("/igdb/games-by-theme-by-name", requireToken, createGamesByRelationByNameHandler("themes"));
  app.post("/igdb/games-by-platform-by-name", requireToken, createGamesByRelationByNameHandler("platforms"));
  app.post("/igdb/games-by-game-mode-by-name", requireToken, createGamesByRelationByNameHandler("game-modes"));
  app.post("/igdb/games-by-player-perspective-by-name", requireToken, createGamesByRelationByNameHandler("player-perspectives"));
  app.post("/igdb/games-by-game-engine-by-name", requireToken, createGamesByRelationByNameHandler("game-engines"));
  app.post("/igdb/games-by-genre-by-name", requireToken, createGamesByRelationByNameHandler("genres"));

  // Games by company (developer or publisher) via involved_companies
  async function fetchGamesByCompanyRole(companyId, role, excludeIds, clientId, clientSecret) {
    const accessToken = await getIGDBAccessToken(clientId, clientSecret);
    const roleField = role === "developer" ? "developer" : "publisher";
    const invPostData = `fields game; where company = (${companyId}) & ${roleField} = true; limit 500;`;
    const invOptions = {
      hostname: "api.igdb.com",
      path: "/v4/involved_companies",
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(invPostData),
      },
    };
    const invResult = await new Promise((resolve, reject) => {
      const reqInv = https.request(invOptions, (resInv) => {
        let data = "";
        resInv.on("data", (chunk) => { data += chunk; });
        resInv.on("end", () => {
          try {
            if (resInv.statusCode !== 200) {
              reject(new Error(`IGDB API error ${resInv.statusCode}: ${data}`));
              return;
            }
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (e) {
            reject(e);
          }
        });
      });
      reqInv.on("error", reject);
      reqInv.write(invPostData);
      reqInv.end();
    });
    const gameIds = [...new Set(invResult.map((r) => r.game).filter((id) => id != null))];
    if (gameIds.length === 0) {
      return [];
    }
    const idList = gameIds.slice(0, 100).join(",");
    const postData = `fields id,name,cover.url,first_release_date; where id = (${idList}); limit 100;`;
    const options = {
      hostname: "api.igdb.com",
      path: "/v4/games",
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    let games = await new Promise((resolve, reject) => {
      const req2 = https.request(options, (res2) => {
        let data = "";
        res2.on("data", (chunk) => { data += chunk; });
        res2.on("end", () => {
          try {
            if (res2.statusCode !== 200) {
              reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
              return;
            }
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (e) {
            reject(e);
          }
        });
      });
      req2.on("error", reject);
      req2.write(postData);
      req2.end();
    });
    if (excludeIds.length > 0) {
      const excludeSet = new Set(excludeIds);
      games = games.filter((g) => !excludeSet.has(g.id));
    }
    const { formatIGDBReleaseDate } = require("../utils/dateUtils");
    return games.map((g) => {
      const { releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
      const cover = g.cover && g.cover.url
        ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
        : null;
      return {
        id: g.id,
        name: g.name || "",
        cover,
        releaseDate: releaseDateFull?.year ?? null,
        firstReleaseDate: g.first_release_date,
      };
    }).sort((a, b) => (a.firstReleaseDate ?? 0) - (b.firstReleaseDate ?? 0));
  }

  const handleGamesByDeveloper = async (req, res) => {
    const companyId = parseInt(req.params.companyId, 10);
    const excludeIds = parseExcludeIds(req);
    if (Number.isNaN(companyId) || companyId < 1) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Invalid company ID" });
    }
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }
    try {
      const formatted = await fetchGamesByCompanyRole(companyId, "developer", excludeIds, clientId, clientSecret);
      res.setHeader("Content-Type", "application/json");
      res.json({ games: formatted });
    } catch (err) {
      console.error("IGDB games-by-developer error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
    }
  };

  const handleGamesByPublisher = async (req, res) => {
    const companyId = parseInt(req.params.companyId, 10);
    const excludeIds = parseExcludeIds(req);
    if (Number.isNaN(companyId) || companyId < 1) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Invalid company ID" });
    }
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }
    try {
      const formatted = await fetchGamesByCompanyRole(companyId, "publisher", excludeIds, clientId, clientSecret);
      res.setHeader("Content-Type", "application/json");
      res.json({ games: formatted });
    } catch (err) {
      console.error("IGDB games-by-publisher error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
    }
  };

  app.get("/igdb/games-by-developer/:companyId", requireToken, handleGamesByDeveloper);
  app.post("/igdb/games-by-developer/:companyId", requireToken, handleGamesByDeveloper);
  app.get("/igdb/games-by-publisher/:companyId", requireToken, handleGamesByPublisher);
  app.post("/igdb/games-by-publisher/:companyId", requireToken, handleGamesByPublisher);

  function createGamesByCompanyByNameHandler(role) {
    return async (req, res) => {
      const name = (req.body && typeof req.body.name === "string" ? req.body.name : "").trim();
      const excludeIds = parseExcludeIds(req);
      if (!name) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Company name is required" });
      }
      const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
      const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
      if (!clientId || !clientSecret) {
        res.setHeader("Content-Type", "application/json");
        return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
      }
      try {
        const accessToken = await getIGDBAccessToken(clientId, clientSecret);
        const escapedName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const companyPostData = `fields id,name; search "${escapedName}"; limit 1;`;
        const companyOptions = {
          hostname: "api.igdb.com",
          path: "/v4/companies",
          method: "POST",
          headers: {
            "Client-ID": clientId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "text/plain",
            "Content-Length": Buffer.byteLength(companyPostData),
          },
        };
        const companyResult = await new Promise((resolve, reject) => {
          const reqC = https.request(companyOptions, (resC) => {
            let data = "";
            resC.on("data", (chunk) => { data += chunk; });
            resC.on("end", () => {
              try {
                if (resC.statusCode !== 200) {
                  resolve([]);
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                resolve([]);
              }
            });
          });
          reqC.on("error", reject);
          reqC.write(companyPostData);
          reqC.end();
        });
        const companyId = companyResult.length > 0 && companyResult[0].id != null ? companyResult[0].id : null;
        if (companyId == null) {
          res.setHeader("Content-Type", "application/json");
          return res.json({ games: [] });
        }
        const formatted = await fetchGamesByCompanyRole(companyId, role, excludeIds, clientId, clientSecret);
        res.setHeader("Content-Type", "application/json");
        res.json({ games: formatted });
      } catch (err) {
        console.error(`IGDB games-by-${role}-by-name error:`, err);
        res.setHeader("Content-Type", "application/json");
        res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
      }
    };
  }

  app.post("/igdb/games-by-developer-by-name", requireToken, createGamesByCompanyByNameHandler("developer"));
  app.post("/igdb/games-by-publisher-by-name", requireToken, createGamesByCompanyByNameHandler("publisher"));

  // Resolve IGDB tag id to name (for display when tag is not in library)
  const igdbTagPathMap = {
    themes: "/v4/themes",
    platforms: "/v4/platforms",
    "game-modes": "/v4/game_modes",
    "player-perspectives": "/v4/player_perspectives",
    "game-engines": "/v4/game_engines",
    genres: "/v4/genres",
    companies: "/v4/companies",
  };
  app.get("/igdb/tag-name/:type/:tagId", requireToken, async (req, res) => {
    const type = req.params.type;
    const tagId = parseInt(req.params.tagId, 10);
    const pathSuffix = igdbTagPathMap[type];
    if (!pathSuffix || Number.isNaN(tagId) || tagId < 1) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Invalid type or tag ID" });
    }
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }
    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);
      const postData = `fields name; where id = ${tagId};`;
      const options = {
        hostname: "api.igdb.com",
        path: pathSuffix,
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(postData),
        },
      };
      const data = await new Promise((resolve, reject) => {
        const req2 = https.request(options, (res2) => {
          let body = "";
          res2.on("data", (chunk) => { body += chunk; });
          res2.on("end", () => {
            try {
              if (res2.statusCode !== 200) {
                resolve(null);
                return;
              }
              const parsed = JSON.parse(body);
              resolve(Array.isArray(parsed) && parsed[0] && parsed[0].name ? parsed[0].name : null);
            } catch (e) {
              resolve(null);
            }
          });
        });
        req2.on("error", () => resolve(null));
        req2.write(postData);
        req2.end();
      });
      res.setHeader("Content-Type", "application/json");
      res.json({ name: data });
    } catch (err) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch tag name", detail: err.message });
    }
  });

  // Endpoint: get IGDB games by keyword name (for recommended sections when Twitch login enabled)
  const handleGamesByKeyword = async (req, res) => {
    const keyword = req.body && typeof req.body.keyword === "string" ? req.body.keyword.trim() : null;
    const excludeIds = parseExcludeIds(req);
    if (!keyword || keyword.length === 0) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Missing or invalid keyword" });
    }

    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;
    if (!clientId || !clientSecret) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required" });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);

      const escapedKeyword = keyword.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      // Try 1: filter by exact name (more reliable than search for known keyword names)
      let keywordPostData = `fields id,name; where name = "${escapedKeyword}"; limit 5;`;
      const keywordOptions = {
        hostname: "api.igdb.com",
        path: "/v4/keywords",
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(keywordPostData),
        },
      };

      let keywordsResult = await new Promise((resolve, reject) => {
        const reqKw = https.request(keywordOptions, (resKw) => {
          let data = "";
          resKw.on("data", (chunk) => { data += chunk; });
          resKw.on("end", () => {
            try {
              if (resKw.statusCode !== 200) {
                resolve([]);
                return;
              }
              const parsed = JSON.parse(data);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              resolve([]);
            }
          });
        });
        reqKw.on("error", reject);
        reqKw.write(keywordPostData);
        reqKw.end();
      });

      // Fallback: if no keyword found by name, try search (e.g. different casing in IGDB)
      if (keywordsResult.length === 0) {
        keywordPostData = `search "${escapedKeyword}"; fields id,name; limit 5;`;
        keywordOptions.headers["Content-Length"] = Buffer.byteLength(keywordPostData);
        keywordsResult = await new Promise((resolve, reject) => {
          const reqKw = https.request(keywordOptions, (resKw) => {
            let data = "";
            resKw.on("data", (chunk) => { data += chunk; });
            resKw.on("end", () => {
              try {
                if (resKw.statusCode !== 200) {
                  resolve([]);
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                resolve([]);
              }
            });
          });
          reqKw.on("error", reject);
          reqKw.write(keywordPostData);
          reqKw.end();
        });
      }

      // Fallback 2: try title-case name (e.g. "taste of power" -> "Taste Of Power")
      if (keywordsResult.length === 0 && keyword.indexOf(" ") >= 0) {
        const titleCase = keyword
          .split(" ")
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
          .join(" ");
        const escapedTitle = titleCase.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        keywordPostData = `fields id,name; where name = "${escapedTitle}"; limit 5;`;
        keywordOptions.headers["Content-Length"] = Buffer.byteLength(keywordPostData);
        keywordsResult = await new Promise((resolve, reject) => {
          const reqKw = https.request(keywordOptions, (resKw) => {
            let data = "";
            resKw.on("data", (chunk) => { data += chunk; });
            resKw.on("end", () => {
              try {
                if (resKw.statusCode !== 200) {
                  resolve([]);
                  return;
                }
                const parsed = JSON.parse(data);
                resolve(Array.isArray(parsed) ? parsed : []);
              } catch (e) {
                resolve([]);
              }
            });
          });
          reqKw.on("error", reject);
          reqKw.write(keywordPostData);
          reqKw.end();
        });
      }

      const keywordId = keywordsResult.length > 0 && keywordsResult[0].id != null ? keywordsResult[0].id : null;
      if (keywordId == null) {
        res.setHeader("Content-Type", "application/json");
        return res.json({ games: [] });
      }

      const postData = `fields id,name,cover.url,first_release_date; where keywords = (${keywordId}); limit 50;`;
      const options = {
        hostname: "api.igdb.com",
        path: "/v4/games",
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      let games = await new Promise((resolve, reject) => {
        const req2 = https.request(options, (res2) => {
          let data = "";
          res2.on("data", (chunk) => { data += chunk; });
          res2.on("end", () => {
            try {
              if (res2.statusCode !== 200) {
                reject(new Error(`IGDB API error ${res2.statusCode}: ${data}`));
                return;
              }
              const parsed = JSON.parse(data);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              reject(e);
            }
          });
        });
        req2.on("error", reject);
        req2.write(postData);
        req2.end();
      });

      if (excludeIds.length > 0) {
        const excludeSet = new Set(excludeIds);
        games = games.filter((g) => !excludeSet.has(g.id));
      }

      const { formatIGDBReleaseDate } = require("../utils/dateUtils");
      const formatted = games.map((g) => {
        const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(g.first_release_date);
        const cover = g.cover && g.cover.url
          ? `https:${g.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
          : null;
        return {
          id: g.id,
          name: g.name || "",
          cover,
          releaseDate: releaseDateFull?.year ?? null,
          firstReleaseDate: g.first_release_date,
        };
      });

      formatted.sort((a, b) => {
        const aTs = a.firstReleaseDate ?? 0;
        const bTs = b.firstReleaseDate ?? 0;
        return aTs - bTs;
      });

      res.setHeader("Content-Type", "application/json");
      res.json({ games: formatted });
    } catch (err) {
      console.error("IGDB games-by-keyword error:", err);
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "Failed to fetch games from IGDB", detail: err.message });
    }
  };

  app.post("/igdb/games-by-keyword", requireToken, handleGamesByKeyword);

  // Endpoint: get single IGDB game details with high-res cover
  app.get("/igdb/game/:igdbId", requireToken, async (req, res) => {
    const igdbId = req.params.igdbId;
    
    if (!igdbId || isNaN(parseInt(igdbId, 10))) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Invalid IGDB game ID" });
    }

    // Get Twitch credentials from headers or query params
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    const clientSecret = req.header("X-Twitch-Client-Secret") || req.query.clientSecret;

    if (!clientId || !clientSecret) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Twitch Client ID and Client Secret are required. Send them via X-Twitch-Client-Id and X-Twitch-Client-Secret headers, or clientId and clientSecret query parameters." });
    }

    try {
      const accessToken = await getIGDBAccessToken(clientId, clientSecret);

      const postData = `fields id,name,summary,cover.url,first_release_date,genres.name,themes.name,platforms.name,game_modes.name,player_perspectives.name,websites.url,websites.category,rating,aggregated_rating,artworks.image_id,age_ratings.rating,age_ratings.category,involved_companies.company.id,involved_companies.company.name,involved_companies.company.logo.image_id,involved_companies.company.description,involved_companies.developer,involved_companies.publisher,franchises.name,collections.name,screenshots.image_id,videos.video_id,game_engines.name,keywords.name,alternative_names.name,similar_games.id,similar_games.name,game_type; where id = ${igdbId};`;

      const options = {
        hostname: "api.igdb.com",
        path: "/v4/games",
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const igdbReq = https.request(options, async (igdbRes) => {
        let data = "";
        igdbRes.on("data", (chunk) => {
          data += chunk;
        });
        igdbRes.on("end", async () => {
          try {
            const games = JSON.parse(data);
            
            if (games.length === 0) {
              res.setHeader('Content-Type', 'application/json');
              return res.status(404).json({ error: "IGDB game not found" });
            }

            const game = games[0];
            const { formatIGDBReleaseDate } = require("../utils/dateUtils");
            const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(game.first_release_date);
            
            // Build background URL from artworks (use first artwork if available)
            let backgroundUrl = null;
            if (game.artworks && game.artworks.length > 0 && game.artworks[0].image_id) {
              backgroundUrl = `https://images.igdb.com/igdb/image/upload/t_1080p/${game.artworks[0].image_id}.jpg`;
            }
            
            // Process age ratings
            // IGDB returns only IDs, so we need to fetch details separately
            let ageRatings = [];
            if (game.age_ratings && game.age_ratings.length > 0) {
              const ageRatingIds = game.age_ratings.map((ar) => ar.id || ar).filter((id) => id);
              if (ageRatingIds.length > 0) {
                try {
                  // Fetch age rating details from IGDB
                  // Note: IGDB uses 'organization' for category and 'rating_category' for rating
                  const ageRatingPostData = `fields organization,rating_category; where id = (${ageRatingIds.join(',')});`;
                  const ageRatingOptions = {
                    hostname: "api.igdb.com",
                    path: "/v4/age_ratings",
                    method: "POST",
                    headers: {
                      "Client-ID": clientId,
                      Authorization: `Bearer ${accessToken}`,
                      "Content-Type": "text/plain",
                      "Content-Length": Buffer.byteLength(ageRatingPostData),
                    },
                  };

                  const ageRatingData = await new Promise((resolveAgeRating, rejectAgeRating) => {
                    const ageRatingReq = https.request(ageRatingOptions, (ageRatingRes) => {
                      let ageRatingData = "";
                      ageRatingRes.on("data", (chunk) => {
                        ageRatingData += chunk;
                      });
                      ageRatingRes.on("end", () => {
                        try {
                          if (ageRatingRes.statusCode === 200) {
                            resolveAgeRating(JSON.parse(ageRatingData));
                          } else {
                            console.error(`IGDB age ratings API returned ${ageRatingRes.statusCode}:`, ageRatingData);
                            rejectAgeRating(new Error(`IGDB age ratings API returned ${ageRatingRes.statusCode}`));
                          }
                        } catch (e) {
                          console.error('Error parsing age rating response:', e);
                          rejectAgeRating(e);
                        }
                      });
                    });
                    ageRatingReq.on("error", (err) => {
                      console.error('Age rating request error:', err);
                      rejectAgeRating(err);
                    });
                    ageRatingReq.write(ageRatingPostData);
                    ageRatingReq.end();
                  });

                  // IGDB uses 'organization' for category (ESRB, PEGI, etc.) and 'rating_category' for the rating value
                  // organization: 1=ESRB, 2=PEGI, 3=CERO, 4=USK, 5=GRAC, 6=CLASS_IND, 7=ACB
                  // rating_category: This is the rating ID that maps to specific rating values per organization
                  ageRatings = Array.isArray(ageRatingData) ? ageRatingData
                    .filter((ar) => ar && typeof ar.organization === 'number' && typeof ar.rating_category === 'number')
                    .map((ar) => ({
                      category: ar.organization, // organization maps to category (1=ESRB, 2=PEGI, etc.)
                      rating: ar.rating_category, // rating_category is the rating ID/value
                    })) : [];
                } catch (ageRatingError) {
                  console.error('Failed to fetch age rating details:', ageRatingError.message, ageRatingError.stack);
                  // Continue without age ratings
                }
              }
            }

            // Process involved companies — return { id, name, logo?, description? } so add-from-igdb can create/update developer/publisher blocks
            const developers = game.involved_companies
              ? game.involved_companies
                  .filter((ic) => ic.developer && ic.company)
                  .map((ic) => {
                    const c = ic.company;
                    if (!c || !c.id || !c.name) return null;
                    return { id: c.id, name: c.name || "", logo: c.logo?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${c.logo.image_id}.png` : null, description: c.description || "" };
                  })
                  .filter(Boolean)
              : [];
            const publishers = game.involved_companies
              ? game.involved_companies
                  .filter((ic) => ic.publisher && ic.company)
                  .map((ic) => {
                    const c = ic.company;
                    if (!c || !c.id || !c.name) return null;
                    return { id: c.id, name: c.name || "", logo: c.logo?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${c.logo.image_id}.png` : null, description: c.description || "" };
                  })
                  .filter(Boolean)
              : [];

            // Process screenshots
            const screenshots = game.screenshots
              ? game.screenshots.map((s) => `https://images.igdb.com/igdb/image/upload/t_1080p/${s.image_id}.jpg`).filter(Boolean)
              : [];

            // Process videos
            const videos = game.videos
              ? game.videos.map((v) => `https://www.youtube.com/embed/${v.video_id}`).filter(Boolean)
              : [];

            // Process similar games
            const similarGames = game.similar_games
              ? game.similar_games.map((sg) => ({ id: sg.id, name: sg.name || '' })).filter((sg) => sg.name)
              : [];

            const gameTypeId = coerceToGameTypeId(game.game_type);

            const gameData = {
              id: game.id,
              name: game.name,
              summary: game.summary || "",
              cover: game.cover
                ? `https:${game.cover.url.replace("t_thumb", "t_1080p").replace("t_cover_big", "t_1080p")}`
                : null,
              background: backgroundUrl,
              releaseDate,
              releaseDateFull,
              genres: game.genres ? game.genres.map((g) => g.name || g).filter(Boolean) : [],
              themes: game.themes ? game.themes.map((t) => ({ id: t.id, name: t.name || String(t) })).filter((t) => t.id != null || t.name) : [],
              platforms: game.platforms ? game.platforms.map((p) => ({ id: p.id, name: p.name || String(p) })).filter((p) => p.id != null || p.name) : [],
              gameModes: game.game_modes ? game.game_modes.map((m) => ({ id: m.id, name: m.name || String(m) })).filter((m) => m.id != null || m.name) : [],
              playerPerspectives: game.player_perspectives ? game.player_perspectives.map((p) => ({ id: p.id, name: p.name || String(p) })).filter((p) => p.id != null || p.name) : [],
              websites: game.websites ? game.websites.map((w) => ({ url: w.url, category: w.category })).filter((w) => w.url) : [],
              ageRatings: ageRatings.length > 0 ? ageRatings : undefined,
              developers: developers.length > 0 ? developers.map((d) => ({ id: d.id, name: d.name, logo: d.logo, description: d.description })) : undefined,
              publishers: publishers.length > 0 ? publishers.map((p) => ({ id: p.id, name: p.name, logo: p.logo, description: p.description })) : undefined,
              franchise: (game.franchises || []).map((f) => ({ id: f.id, name: f.name || "" })).filter((f) => f.name),
              collection: (game.collections || []).map((c) => ({ id: c.id, name: c.name || "" })).filter((c) => c.name),
              series: (game.collections || []).map((c) => ({ id: c.id, name: c.name || "" })).filter((c) => c.name),
              screenshots: screenshots.length > 0 ? screenshots : undefined,
              videos: videos.length > 0 ? videos : undefined,
              gameEngines: game.game_engines ? game.game_engines.map((e) => ({ id: e.id, name: e.name || String(e) })).filter((e) => e.id != null || e.name) : undefined,
              keywords: game.keywords ? game.keywords.map((k) => k.name || k).filter(Boolean) : undefined,
              alternativeNames: game.alternative_names ? game.alternative_names.map((an) => an.name || an).filter(Boolean) : undefined,
              similarGames: similarGames.length > 0 ? similarGames : undefined,
              criticRating: game.rating !== undefined && game.rating !== null ? game.rating : null,
              userRating: game.aggregated_rating !== undefined && game.aggregated_rating !== null ? game.aggregated_rating : null,
              ...(gameTypeId != null ? { type: gameTypeId } : {}),
            };
            
            res.setHeader('Content-Type', 'application/json');
            res.json(gameData);
          } catch (e) {
            console.error("Error parsing IGDB response:", e);
            res.setHeader('Content-Type', 'application/json');
            res.status(500).json({ error: "Failed to parse IGDB response" });
          }
        });
      });

      igdbReq.on("error", (err) => {
        console.error("IGDB request error:", err);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ error: "Failed to fetch game from IGDB" });
      });

      igdbReq.write(postData);
      igdbReq.end();
    } catch (error) {
      console.error("Error fetching IGDB game:", error);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: "Failed to fetch game from IGDB" });
    }
  });
}

module.exports = {
  registerIGDBRoutes,
  getIGDBAccessToken,
  fetchIGDBGameNamesByIds,
};

