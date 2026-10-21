"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const MOONLIGHT_WEB_GITHUB_REPO = "flashboss/moonlight-web-stream";
const GITHUB_RELEASES_API = `https://api.github.com/repos/${MOONLIGHT_WEB_GITHUB_REPO}/releases/latest`;
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

/** GitHub release archives from the fork that also publishes macOS builds. */
function detectNativeInstallStrategy() {
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

  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return {
        kind: "tar.gz",
        assetPattern: /^moonlight-web-aarch64-apple-darwin\.tar\.gz$/i,
        image: null,
      };
    }
    if (process.arch === "x64") {
      return {
        kind: "tar.gz",
        assetPattern: /^moonlight-web-x86_64-apple-darwin\.tar\.gz$/i,
        image: null,
      };
    }
  }

  return null;
}

/** Download the release archive for this platform. */
function detectInstallStrategy() {
  return detectNativeInstallStrategy();
}

function missingPackageError(installDir) {
  return new Error(
    `Moonlight Web has no package for ${process.platform}/${process.arch} (${installDir}).`,
  );
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

async function resolveLatestNativeAsset(strategy, env = process.env) {
  const pinned = env.MOONLIGHT_WEB_VERSION?.trim();
  const release = pinned
    ? await fetchJson(
        `https://api.github.com/repos/${MOONLIGHT_WEB_GITHUB_REPO}/releases/tags/v${pinned.replace(/^v/i, "")}`,
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

async function ensureMoonlightWebBinary({ metadataPath, env = process.env } = {}) {
  const installDir = resolveMoonlightWebInstallDir(metadataPath);

  if (env.MOONLIGHT_WEB_SKIP_INSTALL === "true") {
    const manifest = readInstallManifest(installDir);
    const executable = findMoonlightWebExecutable(installDir);
    if (!executable) {
      throw new Error("MOONLIGHT_WEB_SKIP_INSTALL is set but Moonlight Web is not installed");
    }
    return { installDir, executable, version: manifest?.version || null, kind: "native", image: null };
  }

  fs.mkdirSync(installDir, { recursive: true });

  const strategy = detectInstallStrategy();
  if (!strategy) {
    throw missingPackageError(installDir);
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
  resolveMoonlightWebInstallDir,
  detectInstallStrategy,
  findMoonlightWebExecutable,
  ensureMoonlightWebBinary,
  readInstallManifest,
};
