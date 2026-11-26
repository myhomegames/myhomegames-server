"use strict";

/**
 * Server-side IGDB catalog access via HTTP `/igdb/*` (same path as the web Add Game flow).
 * On a user tunnel host the request hairpins through the Worker so Twitch secrets are injected.
 * Local loopback relies on env/stored Twitch credentials (tunnel disabled).
 */

const { isUserTunnelHostname } = require("./tunnelHostname");

function resolveLoopbackApiBase(env = process.env) {
  const port = String(env.HTTP_PORT || env.PORT || "4000").trim() || "4000";
  return `http://127.0.0.1:${port}`;
}

/**
 * Prefer the inbound user-tunnel Host so `/igdb/*` hits the Worker; otherwise loopback.
 * @param {import('express').Request} req
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveIgdbCatalogHttpBase(req, env = process.env) {
  const rawHost = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (isUserTunnelHostname(rawHost)) {
    return `https://${rawHost}`;
  }
  return resolveLoopbackApiBase(env);
}

/**
 * Auth (+ locale) headers forwarded from the original import request.
 * @param {import('express').Request} req
 */
function catalogRequestHeaders(req, extra = {}) {
  const headers = {
    Accept: "application/json",
    ...extra,
  };
  const authToken =
    req?.header?.("X-Auth-Token") ||
    req?.header?.("Authorization") ||
    (typeof req?.query?.token === "string" ? req.query.token : "");
  if (authToken) {
    if (/^Bearer\s+/i.test(authToken) || authToken.includes(" ")) {
      headers.Authorization = authToken;
    } else {
      headers["X-Auth-Token"] = authToken;
    }
  }
  const acceptLanguage = req?.header?.("Accept-Language");
  if (acceptLanguage) headers["Accept-Language"] = acceptLanguage;
  return headers;
}

/**
 * @param {import('express').Request} req
 * @param {string} pathname e.g. `/igdb/search`
 * @param {Record<string, string|number|boolean|null|undefined>} [query]
 * @param {{ method?: string, body?: object, baseUrl?: string }} [options]
 */
async function catalogHttpJson(req, pathname, query = {}, options = {}) {
  const base = String(options.baseUrl || resolveIgdbCatalogHttpBase(req)).replace(/\/$/, "");
  const url = new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, `${base}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const method = String(options.method || "GET").toUpperCase();
  const headers = catalogRequestHeaders(req, method === "GET" ? {} : { "Content-Type": "application/json" });
  const init = { method, headers };
  if (options.body != null && method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(
      (json && typeof json.error === "string" && json.error) ||
        `Catalog HTTP ${res.status} for ${pathname}`
    );
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

/**
 * Same entry as web `searchIgdbGames` → GET `/igdb/search`.
 * @returns {Promise<Array>}
 */
async function searchIgdbGamesViaHttp(req, title, yearHint = null) {
  const q = String(title || "").trim();
  if (!q) return [];
  const query = { q };
  if (Number.isFinite(Number(yearHint)) && Number(yearHint) >= 1970) {
    query.year = Number(yearHint);
  }
  try {
    const json = await catalogHttpJson(req, "/igdb/search", query);
    return Array.isArray(json?.games) ? json.games : [];
  } catch (err) {
    if (Number(err?.status) === 400) return [];
    throw err;
  }
}

/**
 * Same entry as CatalogGameDetail → GET `/igdb/game/:id`.
 */
async function fetchIgdbGameViaHttp(req, igdbId) {
  const json = await catalogHttpJson(req, `/igdb/game/${encodeURIComponent(String(igdbId))}`);
  return json;
}

/**
 * GET `/igdb/company/:id` then POST `/{role}/:id/merge-company-profile` on loopback
 * (merge does not need Twitch; company fetch does).
 */
async function syncCompanyProfilesViaIgdbHttp(req, { developers, publishers } = {}) {
  const loopback = resolveLoopbackApiBase();
  const tasks = [];

  const enqueue = (roleFolder, item) => {
    if (item?.id == null) return;
    tasks.push(
      (async () => {
        const params = {};
        if (item.name) params.name = String(item.name);
        let catalogData;
        try {
          catalogData = await catalogHttpJson(
            req,
            `/igdb/company/${encodeURIComponent(String(item.id))}`,
            params
          );
        } catch (err) {
          console.warn(
            `[igdb-http] company fetch failed ${roleFolder}/${item.id}:`,
            err?.message || err
          );
          return;
        }
        if (!catalogData || typeof catalogData !== "object") return;

        const mergeBody = { ...catalogData };
        if (item.name && mergeBody.title == null) mergeBody.title = item.name;

        try {
          await catalogHttpJson(req, `/${roleFolder}/${encodeURIComponent(String(item.id))}/merge-company-profile`, {}, {
            method: "POST",
            body: mergeBody,
            baseUrl: loopback,
          });
        } catch (err) {
          console.warn(
            `[igdb-http] company merge failed ${roleFolder}/${item.id}:`,
            err?.message || err
          );
        }
      })()
    );
  };

  for (const item of Array.isArray(developers) ? developers : []) enqueue("developers", item);
  for (const item of Array.isArray(publishers) ? publishers : []) enqueue("publishers", item);
  if (tasks.length === 0) return;
  await Promise.all(tasks);
}

/**
 * @param {string} metadataPath
 * @returns {boolean}
 */
function readTwitchApiEnabledSetting(metadataPath) {
  try {
    const fs = require("fs");
    const path = require("path");
    const raw = fs.readFileSync(path.join(metadataPath, "settings.json"), "utf8");
    const settings = JSON.parse(raw);
    return settings?.twitchApiEnabled === true;
  } catch {
    return false;
  }
}

module.exports = {
  resolveIgdbCatalogHttpBase,
  resolveLoopbackApiBase,
  catalogRequestHeaders,
  catalogHttpJson,
  searchIgdbGamesViaHttp,
  fetchIgdbGameViaHttp,
  syncCompanyProfilesViaIgdbHttp,
  readTwitchApiEnabledSetting,
};
