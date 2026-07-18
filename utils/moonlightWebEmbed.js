"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { requestJson } = require("./moonlightWebCredentials");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";
const CONTAINER_CONFIG_PATH = "/moonlight-web/server/config.json";

function listMoonlightUsers(baseUrl, cookie) {
  return requestJson({
    urlString: `${baseUrl}/api/users`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  }).then((response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`GET /api/users failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(response.body || "{}");
    return Array.isArray(parsed.users) ? parsed.users : [];
  });
}

function readDockerMoonlightConfig() {
  const raw = execFileSync("docker", ["exec", DOCKER_CONTAINER_NAME, "cat", CONTAINER_CONFIG_PATH], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return JSON.parse(raw);
}

function writeDockerMoonlightConfig(config) {
  const tmp = path.join(os.tmpdir(), `mhg-moonlight-config-${process.pid}.json`);
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    execFileSync("docker", ["cp", tmp, `${DOCKER_CONTAINER_NAME}:${CONTAINER_CONFIG_PATH}`], {
      stdio: "pipe",
      timeout: 30_000,
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function restartDockerMoonlight() {
  execFileSync("docker", ["restart", DOCKER_CONTAINER_NAME], {
    stdio: "pipe",
    timeout: 120_000,
  });
}

/**
 * Configure Moonlight Web so unauthenticated browsers use the admin user
 * (skips the login modal in the embed iframe).
 */
async function ensureMoonlightWebDefaultUser({
  baseUrl,
  cookie,
  username,
  kind = null,
  env = process.env,
} = {}) {
  if (env.MOONLIGHT_WEB_SKIP_DEFAULT_USER === "true") {
    return { applied: false, reason: "skipped" };
  }

  const users = await listMoonlightUsers(baseUrl, cookie);
  const preferredName = String(username || "").trim();
  const admin =
    users.find((user) => preferredName && user.name === preferredName) ||
    users.find((user) => user.role === "Admin") ||
    users[0];
  if (!admin?.id) {
    throw new Error("Moonlight Web admin user id not found");
  }

  if (kind !== "docker") {
    console.warn(
      "Moonlight Web default_user_id auto-config is currently supported for Docker installs only.",
    );
    return { applied: false, reason: "unsupported-kind", userId: admin.id };
  }

  let config;
  try {
    config = readDockerMoonlightConfig();
  } catch (error) {
    throw new Error(`Could not read Moonlight Web config: ${error.message || error}`);
  }

  const current = config?.web_server?.default_user_id;
  if (Number(current) === Number(admin.id)) {
    return { applied: false, reason: "already-configured", userId: admin.id };
  }

  config.web_server = {
    ...(config.web_server || {}),
    default_user_id: Number(admin.id),
  };
  writeDockerMoonlightConfig(config);
  console.log(`Moonlight Web default_user_id set to ${admin.id} (skip login in embed).`);
  restartDockerMoonlight();
  return { applied: true, userId: admin.id, restarted: true };
}

async function listMoonlightApps(baseUrl, cookie, hostId) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/apps?host_id=${encodeURIComponent(hostId)}`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 60_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/apps failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return Array.isArray(parsed.apps) ? parsed.apps : [];
}

function pickDesktopApp(apps) {
  if (!Array.isArray(apps) || apps.length === 0) return null;
  const byName = apps.find((app) => String(app.title || "").toLowerCase() === "desktop");
  if (byName) return byName;
  const byId = apps.find((app) => Number(app.app_id) === 0);
  if (byId) return byId;
  return apps[0];
}

/**
 * Build a Moonlight Web URL that opens the Sunshine Desktop stream directly.
 */
async function resolveMoonlightDesktopStreamUrl({
  baseUrl,
  cookie,
  hostId,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");
  if (hostId == null) throw new Error("Moonlight host_id is required");

  const apps = await listMoonlightApps(normalized, cookie, hostId);
  const desktop = pickDesktopApp(apps);
  if (!desktop || desktop.app_id == null) {
    throw new Error("Moonlight Web Desktop app not found on Sunshine host");
  }

  const url = new URL(`${normalized}/stream.html`);
  url.searchParams.set("hostId", String(hostId));
  url.searchParams.set("appId", String(desktop.app_id));
  return {
    url: url.toString(),
    hostId: Number(hostId),
    appId: Number(desktop.app_id),
    appTitle: desktop.title || "Desktop",
  };
}

module.exports = {
  ensureMoonlightWebDefaultUser,
  resolveMoonlightDesktopStreamUrl,
  listMoonlightApps,
  pickDesktopApp,
  listMoonlightUsers,
  readDockerMoonlightConfig,
  writeDockerMoonlightConfig,
  restartDockerMoonlight,
};
