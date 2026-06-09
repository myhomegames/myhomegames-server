"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function cloudflaredExecutableName() {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * Writable install path for cloudflared (pkg snapshot cannot mkdir under node_modules).
 */
function resolveWritableCloudflaredBin(metadataPath) {
  const baseDir = metadataPath
    ? path.join(metadataPath, "bin")
    : path.join(os.homedir(), ".local", "share", "MyHomeGames", "bin");
  return path.join(baseDir, cloudflaredExecutableName());
}

function resolveMacAppBundledCloudflared(execPath) {
  if (!execPath || !execPath.includes(".app/Contents/MacOS")) {
    return null;
  }
  const appRoot = execPath.substring(0, execPath.indexOf("/Contents/MacOS/"));
  const bundled = path.join(
    appRoot,
    "Contents",
    "Resources",
    "bin",
    cloudflaredExecutableName(),
  );
  return fs.existsSync(bundled) ? bundled : null;
}

/**
 * Bundled cloudflared shipped next to the server (app Resources, opt dir, etc.).
 */
function findBundledCloudflaredBin(env = process.env) {
  const explicit = env.CLOUDFLARED_BIN?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [];
  try {
    let execPath = process.execPath;
    if (!path.isAbsolute(execPath)) {
      execPath = path.resolve(process.cwd(), execPath);
    }
    try {
      execPath = fs.realpathSync(execPath);
    } catch {
      // use resolved path
    }

    const macBundled = resolveMacAppBundledCloudflared(execPath);
    if (macBundled) {
      candidates.push(macBundled);
    }

    candidates.push(
      path.join(path.dirname(execPath), "bin", cloudflaredExecutableName()),
    );
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Ensure cloudflared exists on disk and point the npm wrapper at it.
 */
async function ensureCloudflaredBinary({ env = process.env, metadataPath } = {}) {
  const { use, install } = require("cloudflared");
  const targetBin = resolveWritableCloudflaredBin(metadataPath || env.METADATA_PATH);
  fs.mkdirSync(path.dirname(targetBin), { recursive: true });

  const bundled = findBundledCloudflaredBin(env);
  if (bundled && path.resolve(bundled) !== path.resolve(targetBin)) {
    fs.copyFileSync(bundled, targetBin);
  }

  use(targetBin);

  if (!fs.existsSync(targetBin)) {
    console.log("Downloading cloudflared binary (first run)...");
    await install(targetBin);
  }

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(targetBin, 0o755);
    } catch {
      // ignore
    }
  }

  return targetBin;
}

module.exports = {
  cloudflaredExecutableName,
  resolveWritableCloudflaredBin,
  findBundledCloudflaredBin,
  resolveMacAppBundledCloudflared,
  ensureCloudflaredBinary,
};
