"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/";

const LINUX_ASSETS = {
  arm64: "cloudflared-linux-arm64",
  arm: "cloudflared-linux-arm",
  x64: "cloudflared-linux-amd64",
  ia32: "cloudflared-linux-386",
};

const MACOS_ASSETS = {
  arm64: "cloudflared-darwin-arm64.tgz",
  x64: "cloudflared-darwin-amd64.tgz",
};

const WINDOWS_ASSETS = {
  x64: "cloudflared-windows-amd64.exe",
  ia32: "cloudflared-windows-386.exe",
};

function cloudflaredExecutableName(platform = process.platform) {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
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

function readFileMagic(binPath, length = 4) {
  if (!binPath || !fs.existsSync(binPath)) {
    return null;
  }
  const fd = fs.openSync(binPath, "r");
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, 0);
    return bytesRead > 0 ? buf.subarray(0, bytesRead) : null;
  } finally {
    fs.closeSync(fd);
  }
}

function magicEquals(buf, bytes) {
  if (!buf || buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

/**
 * Heuristic: binary file header matches the expected OS family.
 * Used to reject e.g. a macOS Mach-O shipped inside a Linux .deb/.rpm.
 */
function cloudflaredBinaryLooksCompatible(binPath, platform = process.platform) {
  const magic = readFileMagic(binPath, 4);
  if (!magic) return false;

  if (platform === "linux") {
    return magicEquals(magic, [0x7f, 0x45, 0x4c, 0x46]); // ELF
  }
  if (platform === "darwin") {
    // Mach-O 32/64 (both endianness) and fat/universal
    return (
      magicEquals(magic, [0xfe, 0xed, 0xfa, 0xce]) ||
      magicEquals(magic, [0xce, 0xfa, 0xed, 0xfe]) ||
      magicEquals(magic, [0xfe, 0xed, 0xfa, 0xcf]) ||
      magicEquals(magic, [0xcf, 0xfa, 0xed, 0xfe]) ||
      magicEquals(magic, [0xca, 0xfe, 0xba, 0xbe]) ||
      magicEquals(magic, [0xbe, 0xba, 0xfe, 0xca])
    );
  }
  if (platform === "win32") {
    return magicEquals(magic, [0x4d, 0x5a]); // MZ
  }
  return true;
}

function isCloudflaredBinaryExecutable(binPath) {
  if (!binPath || !fs.existsSync(binPath)) {
    return false;
  }
  try {
    execFileSync(binPath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the file exists, looks like the right OS binary, and can run --version.
 */
function isUsableCloudflaredBinary(binPath, platform = process.platform) {
  if (!cloudflaredBinaryLooksCompatible(binPath, platform)) {
    return false;
  }
  // Cross-packaging on another host: format check is enough (cannot execute).
  if (platform !== process.platform) {
    return true;
  }
  return isCloudflaredBinaryExecutable(binPath);
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

function removeUnusableCloudflaredBinary(binPath, platform = process.platform) {
  if (!binPath || !fs.existsSync(binPath)) {
    return false;
  }
  if (isUsableCloudflaredBinary(binPath, platform)) {
    return false;
  }
  try {
    fs.unlinkSync(binPath);
    console.warn(
      `Removed unusable cloudflared binary at ${binPath} (wrong OS/arch or not executable).`,
    );
    return true;
  } catch (err) {
    console.warn(`Could not remove unusable cloudflared at ${binPath}: ${err.message || err}`);
    return false;
  }
}

function cloudflaredReleaseAssetName(platform, arch) {
  if (platform === "linux") {
    return LINUX_ASSETS[arch] || null;
  }
  if (platform === "darwin") {
    return MACOS_ASSETS[arch] || null;
  }
  if (platform === "win32") {
    return WINDOWS_ASSETS[arch] || null;
  }
  return null;
}

function resolveCloudflaredReleaseBase(version = "latest") {
  if (!version || version === "latest") {
    return `${RELEASE_BASE}latest/download/`;
  }
  const tag = String(version).startsWith("v") ? String(version) : String(version);
  return `${RELEASE_BASE}download/${tag}/`;
}

function downloadHttpsToFile(url, destPath, redirect = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const redirectCodes = [301, 302, 303, 307, 308];
      if (
        response.statusCode &&
        redirectCodes.includes(response.statusCode) &&
        response.headers.location
      ) {
        request.destroy();
        resolve(downloadHttpsToFile(response.headers.location, destPath, redirect + 1));
        return;
      }
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const file = fs.createWriteStream(destPath);
        file.on("finish", () => {
          file.close(() => resolve(destPath));
        });
        file.on("error", (err) => {
          fs.unlink(destPath, () => reject(err));
        });
        response.pipe(file);
        return;
      }
      request.destroy();
      reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
  });
}

/**
 * Sync download for packaging scripts (uses curl; available on macOS/Linux CI).
 */
function downloadCloudflaredAssetSync(destPath, { platform, arch, version = "latest" } = {}) {
  const asset = cloudflaredReleaseAssetName(platform, arch);
  if (!asset) {
    throw new Error(`Unsupported cloudflared target ${platform}/${arch}`);
  }
  const url = `${resolveCloudflaredReleaseBase(version)}${asset}`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (platform === "darwin") {
    const tgz = `${destPath}.tgz`;
    execFileSync("curl", ["-fsSL", "-L", "-o", tgz, url], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    execFileSync("tar", ["-xzf", path.basename(tgz)], {
      cwd: path.dirname(destPath),
      stdio: "pipe",
    });
    fs.unlinkSync(tgz);
    const extracted = path.join(path.dirname(destPath), "cloudflared");
    if (extracted !== destPath) {
      fs.renameSync(extracted, destPath);
    }
  } else {
    execFileSync("curl", ["-fsSL", "-L", "-o", destPath, url], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  if (platform !== "win32") {
    fs.chmodSync(destPath, 0o755);
  }

  if (!cloudflaredBinaryLooksCompatible(destPath, platform)) {
    try {
      fs.unlinkSync(destPath);
    } catch {
      // ignore
    }
    throw new Error(`Downloaded cloudflared is not a valid ${platform} binary`);
  }

  return destPath;
}

/**
 * Download a cloudflared release asset for an explicit platform/arch
 * (e.g. linux/x64 while building packages on macOS).
 */
async function downloadCloudflaredAsset(destPath, { platform, arch, version = "latest" } = {}) {
  const asset = cloudflaredReleaseAssetName(platform, arch);
  if (!asset) {
    throw new Error(`Unsupported cloudflared target ${platform}/${arch}`);
  }
  const url = `${resolveCloudflaredReleaseBase(version)}${asset}`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (platform === "darwin") {
    const tgz = `${destPath}.tgz`;
    await downloadHttpsToFile(url, tgz);
    execFileSync("tar", ["-xzf", path.basename(tgz)], {
      cwd: path.dirname(destPath),
      stdio: "pipe",
    });
    fs.unlinkSync(tgz);
    const extracted = path.join(path.dirname(destPath), "cloudflared");
    if (extracted !== destPath) {
      fs.renameSync(extracted, destPath);
    }
  } else {
    await downloadHttpsToFile(url, destPath);
  }

  if (platform !== "win32") {
    fs.chmodSync(destPath, 0o755);
  }

  if (!cloudflaredBinaryLooksCompatible(destPath, platform)) {
    try {
      fs.unlinkSync(destPath);
    } catch {
      // ignore
    }
    throw new Error(`Downloaded cloudflared is not a valid ${platform} binary`);
  }

  return destPath;
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
  const usable = isUsableCloudflaredBinary(targetBin);

  if (pinnedVersion) {
    if (!usable) {
      return pinnedVersion;
    }
    const installedVersion = readInstalledCloudflaredVersion(targetBin);
    if (!installedVersion || installedVersion !== pinnedVersion) {
      return pinnedVersion;
    }
    return null;
  }

  if (env.CLOUDFLARED_SKIP_UPDATE === "true") {
    return usable ? null : "latest";
  }

  if (!usable) {
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

  removeUnusableCloudflaredBinary(targetBin);

  const bundled = findBundledCloudflaredBin(env);
  if (
    bundled &&
    path.resolve(bundled) !== path.resolve(targetBin) &&
    isUsableCloudflaredBinary(bundled)
  ) {
    const bundledVersion = readInstalledCloudflaredVersion(bundled);
    const targetVersion = readInstalledCloudflaredVersion(targetBin);
    if (
      !fs.existsSync(targetBin) ||
      (bundledVersion &&
        (!targetVersion || compareCloudflaredVersions(targetVersion, bundledVersion) < 0))
    ) {
      fs.copyFileSync(bundled, targetBin);
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(targetBin, 0o755);
        } catch {
          // ignore
        }
      }
    }
  } else if (bundled && !isUsableCloudflaredBinary(bundled)) {
    console.warn(
      `Ignoring bundled cloudflared at ${bundled} (incompatible with ${process.platform}/${process.arch}).`,
    );
  }

  // Bad copy from bundled (e.g. still wrong) — drop again before install().
  removeUnusableCloudflaredBinary(targetBin);

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

  if (!isUsableCloudflaredBinary(targetBin)) {
    throw new Error(
      `cloudflared at ${targetBin} is not usable on ${process.platform}/${process.arch}. ` +
        "Reinstall or set CLOUDFLARED_BIN to a valid executable.",
    );
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
  cloudflaredBinaryLooksCompatible,
  isCloudflaredBinaryExecutable,
  isUsableCloudflaredBinary,
  removeUnusableCloudflaredBinary,
  cloudflaredReleaseAssetName,
  downloadCloudflaredAsset,
  downloadCloudflaredAssetSync,
  RELEASE_BASE,
};
