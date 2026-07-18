"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { ensureDockerRuntime, isDockerDaemonReady } = require("./dockerRuntime");

const GITHUB_RELEASES_API = "https://api.github.com/repos/MrCreativ3001/moonlight-web-stream/releases/latest";
const DOCKER_IMAGE = "mrcreativ3001/moonlight-web-stream";
const INSTALL_MANIFEST = "install.json";
const MIN_ARCHIVE_BYTES = 1024 * 1024;

function resolveMoonlightWebInstallDir(metadataPath) {
  const base = metadataPath || path.join(os.homedir(), "Library", "Application Support", "MyHomeGames");
  return path.join(base, "moonlight-web");
}

function readInstallManifest(installDir) {
  const manifestPath = path.join(installDir, INSTALL_MANIFEST);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function writeInstallManifest(installDir, manifest) {
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, INSTALL_MANIFEST), JSON.stringify(manifest, null, 2), "utf8");
}

function isDockerAvailable() {
  return isDockerDaemonReady();
}

/**
 * Prefer Docker on every platform (auto-installed via Colima/Docker Engine when missing).
 * Native GitHub archives remain a fallback on Windows/Linux when Docker cannot be provisioned
 * or MOONLIGHT_WEB_FORCE_NATIVE=true.
 */
function detectInstallStrategy(env = process.env) {
  const forceNative = env.MOONLIGHT_WEB_FORCE_NATIVE === "true";
  if (!forceNative) {
    return { kind: "docker", assetPattern: null, image: null };
  }

  if (process.platform === "darwin") {
    // No official macOS binary — Docker remains required even if "force native".
    return { kind: "docker", assetPattern: null, image: null, dockerRequired: true };
  }

  if (process.platform === "win32") {
    return {
      kind: "zip",
      assetPattern: /^moonlight-web-x86_64-pc-windows-gnu\.zip$/i,
      image: null,
    };
  }

  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return {
        kind: "tar.gz",
        assetPattern: /^moonlight-web-aarch64-unknown-linux-gnu\.tar\.gz$/i,
        image: null,
      };
    }
    return {
      kind: "tar.gz",
      assetPattern: /^moonlight-web-x86_64-unknown-linux-gnu\.tar\.gz$/i,
      image: null,
    };
  }

  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
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
              resolve(JSON.parse(body));
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(
      url,
      { headers: { "User-Agent": "myhomegames-server" } },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close(() => {
            fs.unlink(destPath, () => {});
            downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
          });
          return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          file.close(() => {
            fs.unlink(destPath, () => {});
            reject(new Error(`Download failed (${response.statusCode})`));
          });
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      },
    );
    request.on("error", (error) => {
      file.close(() => {
        fs.unlink(destPath, () => {});
        reject(error);
      });
    });
    request.setTimeout(180_000, () => {
      request.destroy(new Error("Timed out downloading Moonlight Web"));
    });
  });
}

function resolveDockerImage(env = process.env) {
  const pinned = env.MOONLIGHT_WEB_VERSION?.trim();
  if (!pinned || pinned === "latest") {
    return `${DOCKER_IMAGE}:latest`;
  }
  const tag = pinned.startsWith("v") ? pinned : `v${pinned.replace(/^v/i, "")}`;
  return `${DOCKER_IMAGE}:${tag}`;
}

async function resolveLatestNativeAsset(strategy, env = process.env) {
  const pinned = env.MOONLIGHT_WEB_VERSION?.trim();
  const release = pinned
    ? await fetchJson(
        `https://api.github.com/repos/MrCreativ3001/moonlight-web-stream/releases/tags/v${pinned.replace(/^v/i, "")}`,
      )
    : await fetchJson(GITHUB_RELEASES_API);

  const tag = String(release.tag_name || "").replace(/^v/i, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => strategy.assetPattern.test(item.name));
  if (!asset?.browser_download_url) {
    throw new Error(`No Moonlight Web release asset found for ${process.platform}/${process.arch}`);
  }

  return {
    version: tag,
    name: asset.name,
    url: asset.browser_download_url,
    kind: strategy.kind,
    size: typeof asset.size === "number" ? asset.size : null,
  };
}

function findMoonlightWebExecutable(installDir) {
  if (!installDir || !fs.existsSync(installDir)) return null;

  const candidates = [
    path.join(installDir, "package", "web-server.exe"),
    path.join(installDir, "package", "web-server"),
    path.join(installDir, "web-server.exe"),
    path.join(installDir, "web-server"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const stack = [installDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower === "web-server" || lower === "web-server.exe") return full;
    }
  }
  return null;
}

function validateDownloadedArchive(archivePath, expectedSize) {
  const stat = fs.statSync(archivePath);
  if (stat.size < MIN_ARCHIVE_BYTES) {
    fs.unlinkSync(archivePath);
    throw new Error(`Downloaded archive is too small (${stat.size} bytes)`);
  }
  if (expectedSize && stat.size < expectedSize * 0.9) {
    fs.unlinkSync(archivePath);
    throw new Error(`Downloaded archive is incomplete (${stat.size} of ${expectedSize} bytes)`);
  }
}

function extractZip(archivePath, installDir) {
  const AdmZip = require("adm-zip");
  const extractRoot = path.join(installDir, "runtime");
  if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  new AdmZip(archivePath).extractAllTo(extractRoot, true);

  const nestedPackage = path.join(extractRoot, "package");
  const packageDest = path.join(installDir, "package");
  if (fs.existsSync(packageDest)) fs.rmSync(packageDest, { recursive: true, force: true });
  if (fs.existsSync(nestedPackage)) {
    fs.renameSync(nestedPackage, packageDest);
    fs.rmSync(extractRoot, { recursive: true, force: true });
  } else {
    fs.renameSync(extractRoot, packageDest);
  }
}

