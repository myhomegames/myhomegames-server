"use strict";

const http = require("http");
const https = require("https");
const { DEFAULT_SKINS_GITHUB_REPO } = require("./defaultSkinUrl");

const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Only GitHub release assets for the configured skins repo (SSRF guard).
 * In NODE_ENV=test, localhost http(s) zip URLs are also allowed for unit tests.
 */
function isAllowedSkinReleaseDownloadUrl(rawUrl, env = process.env) {
  let u;
  try {
    u = new URL(String(rawUrl || "").trim());
  } catch {
    return false;
  }

  const file = decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf("/") + 1));
  const lowerFile = file.toLowerCase();
  const isZip = lowerFile.endsWith(".mhg-skin.zip") || lowerFile.endsWith(".zip");
  if (!isZip) return false;

  if (env.NODE_ENV === "test" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
    return u.protocol === "http:" || u.protocol === "https:";
  }

  if (u.protocol !== "https:") return false;
  if (u.hostname !== "github.com") return false;

  const ownerRepo =
    (typeof env.MHG_SKINS_GITHUB_REPO === "string" && env.MHG_SKINS_GITHUB_REPO.trim()) ||
    DEFAULT_SKINS_GITHUB_REPO;
  const [owner, repo] = ownerRepo.split("/").map((s) => s.trim()).filter(Boolean);
  if (!owner || !repo) return false;

  const prefix = `/${owner}/${repo}/releases/download/`.toLowerCase();
  return u.pathname.toLowerCase().startsWith(prefix);
}

function fetchUrlBuffer(url, { maxBytes = DEFAULT_MAX_BYTES, redirectsLeft = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith("https://") ? https : http;
    const req = client.get(
      url,
      {
        headers: { "User-Agent": "myhomegames-server", Accept: "*/*" },
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          fetchUrlBuffer(next, { maxBytes, redirectsLeft: redirectsLeft - 1 })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (c) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy(new Error("skin_zip_too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Request timeout")));
  });
}

module.exports = {
  isAllowedSkinReleaseDownloadUrl,
  fetchUrlBuffer,
};
