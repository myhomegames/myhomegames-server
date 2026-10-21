"use strict";

const fs = require("fs");
const path = require("path");
const {
  isCloudflareTurnConfigured,
  generateCloudflareTurnIceServers,
} = require("./cloudflareTurn");
const {
  readPackageMoonlightConfig,
  writePackageMoonlightConfig,
} = require("./moonlightWebEmbed");

const SCRIPT_FILENAME = "ice_servers_cf.sh";
const JSON_FILENAME = "ice_servers.json";

function resolveIceServerDir(packageRoot, installDir) {
  if (packageRoot) return path.join(packageRoot, "server");
  return installDir;
}

function resolveIceScriptHostPath(dir) {
  return path.join(dir, SCRIPT_FILENAME);
}

function resolveIceJsonHostPath(dir) {
  return path.join(dir, JSON_FILENAME);
}

/**
 * Script executed by Moonlight Web on every stream start.
 * The process has no HTTP client — MyHomeGames mints TURN JSON and this script only cats it.
 */
function writeMoonlightIceServerScript(dir, jsonPath) {
  const scriptPath = resolveIceScriptHostPath(dir);
  const target = jsonPath || resolveIceJsonHostPath(dir);
  fs.mkdirSync(dir, { recursive: true });
  const body = `#!/bin/sh
set -e
# Cloudflare TURN ICE servers minted by MyHomeGames.
cat "${target}"
`;
  fs.writeFileSync(scriptPath, body, { encoding: "utf8", mode: 0o755 });
  return scriptPath;
}

/**
 * @param {string} installDir
 * @param {unknown} iceServers
 */
function writeMoonlightIceServersJson(dir, iceServers) {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = resolveIceJsonHostPath(dir);
  fs.writeFileSync(jsonPath, `${JSON.stringify(iceServers)}\n`, { encoding: "utf8", mode: 0o644 });
  return jsonPath;
}

/**
 * Mint Cloudflare TURN on the host and refresh the JSON Moonlight's ice_server_script cats.
 * Safe to call on every stream launch (no process restart).
 */
async function refreshMoonlightTurnIceServers({
  installDir,
  packageRoot = null,
  env = process.env,
} = {}) {
  if (!isCloudflareTurnConfigured(env)) {
    return { applied: false, reason: "turn-not-configured" };
  }
  const dir = resolveIceServerDir(packageRoot, installDir);
  if (!dir) {
    throw new Error("Moonlight package directory is required to refresh TURN ICE servers");
  }

  const { iceServers } = await generateCloudflareTurnIceServers(env);
  const jsonPath = writeMoonlightIceServersJson(dir, iceServers);
  const scriptPath = writeMoonlightIceServerScript(dir, jsonPath);

  return { applied: true, iceServers, scriptPath, jsonPath };
}

/**
 * Point Moonlight Web at the Cloudflare TURN ice_server_script
 * and seed ice_servers / JSON so the first stream works even before a later refresh.
 */
async function ensureMoonlightCloudflareTurnIce({
  installDir,
  packageRoot = null,
  httpPort = 4000,
  env = process.env,
} = {}) {
  void httpPort; // kept for call-site compatibility; ICE is minted on the host now
  if (!isCloudflareTurnConfigured(env)) {
    return { applied: false, reason: "turn-not-configured" };
  }
  if (!packageRoot) {
    console.warn("Cloudflare TURN needs the installed Moonlight Web package directory.");
    return { applied: false, reason: "missing-package" };
  }
  void installDir;

  const refreshed = await refreshMoonlightTurnIceServers({ installDir, packageRoot, env });
  if (!refreshed.iceServers) {
    return refreshed;
  }

  let config = {};
  try {
    config = readPackageMoonlightConfig(packageRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Could not read Moonlight Web config for TURN: ${error.message || error}`);
    }
  }

  const currentScript = config?.webrtc?.ice_server_script;
  const scriptReady = currentScript === refreshed.scriptPath;

  config.webrtc = {
    ...(config.webrtc || {}),
    ice_server_script: refreshed.scriptPath,
    ice_servers: refreshed.iceServers,
  };
  writePackageMoonlightConfig(packageRoot, config);

  if (scriptReady && refreshed.applied) {
    console.log("Moonlight Web Cloudflare TURN ICE servers refreshed.");
    return { applied: true, restarted: false, ...refreshed };
  }

  console.log("Moonlight Web configured to use Cloudflare TURN (ice_server_script + host-minted JSON).");
  return { applied: true, restarted: true, ...refreshed };
}

module.exports = {
  SCRIPT_FILENAME,
  JSON_FILENAME,
  writeMoonlightIceServerScript,
  writeMoonlightIceServersJson,
  refreshMoonlightTurnIceServers,
  ensureMoonlightCloudflareTurnIce,
  resolveIceScriptHostPath,
  resolveIceJsonHostPath,
  resolveIceServerDir,
};
