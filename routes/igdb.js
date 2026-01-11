// routes/igdb.js
// IGDB API routes for game search and details

const https = require("https");

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
 * Register IGDB routes
 * @param {express.App} app - Express app instance
 * @param {Function} requireToken - Authentication middleware
 */
function registerIGDBRoutes(app, requireToken) {
  // Endpoint: search games on IGDB
  app.get("/igdb/search", requireToken, async (req, res) => {
    const query = req.query.q;
    if (!query || query.trim() === "") {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Missing search query" });
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

      const postData = `search "${query}"; fields id,name,summary,cover.url,first_release_date,genres.name,rating,aggregated_rating; limit 20;`;

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

      const igdbReq = https.request(options, (igdbRes) => {
        let data = "";
        igdbRes.on("data", (chunk) => {
          data += chunk;
        });
        igdbRes.on("end", () => {
          try {
            const games = JSON.parse(data);
            const { formatIGDBReleaseDate } = require("@mycms/utils");
            const formattedGames = games.map((game) => {
              const { releaseDate, releaseDateFull } = formatIGDBReleaseDate(game.first_release_date);
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
              };
            });
            res.setHeader('Content-Type', 'application/json');
            res.json({ games: formattedGames });
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
        res.status(500).json({ error: "Failed to search IGDB", detail: err.message });
      });

      igdbReq.write(postData);
      igdbReq.end();
    } catch (err) {
      console.error("IGDB search error:", err);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: "Failed to search IGDB", detail: err.message });
    }
  });

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

      const postData = `fields id,name,summary,cover.url,first_release_date,genres.name,themes.name,platforms.name,game_modes.name,player_perspectives.name,websites.url,websites.category,rating,aggregated_rating,artworks.image_id,age_ratings.rating,age_ratings.category,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,franchise.name,collection.name,screenshots.image_id,videos.video_id,game_engines.name,keywords.name,alternative_names.name,similar_games.id,similar_games.name; where id = ${igdbId};`;

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
            const { formatIGDBReleaseDate } = require("@mycms/utils");
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

            // Process involved companies
            const developers = game.involved_companies
              ? game.involved_companies.filter((ic) => ic.developer).map((ic) => ic.company?.name || '').filter(Boolean)
              : [];
            const publishers = game.involved_companies
              ? game.involved_companies.filter((ic) => ic.publisher).map((ic) => ic.company?.name || '').filter(Boolean)
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
              themes: game.themes ? game.themes.map((t) => t.name || t).filter(Boolean) : [],
              platforms: game.platforms ? game.platforms.map((p) => p.name || p).filter(Boolean) : [],
              gameModes: game.game_modes ? game.game_modes.map((m) => m.name || m).filter(Boolean) : [],
              playerPerspectives: game.player_perspectives ? game.player_perspectives.map((p) => p.name || p).filter(Boolean) : [],
              websites: game.websites ? game.websites.map((w) => ({ url: w.url, category: w.category })).filter((w) => w.url) : [],
              ageRatings: ageRatings.length > 0 ? ageRatings : undefined,
              developers: developers.length > 0 ? developers : undefined,
              publishers: publishers.length > 0 ? publishers : undefined,
              franchise: game.franchise?.name || undefined,
              collection: game.collection?.name || undefined,
              screenshots: screenshots.length > 0 ? screenshots : undefined,
              videos: videos.length > 0 ? videos : undefined,
              gameEngines: game.game_engines ? game.game_engines.map((e) => e.name || e).filter(Boolean) : undefined,
              keywords: game.keywords ? game.keywords.map((k) => k.name || k).filter(Boolean) : undefined,
              alternativeNames: game.alternative_names ? game.alternative_names.map((an) => an.name || an).filter(Boolean) : undefined,
              similarGames: similarGames.length > 0 ? similarGames : undefined,
              criticRating: game.rating !== undefined && game.rating !== null ? game.rating : null,
              userRating: game.aggregated_rating !== undefined && game.aggregated_rating !== null ? game.aggregated_rating : null,
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
};