function extractTarGz(archivePath, installDir) {
  const extractRoot = path.join(installDir, "runtime");
  if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", extractRoot], { stdio: "pipe" });

  const nestedPackage = path.join(extractRoot, "package");
  const packageDest = path.join(installDir, "package");
  if (fs.existsSync(packageDest)) fs.rmSync(packageDest, { recursive: true, force: true });
  if (fs.existsSync(nestedPackage)) {
    fs.renameSync(nestedPackage, packageDest);
    fs.rmSync(extractRoot, { recursive: true, force: true });
  } else {
    fs.renameSync(extractRoot, packageDest);
  }
}

function pullDockerImage(image) {
  console.log(`Pulling Moonlight Web Docker image (${image})...`);
  execFileSync("docker", ["pull", image], {
    stdio: "inherit",
    timeout: 600_000,
  });
}

async function ensureMoonlightWebBinary({ metadataPath, env = process.env } = {}) {
  if (env.MOONLIGHT_WEB_SKIP_INSTALL === "true") {
    const installDir = resolveMoonlightWebInstallDir(metadataPath);
    const manifest = readInstallManifest(installDir);
    if (manifest?.kind === "docker") {
      return { installDir, executable: null, version: manifest.version || null, kind: "docker", image: manifest.image };
    }
    const executable = findMoonlightWebExecutable(installDir);
    if (!executable) {
      throw new Error("MOONLIGHT_WEB_SKIP_INSTALL is set but Moonlight Web is not installed");
    }
    return { installDir, executable, version: manifest?.version || null, kind: "native", image: null };
  }

  const installDir = resolveMoonlightWebInstallDir(metadataPath);
  fs.mkdirSync(installDir, { recursive: true });

  const strategy = detectInstallStrategy(env);
  if (!strategy) {
    throw new Error(`Moonlight Web auto-install is not supported on ${process.platform}/${process.arch}`);
  }

  if (strategy.kind === "docker") {
    try {
      await ensureDockerRuntime({ metadataPath, env });
    } catch (error) {
      if (process.platform !== "darwin" && env.MOONLIGHT_WEB_FORCE_DOCKER !== "true") {
        console.warn(
          `Docker auto-install failed (${error.message || error}). Falling back to native Moonlight Web binary.`,
        );
        const nativeStrategy = detectInstallStrategy({ ...env, MOONLIGHT_WEB_FORCE_NATIVE: "true" });
        if (nativeStrategy?.kind && nativeStrategy.kind !== "docker") {
          const asset = await resolveLatestNativeAsset(nativeStrategy, env);
          return installNativeMoonlightWeb({ asset, installDir, env });
        }
      }
      throw error;
    }

    if (!isDockerDaemonReady()) {
      throw new Error(
        "Docker runtime was provisioned but the daemon is not reachable yet. Retry in a minute.",
      );
    }

    const image = resolveDockerImage(env);
    const version = env.MOONLIGHT_WEB_VERSION?.trim() || "latest";
    const manifest = readInstallManifest(installDir);
    if (manifest?.kind === "docker" && manifest?.image === image) {
      return { installDir, executable: null, version: manifest.version || version, kind: "docker", image };
    }

    pullDockerImage(image);
    writeInstallManifest(installDir, {
      version,
      kind: "docker",
      image,
      installedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
    });
    console.log(`Moonlight Web Docker image ready: ${image}`);
    return { installDir, executable: null, version, kind: "docker", image };
  }

  const asset = await resolveLatestNativeAsset(strategy, env);
  return installNativeMoonlightWeb({ asset, installDir, env });
}

async function installNativeMoonlightWeb({ asset, installDir }) {
  const manifest = readInstallManifest(installDir);
  const existingExecutable = findMoonlightWebExecutable(installDir);
  if (manifest?.version === asset.version && existingExecutable) {
    return {
      installDir,
      executable: existingExecutable,
      version: asset.version,
      kind: "native",
      image: null,
    };
  }

  const downloadsDir = path.join(installDir, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  console.log(`Downloading Moonlight Web ${asset.version} (${asset.name})...`);
  const archivePath = path.join(downloadsDir, asset.name);
  await downloadFile(asset.url, archivePath);
  validateDownloadedArchive(archivePath, asset.size);

  if (asset.kind === "zip") extractZip(archivePath, installDir);
  else extractTarGz(archivePath, installDir);

  const executable = findMoonlightWebExecutable(installDir);
  if (!executable) {
    throw new Error("Moonlight Web install completed but web-server executable was not found");
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(executable, 0o755);
      const streamer = path.join(path.dirname(executable), "streamer");
      if (fs.existsSync(streamer)) fs.chmodSync(streamer, 0o755);
    } catch {
      // ignore
    }
  }

  writeInstallManifest(installDir, {
    version: asset.version,
    asset: asset.name,
    kind: "native",
    executable,
    installedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
  });
  console.log(`Moonlight Web ${asset.version} installed at ${executable}`);
  return { installDir, executable, version: asset.version, kind: "native", image: null };
}

module.exports = {
  DOCKER_IMAGE,
  resolveMoonlightWebInstallDir,
  detectInstallStrategy,
  findMoonlightWebExecutable,
  ensureMoonlightWebBinary,
  readInstallManifest,
  isDockerAvailable,
  resolveDockerImage,
};
