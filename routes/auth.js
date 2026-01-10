// routes/auth.js
// Twitch OAuth authentication routes

const https = require("https");
const fs = require("fs");
const path = require("path");
const { readJsonFile, ensureDirectoryExists, writeJsonFile } = require("../utils/fileUtils");

// Note: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are no longer read from .env
// They are now passed from the client during login
const API_BASE = process.env.API_BASE;
const API_TOKEN = process.env.API_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Path to store user tokens
function getTokensPath(metadataPath) {
  return path.join(metadataPath, "tokens.json");
}

// Load user tokens from file
function loadTokens(metadataPath) {
  const tokensPath = getTokensPath(metadataPath);
  return readJsonFile(tokensPath, {});
}

// Save user tokens to file
function saveTokens(metadataPath, tokens) {
  const tokensPath = getTokensPath(metadataPath);
  try {
    // Ensure directory exists
    const dir = path.dirname(tokensPath);
    ensureDirectoryExists(dir);
    writeJsonFile(tokensPath, tokens);
    return true;
  } catch (e) {
    console.error("Error writing tokens:", e.message);
    return false;
  }
}

// Validate Twitch access token
function validateTwitchToken(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "id.twitch.tv",
      path: "/oauth2/validate",
      method: "GET",
      headers: {
        Authorization: `OAuth ${accessToken}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const json = JSON.parse(data);
            resolve(json);
          } else {
            reject(new Error("Invalid token"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// Get Twitch user info
function getTwitchUserInfo(accessToken, clientId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.twitch.tv",
      path: "/helix/users",
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-ID": clientId,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const json = JSON.parse(data);
            if (json.data && json.data.length > 0) {
              resolve(json.data[0]);
            } else {
              reject(new Error("No user data"));
            }
          } else {
            reject(new Error("Failed to get user info"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// Store Twitch credentials temporarily by state (for OAuth flow)
// This allows credentials to be passed from client instead of .env
const twitchCredentialsByState = new Map();

// Register authentication routes
function registerAuthRoutes(app, metadataPath) {
  // Redirect to Twitch OAuth
  app.post("/auth/twitch", (req, res) => {
    const { clientId, clientSecret } = req.body;
    
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required in request body." });
    }

    if (!API_BASE) {
      return res.status(500).json({ error: "API_BASE environment variable is required." });
    }

    const redirectUri = `${API_BASE}/auth/twitch/callback`;
    const state = Math.random().toString(36).substring(7);
    
    // Store credentials temporarily by state (will be cleaned up after callback)
    twitchCredentialsByState.set(state, {
      clientId,
      clientSecret,
      timestamp: Date.now()
    });
    
    // Clean up old entries (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of twitchCredentialsByState.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        twitchCredentialsByState.delete(key);
      }
    }
    
    // Check if we should force account selection (for "change user" flow)
    // Using prompt=consent forces Twitch to show the authorization screen again
    const promptConsent = req.body.forceVerify === true ? "&prompt=consent" : "";
    
    const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=user:read:email&` +
      `state=${state}${promptConsent}`;

    res.json({ authUrl, state });
  });

  // Handle Twitch OAuth callback
  app.get("/auth/twitch/callback", async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    if (error) {
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      return res.redirect(`${frontendUrl}?auth_error=no_code_or_state`);
    }

    // Retrieve credentials from state
    const credentials = twitchCredentialsByState.get(state);
    if (!credentials) {
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      return res.redirect(`${frontendUrl}?auth_error=invalid_state`);
    }

    const { clientId, clientSecret } = credentials;

    // Clean up credentials after use
    twitchCredentialsByState.delete(state);

    if (error) {
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      return res.redirect(`${frontendUrl}?auth_error=no_code`);
    }

    try {
      // Exchange code for access token
      const redirectUri = `${API_BASE}/auth/twitch/callback`;
      const postData = `client_id=${clientId}&` +
        `client_secret=${clientSecret}&` +
        `code=${code}&` +
        `grant_type=authorization_code&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}`;

      const tokenOptions = {
        hostname: "id.twitch.tv",
        path: "/oauth2/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const tokenPromise = new Promise((resolve, reject) => {
        const tokenReq = https.request(tokenOptions, (tokenRes) => {
          let data = "";
          tokenRes.on("data", (chunk) => {
            data += chunk;
          });
          tokenRes.on("end", () => {
            try {
              if (tokenRes.statusCode === 200) {
                const json = JSON.parse(data);
                resolve(json);
              } else {
                reject(new Error("Failed to get access token"));
              }
            } catch (e) {
              reject(e);
            }
          });
        });

        tokenReq.on("error", reject);
        tokenReq.write(postData);
        tokenReq.end();
      });

      const tokenData = await tokenPromise;
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;

      // Get user info
      const userInfo = await getTwitchUserInfo(accessToken, clientId);

      // Store token
      const tokens = loadTokens(metadataPath);
      tokens[userInfo.id] = {
        accessToken,
        refreshToken,
        userId: userInfo.id,
        userName: userInfo.display_name || userInfo.login,
        userImage: userInfo.profile_image_url,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
      };
      saveTokens(metadataPath, tokens);

      // Redirect to frontend with token
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      res.redirect(`${frontendUrl}?twitch_token=${accessToken}&user_id=${userInfo.id}`);
    } catch (err) {
      console.error("Twitch auth error:", err);
      const frontendUrl = req.headers.origin || FRONTEND_URL || API_BASE.replace(":4000", ":5173");
      res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(err.message)}`);
    }
  });

  // Get current user info (requires valid token)
  app.get("/auth/me", async (req, res) => {
    const token = req.header("X-Auth-Token") || req.query.token || req.header("Authorization");
    const clientId = req.header("X-Twitch-Client-Id") || req.query.clientId;
    
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check if it's the development token
    if (API_TOKEN && token === API_TOKEN) {
      return res.json({
        userId: "dev",
        userName: "Development User",
        userImage: null,
        isDev: true,
      });
    }

    if (!clientId) {
      return res.status(400).json({ error: "TWITCH_CLIENT_ID is required in X-Twitch-Client-Id header or clientId query parameter." });
    }

    try {
      // Validate token with Twitch
      const tokenInfo = await validateTwitchToken(token);
      
      // Get user info
      const userInfo = await getTwitchUserInfo(token, clientId);

      res.json({
        userId: userInfo.id,
        userName: userInfo.display_name || userInfo.login,
        userImage: userInfo.profile_image_url,
        isDev: false,
      });
    } catch (err) {
      console.error("Auth validation error:", err);
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Logout (clear token on client side)
  app.post("/auth/logout", (req, res) => {
    res.json({ status: "success" });
  });
}

// Check if token is valid (for middleware) - synchronous check only
function isValidToken(token, metadataPath) {
  // Development token
  if (API_TOKEN && token === API_TOKEN) {
    return true;
  }

  // Check if token exists in stored tokens
  const tokens = loadTokens(metadataPath);
  for (const userId in tokens) {
    if (tokens[userId].accessToken === token) {
      // Check if token hasn't expired (basic check)
      const tokenData = tokens[userId];
      if (tokenData.expiresAt && Date.now() < tokenData.expiresAt) {
        return true;
      }
      // Token expired, but we'll let Twitch validate it
      return true;
    }
  }

  return false;
}

module.exports = {
  registerAuthRoutes,
  isValidToken,
  loadTokens,
  saveTokens,
};

