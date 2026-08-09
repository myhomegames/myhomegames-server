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

function isMoonlightWebAuthError(statusCode, body) {
  if (statusCode === 401) return true;
  const text = String(body || "").toLowerCase();
  return statusCode === 400 && text.includes("hex error");
}

function moonlightWebRequestLabel(urlString, method) {
  try {
    const path = new URL(urlString).pathname || urlString;
    return `${method} ${path}`;
  } catch {
    return `${method} ${urlString}`;
  }
}

function buildMoonlightWebHeaders(headers, cookie) {
  const next = { ...headers };
  if (cookie) next.Cookie = cookie;
  else delete next.Cookie;
  return next;
}

/**
 * Call Moonlight Web API with automatic auth recovery.
 * Stale mlSession cookies after a Docker restart return 401; default_user_id allows
 * unauthenticated calls as the configured admin user.
 */
async function requestMoonlightWebJson({
  urlString,
  method = "GET",
  body = null,
  cookie = "",
  headers = {},
  timeoutMs = 30_000,
  auth = null,
  env = process.env,
  baseUrl = null,
} = {}) {
  const label = moonlightWebRequestLabel(urlString, method);
  const normalizedBase =
    String(baseUrl || "").trim().replace(/\/$/, "") ||
    (() => {
      try {
        const url = new URL(urlString);
        return `${url.protocol}//${url.host}`;
      } catch {
        return "";
      }
    })();

  const attempts = [];
  const seen = new Set();
  const pushAttempt = (value) => {
    const key = value || "";
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(value);
  };

  pushAttempt(cookie || "");
  pushAttempt("");

  let lastResponse = null;
  for (const attemptCookie of attempts) {
    const response = await requestJson({
      urlString,
      method,
      body,
      timeoutMs,
      auth,
      headers: buildMoonlightWebHeaders(headers, attemptCookie),
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response;
    }
    lastResponse = response;
    if (!isMoonlightWebAuthError(response.statusCode, response.body)) {
      break;
    }
  }

  if (normalizedBase) {
    try {
      const refreshed = await ensureMoonlightWebAdminCredentials(normalizedBase, env);
      const response = await requestJson({
        urlString,
        method,
        body,
        timeoutMs,
        auth,
        headers: buildMoonlightWebHeaders(headers, refreshed.cookie || ""),
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response;
      }
      lastResponse = response;
      if (isMoonlightWebAuthError(response.statusCode, response.body)) {
        const anonymous = await requestJson({
          urlString,
          method,
          body,
          timeoutMs,
          auth,
          headers: buildMoonlightWebHeaders(headers, ""),
        });
        if (anonymous.statusCode >= 200 && anonymous.statusCode < 300) {
          return anonymous;
        }
        lastResponse = anonymous;
      }
    } catch {
      // fall through to final error
    }
  }

  const failed = lastResponse || { statusCode: 0, body: "" };
  throw new Error(`${label} failed (${failed.statusCode}): ${failed.body.slice(0, 200)}`);
}

/**
 * Prefer anonymous API access for Docker (default_user_id) to avoid stale mlSession cookies
 * after container restarts. Native installs keep the login session when no default user is set.
 */
function resolveMoonlightWebApiCookie({ kind, defaultUserId, sessionCookie } = {}) {
  if (kind === "docker") return "";
  if (defaultUserId) return "";
  return sessionCookie || "";
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
  isMoonlightWebAuthError,
  requestMoonlightWebJson,
  resolveMoonlightWebApiCookie,
  postJson,
  requestJson,
  cookieHeaderFromSetCookie,
};
