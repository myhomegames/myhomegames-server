"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { ensureCloudflaredBinary } = require("./cloudflaredBinary");

const DEFAULT_PUBLIC_URL = "https://myhomegames-server.vige.it";

/**
 * Adjust env when Cloudflare Tunnel exposes the local HTTP server on a public hostname.
 */
function applyCloudflareTunnelEnv(env = process.env) {
  if (env.CLOUDFLARE_TUNNEL_ENABLED !== "true") {
    return { applied: false };
  }

  if (!env.API_BASE?.trim()) {
    env.API_BASE = DEFAULT_PUBLIC_URL.replace(/\/$/, "");
  }

  let httpsDisabled = false;
  if (env.HTTPS_ENABLED === "true") {
    env.HTTPS_ENABLED = "false";
    httpsDisabled = true;
  }

  return { applied: true, publicUrl: env.API_BASE, httpsDisabled };
}

function isCloudflareTunnelEnabled(env = process.env) {
  return env.CLOUDFLARE_TUNNEL_ENABLED === "true";
}

function defaultCloudflaredConfigPath() {
  return path.join(os.homedir(), ".cloudflared", "config.yml");
}

/**
 * Build cloudflared CLI args for a tunnel run token or advanced local config.
 * Per-user run tokens come from the tunnel manager (POST /tunnel/connect), not .env.
 * @returns {{ mode: string, args: string[] } | null} null when tunnel should not start
 */
function buildCloudflareTunnelArgs(env = process.env, localOrigin, options = {}) {
  const runtimeToken = options.runtimeToken?.trim();
  if (runtimeToken) {
    return { mode: "runtime-token", args: ["tunnel", "run", "--token", runtimeToken] };
  }

  const configPath =
    env.CLOUDFLARE_TUNNEL_CONFIG?.trim() || defaultCloudflaredConfigPath();
  if (fs.existsSync(configPath)) {
    return { mode: "config", args: ["tunnel", "--config", configPath, "run"] };
  }

  // Optional: write a minimal config when hostname + credentials are provided
  const credentialsFile = env.CLOUDFLARE_TUNNEL_CREDENTIALS_FILE?.trim();
  const tunnelId = env.CLOUDFLARE_TUNNEL_ID?.trim();
  const hostname =
    env.CLOUDFLARE_TUNNEL_HOSTNAME?.trim() ||
    tryHostnameFromPublicUrl(env.API_BASE);

  if (credentialsFile && tunnelId && hostname && fs.existsSync(credentialsFile)) {
    const generated = writeGeneratedTunnelConfig({
      credentialsFile,
      tunnelId,
      hostname,
      localOrigin,
      configDir: env.METADATA_PATH
        ? path.join(env.METADATA_PATH, "cloudflared")
        : path.join(os.tmpdir(), "myhomegames-cloudflared"),
    });
    return { mode: "generated", args: ["tunnel", "--config", generated, "run"] };
  }

  return null;
}

function tryHostnameFromPublicUrl(url) {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return null;
  }
}

function writeGeneratedTunnelConfig({
  credentialsFile,
  tunnelId,
  hostname,
  localOrigin,
  configDir,
}) {
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.yml");
  const service = localOrigin.replace(/\/$/, "");
  const yaml = [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credentialsFile}`,
    "ingress:",
    `  - hostname: ${hostname}`,
    `    service: ${service}`,
    "  - service: http_status:404",
    "",
  ].join("\n");
  fs.writeFileSync(configPath, yaml, "utf8");
  return configPath;
}

/**
 * Start cloudflared (named tunnel already configured in Cloudflare / ~/.cloudflared).
 * @param {{ localOrigin: string, env?: NodeJS.ProcessEnv, metadataPath?: string, onLog?: (line: string) => void, runtimeToken?: string, publicUrl?: string }} options
 * @returns {Promise<import('cloudflared').Tunnel>}
 */
async function startCloudflareTunnel({
  localOrigin,
  env = process.env,
  metadataPath,
  onLog,
  runtimeToken,
  publicUrl,
}) {
  const built = buildCloudflareTunnelArgs(env, localOrigin, { runtimeToken });
  if (!built) {
    throw new Error(
      "Cloudflare Tunnel enabled but no run token. Sign in via the web app (Cloudflare Access) " +
        "and connect, or set CLOUDFLARE_TUNNEL_CONFIG (~/.cloudflared/config.yml) for advanced local use.",
    );
  }

  await ensureCloudflaredBinary({ env, metadataPath });
  const { Tunnel } = require("cloudflared");

  const tunnel = new Tunnel(built.args);
  const displayPublicUrl =
    publicUrl?.trim() || env.API_BASE?.trim() || DEFAULT_PUBLIC_URL;

  const log = (line) => {
    if (onLog) onLog(line);
    else if (env.CLOUDFLARE_TUNNEL_VERBOSE === "true") {
      process.stderr.write(line);
    }
  };

  tunnel.on("stdout", log);
  tunnel.on("stderr", log);
  tunnel.on("error", (err) => {
    console.error("Cloudflare Tunnel error:", err.message || err);
  });
  tunnel.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(
        `Cloudflare Tunnel exited (code=${code}${signal ? `, signal=${signal}` : ""})`,
      );
    }
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn(
        "Cloudflare Tunnel: no connection event yet; continuing (check dashboard / credentials).",
      );
      resolve();
    }, 30_000);

    tunnel.once("connected", () => {
      clearTimeout(timeout);
      resolve();
    });
    tunnel.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  }).catch((err) => {
    if (env.CLOUDFLARE_TUNNEL_STRICT !== "true") {
      console.warn("Cloudflare Tunnel:", err.message || err);
      return;
    }
    throw err;
  });

  console.log(
    `Cloudflare Tunnel active (${built.mode}) → ${displayPublicUrl.replace(/\/$/, "")}`,
  );
  console.log(`  Local origin: ${localOrigin}`);

  return tunnel;
}

function stopCloudflareTunnel(tunnel) {
  if (!tunnel) return false;
  try {
    return tunnel.stop();
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_PUBLIC_URL,
  applyCloudflareTunnelEnv,
  isCloudflareTunnelEnabled,
  buildCloudflareTunnelArgs,
  startCloudflareTunnel,
  stopCloudflareTunnel,
  defaultCloudflaredConfigPath,
};
