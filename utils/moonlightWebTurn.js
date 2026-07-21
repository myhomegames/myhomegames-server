"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  isCloudflareTurnConfigured,
} = require("./cloudflareTurn");
const {
  readDockerMoonlightConfig,
  writeDockerMoonlightConfig,
  restartDockerMoonlight,
} = require("./moonlightWebEmbed");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";
const CONTAINER_SCRIPT_PATH = "/moonlight-web/server/ice_servers_cf.sh";
const SCRIPT_FILENAME = "ice_servers_cf.sh";

function resolveIceScriptHostPath(installDir) {
  return path.join(installDir, SCRIPT_FILENAME);
}

/**
 * Script executed by Moonlight Web on every stream start (inside Docker).
 * Calls the local MyHomeGames API to mint short-lived Cloudflare TURN ICE servers.
 */
function writeMoonlightIceServerScript(installDir, { httpPort = 4000 } = {}) {
  const scriptPath = resolveIceScriptHostPath(installDir);
  const port = Number(httpPort) > 0 ? Number(httpPort) : 4000;
  const body = `#!/bin/sh
set -e
# Mint Cloudflare Realtime TURN credentials via MyHomeGames (host gateway).
curl -sf "http://host.docker.internal:${port}/streaming/turn-ice-servers"
`;
  fs.writeFileSync(scriptPath, body, { encoding: "utf8", mode: 0o755 });
  return scriptPath;
}

function dockerCpIceScript(hostScriptPath) {
  execFileSync("docker", ["cp", hostScriptPath, `${DOCKER_CONTAINER_NAME}:${CONTAINER_SCRIPT_PATH}`], {
    stdio: "pipe",
    timeout: 30_000,
  });
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
 * Point Moonlight Web at the Cloudflare TURN ice_server_script (Docker installs).
 */
async function ensureMoonlightCloudflareTurnIce({
  installDir,
  kind = null,
  httpPort = 4000,
  env = process.env,
} = {}) {
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

  const hostScriptPath = writeMoonlightIceServerScript(installDir, { httpPort });

  let config;
  try {
    config = readDockerMoonlightConfig();
  } catch (error) {
    throw new Error(`Could not read Moonlight Web config for TURN: ${error.message || error}`);
  }

  const currentScript = config?.webrtc?.ice_server_script;
  const already = currentScript === CONTAINER_SCRIPT_PATH || currentScript === "./server/ice_servers_cf.sh";

  try {
    dockerCpIceScript(hostScriptPath);
  } catch (error) {
    console.warn(`Could not copy ICE script into Moonlight container: ${error.message || error}`);
  }

  if (already) {
    return { applied: false, reason: "already-configured", scriptPath: CONTAINER_SCRIPT_PATH };
  }

  config.webrtc = {
    ...(config.webrtc || {}),
    ice_server_script: CONTAINER_SCRIPT_PATH,
  };
  writeDockerMoonlightConfig(config);
  console.log("Moonlight Web configured to use Cloudflare TURN (ice_server_script).");
  restartDockerMoonlight();
  return { applied: true, restarted: true, scriptPath: CONTAINER_SCRIPT_PATH };
}

module.exports = {
  CONTAINER_SCRIPT_PATH,
  SCRIPT_FILENAME,
  writeMoonlightIceServerScript,
  ensureMoonlightCloudflareTurnIce,
  resolveIceScriptHostPath,
};
