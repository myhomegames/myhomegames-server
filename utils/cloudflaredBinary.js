"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
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

function parseCloudflaredVersion(output) {
  const match = String(output).match(/cloudflared version (\d{4}\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function cloudflaredVersionToNumber(version) {
  const [year, month, patch] = String(version).split(".").map((part) => Number(part));
  if ([year, month, patch].some((part) => Number.isNaN(part))) {
    return null;
  }
  return year * 10000 + month * 100 + patch;
}

function compareCloudflaredVersions(left, right) {
  const leftNum = cloudflaredVersionToNumber(left);
  const rightNum = cloudflaredVersionToNumber(right);
  if (leftNum == null || rightNum == null) {
    return String(left) === String(right) ? 0 : -1;
  }
  return leftNum - rightNum;
}

function readInstalledCloudflaredVersion(binPath) {
  if (!binPath || !fs.existsSync(binPath)) {
    return null;
  }
  try {
    const output = execFileSync(binPath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return parseCloudflaredVersion(output);
  } catch {
    return null;
  }
}

function fetchLatestCloudflaredVersion() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
      {
        headers: {
          "User-Agent": "myhomegames-server",
          Accept: "application/vnd.github+json",
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const tag = JSON.parse(body).tag_name;
              resolve(typeof tag === "string" ? tag.replace(/^v/i, "") : null);
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(new Error(`Failed to fetch latest cloudflared release (${response.statusCode})`));
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(15_000, () => {
      request.destroy(new Error("Timed out fetching latest cloudflared release"));
    });
  });
}

async function resolveCloudflaredInstallVersion(targetBin, env = process.env) {
  const pinnedVersion = env.CLOUDFLARED_VERSION?.trim();
  if (pinnedVersion) {
    const installedVersion = readInstalledCloudflaredVersion(targetBin);
    if (!installedVersion || installedVersion !== pinnedVersion) {
      return pinnedVersion;
    }
    return null;
  }

  if (env.CLOUDFLARED_SKIP_UPDATE === "true") {
    return fs.existsSync(targetBin) ? null : "latest";
  }

  if (!fs.existsSync(targetBin)) {
    return "latest";
  }

  try {
    const [installedVersion, latestVersion] = await Promise.all([
      Promise.resolve(readInstalledCloudflaredVersion(targetBin)),
      fetchLatestCloudflaredVersion(),
    ]);
    if (!installedVersion || !latestVersion) {
      return "latest";
    }
    if (compareCloudflaredVersions(installedVersion, latestVersion) < 0) {
      return "latest";
    }
    return null;
  } catch {
    return null;
  }
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
    const bundledVersion = readInstalledCloudflaredVersion(bundled);
    const targetVersion = readInstalledCloudflaredVersion(targetBin);
    if (
      !fs.existsSync(targetBin) ||
      (bundledVersion &&
        (!targetVersion || compareCloudflaredVersions(targetVersion, bundledVersion) < 0))
    ) {
      fs.copyFileSync(bundled, targetBin);
    }
  }

  use(targetBin);

  const installVersion = await resolveCloudflaredInstallVersion(targetBin, env);
  if (installVersion) {
    const installedVersion = readInstalledCloudflaredVersion(targetBin);
    if (!installedVersion) {
      console.log(`Downloading cloudflared binary (${installVersion})...`);
    } else {
      console.log(`Updating cloudflared binary (${installedVersion} -> ${installVersion})...`);
    }
    await install(targetBin, installVersion);
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
  parseCloudflaredVersion,
  cloudflaredVersionToNumber,
  compareCloudflaredVersions,
  readInstalledCloudflaredVersion,
  fetchLatestCloudflaredVersion,
  resolveCloudflaredInstallVersion,
  ensureCloudflaredBinary,
};
