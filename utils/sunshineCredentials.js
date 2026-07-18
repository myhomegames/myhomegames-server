"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_USERNAME = "sunshine";
const DEFAULT_PASSWORD = "admin";

/**
 * Sunshine stores web UI credentials in sunshine_state.json under its appdata dir.
 * @see https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2troubleshooting.html
 */
function resolveSunshineConfigDir(env = process.env) {
  const override = env.SUNSHINE_CONFIG_DIR?.trim();
  if (override) return override;

  if (process.platform === "win32") {
    const base = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Sunshine");
  }

  return path.join(os.homedir(), ".config", "sunshine");
}

function resolveSunshineStatePath(env = process.env) {
  const override = env.SUNSHINE_CREDENTIALS_FILE?.trim();
  if (override) return path.isAbsolute(override) ? override : path.join(resolveSunshineConfigDir(env), override);
  return path.join(resolveSunshineConfigDir(env), "sunshine_state.json");
}

function readSunshineState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function hasSunshineWebCredentials(statePath) {
  const state = readSunshineState(statePath);
  if (!state || typeof state !== "object") return false;
  const username = typeof state.username === "string" ? state.username.trim() : "";
  const password = typeof state.password === "string" ? state.password.trim() : "";
  return username.length > 0 && password.length > 0;
}

function resolveBootstrapCredentials(env = process.env) {
  const username = (env.SUNSHINE_USERNAME || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME;
  const password = (env.SUNSHINE_PASSWORD || DEFAULT_PASSWORD).trim() || DEFAULT_PASSWORD;
  return { username, password };
}

/**
 * On first run, set Sunshine web UI credentials via `sunshine --creds`.
 * Skips when credentials already exist so we do not overwrite a custom login.
 */
function ensureSunshineWebCredentials(executable, env = process.env) {
  if (!executable) {
    throw new Error("Sunshine executable is required to set credentials");
  }

  const statePath = resolveSunshineStatePath(env);
  if (hasSunshineWebCredentials(statePath)) {
    return { applied: false, reason: "already-configured", statePath };
  }

  const { username, password } = resolveBootstrapCredentials(env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  execFileSync(executable, ["--creds", username, password], {
    stdio: "pipe",
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, ...env },
  });

  if (!hasSunshineWebCredentials(statePath)) {
    throw new Error(`Sunshine --creds completed but credentials were not written to ${statePath}`);
  }

  console.log(`Sunshine web UI credentials set (${username} / ****)`);
  return { applied: true, reason: "bootstrapped", statePath, username };
}

module.exports = {
  DEFAULT_USERNAME,
  DEFAULT_PASSWORD,
  resolveSunshineConfigDir,
  resolveSunshineStatePath,
  hasSunshineWebCredentials,
  resolveBootstrapCredentials,
  ensureSunshineWebCredentials,
};
