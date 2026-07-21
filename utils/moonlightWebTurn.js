"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  isCloudflareTurnConfigured,
  generateCloudflareTurnIceServers,
} = require("./cloudflareTurn");
const {
  readDockerMoonlightConfig,
  writeDockerMoonlightConfig,
  restartDockerMoonlight,
} = require("./moonlightWebEmbed");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";
const CONTAINER_SCRIPT_PATH = "/moonlight-web/server/ice_servers_cf.sh";
const CONTAINER_JSON_PATH = "/moonlight-web/server/ice_servers.json";
const SCRIPT_FILENAME = "ice_servers_cf.sh";
const JSON_FILENAME = "ice_servers.json";

function resolveIceScriptHostPath(installDir) {
  return path.join(installDir, SCRIPT_FILENAME);
}

function resolveIceJsonHostPath(installDir) {
  return path.join(installDir, JSON_FILENAME);
}

/**
 * Script executed by Moonlight Web on every stream start (inside Docker).
 * The Moonlight image has no curl/wget — host mints TURN JSON; this script only cats it.
 */
function writeMoonlightIceServerScript(installDir) {
  const scriptPath = resolveIceScriptHostPath(installDir);
  const body = `#!/bin/sh
set -e
# Cloudflare TURN ICE servers minted on the host (MyHomeGames) — no HTTP client in image.
cat "${CONTAINER_JSON_PATH}"
`;
  fs.writeFileSync(scriptPath, body, { encoding: "utf8", mode: 0o755 });
  return scriptPath;
}

/**
 * @param {string} installDir
 * @param {unknown} iceServers
 */
function writeMoonlightIceServersJson(installDir, iceServers) {
  const jsonPath = resolveIceJsonHostPath(installDir);
  fs.writeFileSync(jsonPath, `${JSON.stringify(iceServers)}\n`, { encoding: "utf8", mode: 0o644 });
  return jsonPath;
}

function dockerCpIntoMoonlight(hostPath, containerPath) {
  execFileSync("docker", ["cp", hostPath, `${DOCKER_CONTAINER_NAME}:${containerPath}`], {
    stdio: "pipe",
    timeout: 30_000,
  });
}

function dockerCpIceArtifacts(hostScriptPath, hostJsonPath) {
  dockerCpIntoMoonlight(hostScriptPath, CONTAINER_SCRIPT_PATH);
  dockerCpIntoMoonlight(hostJsonPath, CONTAINER_JSON_PATH);
  try {
    execFileSync(
      "docker",
      ["exec", DOCKER_CONTAINER_NAME, "chmod", "+x", CONTAINER_SCRIPT_PATH],
      { stdio: "pipe", timeout: 15_000 },
    );
  } catch {
    // ignore chmod failures on read-only layers; script mode from write may still apply via mount
  }
}

/**
 * Mint Cloudflare TURN on the host and refresh the JSON Moonlight's ice_server_script cats.
 * Safe to call on every stream launch (no container restart).
 */
async function refreshMoonlightTurnIceServers({
  installDir,
  kind = null,
  env = process.env,
} = {}) {
  if (!isCloudflareTurnConfigured(env)) {
    return { applied: false, reason: "turn-not-configured" };
  }
  if (kind != null && kind !== "docker") {
    return { applied: false, reason: "unsupported-kind" };
  }
  if (!installDir) {
    throw new Error("Moonlight installDir is required to refresh TURN ICE servers");
  }

  const { iceServers } = await generateCloudflareTurnIceServers(env);
  const hostScriptPath = writeMoonlightIceServerScript(installDir);
  const hostJsonPath = writeMoonlightIceServersJson(installDir, iceServers);

  try {
    dockerCpIceArtifacts(hostScriptPath, hostJsonPath);
  } catch (error) {
    console.warn(`Could not copy TURN ICE artifacts into Moonlight container: ${error.message || error}`);
    return { applied: false, reason: "docker-cp-failed", iceServers };
  }

  return { applied: true, iceServers, scriptPath: CONTAINER_SCRIPT_PATH, jsonPath: CONTAINER_JSON_PATH };
}

/**
 * Point Moonlight Web at the Cloudflare TURN ice_server_script (Docker installs)
 * and seed ice_servers / JSON so the first stream works even before a later refresh.
 */
async function ensureMoonlightCloudflareTurnIce({
  installDir,
  kind = null,
  httpPort = 4000,
  env = process.env,
} = {}) {
  void httpPort; // kept for call-site compatibility; ICE is minted on the host now
  if (!isCloudflareTurnConfigured(env)) {
    return { applied: false, reason: "turn-not-configured" };
  }
  if (kind !== "docker") {
    console.warn("Cloudflare TURN ice_server_script is currently supported for Docker Moonlight Web.");
    return { applied: false, reason: "unsupported-kind" };
  }
  if (!installDir) {
    throw new Error("Moonlight installDir is required to install the ICE script");
  }

  const refreshed = await refreshMoonlightTurnIceServers({ installDir, kind, env });
  if (!refreshed.iceServers) {
    return refreshed;
  }

  let config;
  try {
    config = readDockerMoonlightConfig();
  } catch (error) {
    throw new Error(`Could not read Moonlight Web config for TURN: ${error.message || error}`);
  }

  const currentScript = config?.webrtc?.ice_server_script;
  const scriptReady =
    currentScript === CONTAINER_SCRIPT_PATH || currentScript === "./server/ice_servers_cf.sh";

  config.webrtc = {
    ...(config.webrtc || {}),
    ice_server_script: CONTAINER_SCRIPT_PATH,
    ice_servers: refreshed.iceServers,
  };
  writeDockerMoonlightConfig(config);

  if (scriptReady && refreshed.applied) {
    console.log("Moonlight Web Cloudflare TURN ICE servers refreshed.");
    return { applied: true, restarted: false, ...refreshed };
  }

  console.log("Moonlight Web configured to use Cloudflare TURN (ice_server_script + host-minted JSON).");
  restartDockerMoonlight();
  return { applied: true, restarted: true, ...refreshed };
}

module.exports = {
  CONTAINER_SCRIPT_PATH,
  CONTAINER_JSON_PATH,
  SCRIPT_FILENAME,
  JSON_FILENAME,
  writeMoonlightIceServerScript,
  writeMoonlightIceServersJson,
  refreshMoonlightTurnIceServers,
  ensureMoonlightCloudflareTurnIce,
  resolveIceScriptHostPath,
  resolveIceJsonHostPath,
};
