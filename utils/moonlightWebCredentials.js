"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_USERNAME = "sunshine";
const DEFAULT_PASSWORD = "admin";

function resolveBootstrapCredentials(env = process.env) {
  const username = (env.MOONLIGHT_WEB_USERNAME || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME;
  const password = (env.MOONLIGHT_WEB_PASSWORD || DEFAULT_PASSWORD).trim() || DEFAULT_PASSWORD;
  return { username, password };
}

function parseSetCookie(headers) {
  const raw = headers?.["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieHeaderFromSetCookie(setCookies) {
  return setCookies
    .map((entry) => String(entry).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function requestJson({
  urlString,
  method = "GET",
  body = null,
  headers = {},
  timeoutMs = 30_000,
  auth = null,
}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }

    const lib = url.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const reqHeaders = {
      Accept: "application/json, application/x-ndjson, */*",
      ...headers,
    };
    if (payload) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = payload.length;
    }
    if (auth?.username != null) {
      const token = Buffer.from(`${auth.username}:${auth.password || ""}`, "utf8").toString("base64");
      reqHeaders.Authorization = `Basic ${token}`;
    }

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: reqHeaders,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            cookies: parseSetCookie(res.headers),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`Timed out ${method} ${urlString}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function postJson(urlString, body, timeoutMs = 15_000, options = {}) {
  return requestJson({
    urlString,
    method: "POST",
    body,
    timeoutMs,
    headers: options.headers || {},
    auth: options.auth || null,
  });
}

/**
 * Moonlight Web creates the first admin on POST /api/login when no users exist yet.
 * Returns session cookie for authenticated follow-up API calls.
 */
async function ensureMoonlightWebAdminCredentials(baseUrl, env = process.env) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) {
    throw new Error("Moonlight Web URL is required to bootstrap admin credentials");
  }

  const { username, password } = resolveBootstrapCredentials(env);
  const response = await postJson(`${normalized}/api/login`, { name: username, password });

  if (response.statusCode >= 200 && response.statusCode < 300) {
    const cookie = cookieHeaderFromSetCookie(response.cookies);
    console.log(`Moonlight Web admin ready (${username} / ****)`);
    return {
      applied: true,
      username,
      statusCode: response.statusCode,
      cookie,
      baseUrl: normalized,
    };
  }

  throw new Error(
    `Moonlight Web login/bootstrap failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
  );
}

module.exports = {
  DEFAULT_USERNAME,
  DEFAULT_PASSWORD,
  resolveBootstrapCredentials,
  ensureMoonlightWebAdminCredentials,
  postJson,
  requestJson,
  cookieHeaderFromSetCookie,
};
