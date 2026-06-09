"use strict";

const https = require("https");
const http = require("http");

const DEFAULT_SKINS_GITHUB_REPO = "myhomegames/myhomegames-skins";
const DEFAULT_SKIN_ZIP_NAME = "plex.mhg-skin.zip";

function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "myhomegames-server",
        },
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          fetchJson(next, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timeout")));
  });
}

/**
 * Plex .mhg-skin.zip URL for first-run bootstrap.
 * Uses DEFAULT_SKIN_URL when set; otherwise latest GitHub Release asset.
 */
async function resolveDefaultSkinUrl(env = process.env) {
  const explicit = typeof env.DEFAULT_SKIN_URL === "string" ? env.DEFAULT_SKIN_URL.trim() : "";
  if (explicit) return explicit;

  const ownerRepo =
    (typeof env.MHG_SKINS_GITHUB_REPO === "string" && env.MHG_SKINS_GITHUB_REPO.trim()) ||
    DEFAULT_SKINS_GITHUB_REPO;
  const [owner, repo] = ownerRepo.split("/").map((s) => s.trim()).filter(Boolean);
  if (!owner || !repo) {
    throw new Error("Invalid MHG_SKINS_GITHUB_REPO");
  }

  const release = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  );
  const asset = (release.assets || []).find((a) => a.name === DEFAULT_SKIN_ZIP_NAME);
  if (!asset?.browser_download_url) {
    throw new Error(`${DEFAULT_SKIN_ZIP_NAME} not found in latest skins release`);
  }
  return asset.browser_download_url;
}

module.exports = { resolveDefaultSkinUrl, DEFAULT_SKIN_ZIP_NAME, DEFAULT_SKINS_GITHUB_REPO };
