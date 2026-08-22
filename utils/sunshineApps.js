"use strict";

const path = require("path");
const { requestJson } = require("./moonlightWebCredentials");

const DEFAULT_SUNSHINE_HOST = "127.0.0.1";
const DEFAULT_SUNSHINE_HTTPS_PORT = 47990;
const DEFAULT_SUNSHINE_USERNAME = "sunshine";
const DEFAULT_SUNSHINE_PASSWORD = "admin";

/** Prefix for per-game Sunshine apps managed by MyHomeGames (one stable entry per title). */
const MHG_SUNSHINE_APP_PREFIX = "MHG: ";
const MAX_APP_NAME_LEN = 120;

function resolveSunshineAuth(env = process.env) {
  return {
    host: String(env.SUNSHINE_HOST || DEFAULT_SUNSHINE_HOST).trim() || DEFAULT_SUNSHINE_HOST,
    port: Number(env.SUNSHINE_HTTPS_PORT || DEFAULT_SUNSHINE_HTTPS_PORT) || DEFAULT_SUNSHINE_HTTPS_PORT,
    username:
      (env.SUNSHINE_USERNAME || DEFAULT_SUNSHINE_USERNAME).trim() || DEFAULT_SUNSHINE_USERNAME,
    password:
      (env.SUNSHINE_PASSWORD || DEFAULT_SUNSHINE_PASSWORD).trim() || DEFAULT_SUNSHINE_PASSWORD,
  };
}

function sunshineApiUrl(env, pathSuffix) {
  const { host, port } = resolveSunshineAuth(env);
  return `https://${host}:${port}${pathSuffix}`;
}

function sunshineStreamingAppName(gameTitle) {
  const title = String(gameTitle || "Game").trim() || "Game";
  const name = `${MHG_SUNSHINE_APP_PREFIX}${title}`;
  return name.length <= MAX_APP_NAME_LEN ? name : name.slice(0, MAX_APP_NAME_LEN);
}

function isMhgSunshineApp(app) {
  return String(app?.name || "").startsWith(MHG_SUNSHINE_APP_PREFIX);
}

function buildSunshineLaunchCmd(fullCommandPath) {
  const cmdPath = path.resolve(String(fullCommandPath || "").trim());
  if (!cmdPath) throw new Error("Launch command path is required");
  if (cmdPath.includes(" ") || cmdPath.includes('"')) {
    return `"${cmdPath.replace(/"/g, '\\"')}"`;
  }
  return cmdPath;
}

function parseSunshineAppsPayload(body) {
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw new Error("Sunshine GET /api/apps returned invalid JSON");
  }
  const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed.apps) ? parsed.apps : [];
  // Sunshine omits index in GET responses — array position is the index for POST/DELETE.
  return raw.map((app, index) => ({
    ...app,
    index: Number.isFinite(Number(app?.index)) ? Number(app.index) : index,
  }));
}

async function listSunshineApps(env = process.env) {
  const { username, password } = resolveSunshineAuth(env);
  const response = await requestJson({
    urlString: sunshineApiUrl(env, "/api/apps"),
    method: "GET",
    auth: { username, password },
    timeoutMs: 15_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Sunshine GET /api/apps failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
    );
  }
  return parseSunshineAppsPayload(response.body);
}

async function deleteSunshineApp(index, env = process.env) {
  const appIndex = Number(index);
  if (!Number.isFinite(appIndex) || appIndex < 0) {
    throw new Error("Sunshine app index is required for delete");
  }
  const { username, password } = resolveSunshineAuth(env);
  const response = await requestJson({
    urlString: sunshineApiUrl(env, `/api/apps/${appIndex}`),
    method: "DELETE",
    auth: { username, password },
    timeoutMs: 15_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Sunshine DELETE /api/apps/${appIndex} failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
    );
  }
  return response;
}

/**
 * Remove duplicate Sunshine entries (same name or extra MHG slots), highest index first.
 */
async function removeDuplicateSunshineApps({ keepIndex, name, env = process.env } = {}) {
  const keep = Number(keepIndex);
  if (!Number.isFinite(keep) || keep < 0) return;

  const apps = await listSunshineApps(env);
  const toRemove = apps.filter((app) => String(app.name) === name && app.index !== keep);

  toRemove.sort((a, b) => b.index - a.index);
  for (const app of toRemove) {
    await deleteSunshineApp(app.index, env);
  }
}

/** Sunshine index for POST /api/apps: update in place when the title exists, else create (-1). */
function resolveSunshineUpsertIndex(apps, name) {
  const byName = apps.find((app) => String(app.name) === name);
  return byName ? byName.index : -1;
}

async function saveSunshineApp(body, env = process.env) {
  const { username, password } = resolveSunshineAuth(env);
  const response = await requestJson({
    urlString: sunshineApiUrl(env, "/api/apps"),
    method: "POST",
    body,
    auth: { username, password },
    timeoutMs: 15_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Sunshine POST /api/apps failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
    );
  }
  return response;
}

/**
 * Register or update the MyHomeGames Sunshine app for this game title.
 * One persistent entry per `MHG: <title>`; Sunshine runs `cmd` on Moonlight connect.
 */
async function upsertSunshineStreamingApp({ gameTitle, fullCommandPath, env = process.env } = {}) {
  const name = sunshineStreamingAppName(gameTitle);
  const cmd = buildSunshineLaunchCmd(fullCommandPath);
  const apps = await listSunshineApps(env);
  const index = resolveSunshineUpsertIndex(apps, name);

  await saveSunshineApp(
    {
      name,
      cmd,
      index,
      output: "",
      "auto-detach": true,
      "wait-all": true,
      "exit-timeout": 5,
      elevated: false,
      "exclude-global-prep-cmd": false,
      "prep-cmd": [],
      detached: [],
    },
    env,
  );

  let after = await listSunshineApps(env);
  let saved = after.find((app) => String(app.name) === name) || null;
  if (saved) {
    await removeDuplicateSunshineApps({ keepIndex: saved.index, name, env });
    after = await listSunshineApps(env);
    saved = after.find((app) => String(app.name) === name) || null;
  }

  if (!saved) {
    throw new Error("Sunshine app was saved but could not be found in the app list");
  }

  return {
    name,
    cmd,
    sunshineIndex: Number(saved.index),
  };
}

module.exports = {
  MHG_SUNSHINE_APP_PREFIX,
  sunshineStreamingAppName,
  buildSunshineLaunchCmd,
  parseSunshineAppsPayload,
  resolveSunshineUpsertIndex,
  listSunshineApps,
  deleteSunshineApp,
  removeDuplicateSunshineApps,
  upsertSunshineStreamingApp,
  isMhgSunshineApp,
};
