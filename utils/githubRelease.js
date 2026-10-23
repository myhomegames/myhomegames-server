"use strict";

const https = require("https");

function releaseAssetName(pattern) {
  if (!(pattern instanceof RegExp)) return null;
  const source = pattern.source;
  if (!source.startsWith("^") || !source.endsWith("$")) return null;
  return source.slice(1, -1).replace(/\\(.)/g, "$1");
}

function githubRequestHeaders(env = process.env) {
  const headers = {
    "User-Agent": "myhomegames-server",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = String(env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function httpError(statusCode, url, body) {
  const error = new Error(`HTTP ${statusCode} for ${url}`);
  const text = String(body || "");
  if (statusCode === 403 || statusCode === 429 || /rate limit/i.test(text)) {
    error.rateLimited = true;
  }
  return error;
}

function requestOnce(url, { headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

async function fetchGithubJson(url, env = process.env) {
  const response = await requestOnce(url, {
    headers: githubRequestHeaders(env),
    timeoutMs: 30_000,
  });
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return JSON.parse(response.body || "{}");
  }
  throw httpError(response.statusCode, url, response.body);
}

function tagFromReleaseLocation(location, repo) {
  let url;
  try {
    url = new URL(location, "https://github.com");
  } catch {
    return null;
  }
  const prefix = `/${repo}/releases/tag/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const tag = decodeURIComponent(url.pathname.slice(prefix.length));
  return tag || null;
}

async function resolveLatestReleaseTag(repo) {
  const page = `https://github.com/${repo}/releases/latest`;
  const response = await requestOnce(page, {
    headers: { "User-Agent": "myhomegames-server", Accept: "text/html" },
    timeoutMs: 30_000,
  });
  if (response.statusCode < 300 || response.statusCode >= 400 || !response.headers.location) {
    throw httpError(response.statusCode, page, response.body);
  }
  const tag = tagFromReleaseLocation(response.headers.location, repo);
  if (!tag) {
    throw new Error(`Could not read the latest ${repo} release tag`);
  }
  return tag;
}

/**
 * Resolve a GitHub release asset.
 * The REST API is used first. A 403/429 (unauthenticated rate limit) falls back
 * to the public /releases/latest redirect, which does not share that quota.
 */
async function resolveGithubReleaseAsset({
  repo,
  assetName,
  tag = null,
  env = process.env,
} = {}) {
  if (!repo || !assetName) {
    throw new Error("GitHub repo and asset name are required");
  }
  const apiUrl = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const release = await fetchGithubJson(apiUrl, env);
    const releaseTag = String(release.tag_name || tag || "");
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item.name === assetName);
    if (!asset?.browser_download_url) {
      throw new Error(`No release asset ${assetName} on ${repo}`);
    }
    return {
      version: releaseTag.replace(/^v/i, ""),
      name: asset.name,
      url: asset.browser_download_url,
      size: typeof asset.size === "number" ? asset.size : null,
    };
  } catch (error) {
    if (!error?.rateLimited) throw error;
    const resolvedTag = tag || (await resolveLatestReleaseTag(repo));
    console.warn(`GitHub API rate limit for ${repo}. Using release ${resolvedTag}.`);
    return {
      version: String(resolvedTag).replace(/^v/i, ""),
      name: assetName,
      url: `https://github.com/${repo}/releases/download/${encodeURIComponent(resolvedTag)}/${encodeURIComponent(assetName)}`,
      size: null,
    };
  }
}

module.exports = {
  releaseAssetName,
  tagFromReleaseLocation,
  resolveGithubReleaseAsset,
};
