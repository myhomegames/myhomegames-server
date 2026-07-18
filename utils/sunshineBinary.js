"use strict";

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const GITHUB_RELEASES_API = "https://api.github.com/repos/LizardByte/Sunshine/releases/latest";
const INSTALL_MANIFEST = "install.json";
const MIN_DMG_BYTES = 5 * 1024 * 1024;
const MIN_ARCHIVE_BYTES = 1024 * 1024;

function resolveSunshineInstallDir(metadataPath) {
  const base = metadataPath || path.join(os.homedir(), "Library", "Application Support", "MyHomeGames");
  return path.join(base, "sunshine");
}

function resolveSunshineDownloadsDir(installDir) {
  return path.join(installDir, "downloads");
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
  fs.writeFileSync(
    path.join(installDir, INSTALL_MANIFEST),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

function detectPlatformAsset() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") {
    if (arch === "arm64") {
      return { kind: "zip", assetPattern: /^Sunshine-Windows-ARM64-portable\.zip$/i };
    }
    return { kind: "zip", assetPattern: /^Sunshine-Windows-AMD64-portable\.zip$/i };
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return { kind: "dmg", assetPattern: /^Sunshine-macOS-arm64\.dmg$/i };
    }
    return { kind: "dmg", assetPattern: /^Sunshine-macOS-x86_64\.dmg$/i };
  }

  if (platform === "linux") {
    return { kind: "appimage", assetPattern: /^sunshine\.AppImage$/i };
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
      {
        headers: { "User-Agent": "myhomegames-server" },
      },
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
        file.on("finish", () => {
          file.close(() => resolve(destPath));
        });
      },
    );
    request.on("error", (error) => {
      file.close(() => {
        fs.unlink(destPath, () => {});
        reject(error);
      });
    });
    request.setTimeout(120_000, () => {
      request.destroy(new Error("Timed out downloading Sunshine"));
    });
  });
}

async function resolveLatestSunshineAsset(env = process.env) {
  const pinned = env.SUNSHINE_VERSION?.trim();
  const platformAsset = detectPlatformAsset();
  if (!platformAsset) {
    throw new Error(`Sunshine auto-install is not supported on ${process.platform}/${process.arch}`);
  }

  const release = pinned
    ? await fetchJson(`https://api.github.com/repos/LizardByte/Sunshine/releases/tags/v${pinned.replace(/^v/i, "")}`)
    : await fetchJson(GITHUB_RELEASES_API);

  const tag = String(release.tag_name || "").replace(/^v/i, "");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => platformAsset.assetPattern.test(item.name));
  if (!asset?.browser_download_url) {
    throw new Error(`No Sunshine release asset found for ${process.platform}/${process.arch}`);
  }

  return {
    version: tag,
    name: asset.name,
    url: asset.browser_download_url,
    kind: platformAsset.kind,
    size: typeof asset.size === "number" ? asset.size : null,
  };
}

function validateDownloadedArchive(archivePath, kind, expectedSize) {
  let stat;
  try {
    stat = fs.statSync(archivePath);
  } catch {
    throw new Error(`Downloaded archive is missing: ${archivePath}`);
  }

  const minBytes = kind === "dmg" ? MIN_DMG_BYTES : MIN_ARCHIVE_BYTES;
  if (stat.size < minBytes) {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      // ignore
    }
    throw new Error(
      `Downloaded ${path.basename(archivePath)} is too small (${stat.size} bytes); expected at least ${minBytes}`,
    );
  }

  if (expectedSize && stat.size < expectedSize * 0.9) {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      // ignore
    }
    throw new Error(
      `Downloaded ${path.basename(archivePath)} is incomplete (${stat.size} of ${expectedSize} bytes)`,
    );
  }

  if (kind === "dmg") {
    const header = Buffer.alloc(4);
    const fd = fs.openSync(archivePath, "r");
    try {
      fs.readSync(fd, header, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }

    const looksLikeText = header.every((byte) => byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e));
    if (looksLikeText) {
      try {
        fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
      throw new Error(`Downloaded ${path.basename(archivePath)} looks like text/HTML, not a disk image`);
    }
  }
}

function stripQuarantine(targetPath) {
  try {
    execFileSync("xattr", ["-cr", targetPath], { stdio: "pipe" });
  } catch {
    // ignore
  }
}

function prepareMacAppBundle(appBundlePath) {
  if (process.platform !== "darwin" || !appBundlePath.endsWith(".app")) {
    return;
  }

  stripQuarantine(appBundlePath);

  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appBundlePath], { stdio: "pipe" });
  } catch (error) {
    console.warn(
      `Could not ad-hoc sign ${path.basename(appBundlePath)}: ${error.message || error}`,
    );
  }
}

function resolveMacAppBundle(executable) {
  if (!executable?.includes(".app/Contents/MacOS/")) {
    return null;
  }
  return executable.split("/Contents/MacOS/")[0];
}

function copyMacAppBundle(sourceApp, destApp) {
  if (fs.existsSync(destApp)) {
    fs.rmSync(destApp, { recursive: true, force: true });
  }
  execFileSync("ditto", [sourceApp, destApp], { stdio: "pipe" });
  prepareMacAppBundle(destApp);
}

function runHdiutil(args, { timeoutMs = 120_000 } = {}) {
  const result = spawnSync("hdiutil", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === 0) {
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  }

  const details = [result.stderr, result.stdout].map((chunk) => chunk?.trim()).filter(Boolean).join(" — ");
  throw new Error(details || `hdiutil ${args[0]} failed with exit code ${result.status}`);
}

function attachDmgNonInteractive(dmgPath, mountPoint) {
  stripQuarantine(dmgPath);

  const attachArgs = [
    "attach",
    dmgPath,
    "-mountpoint",
    mountPoint,
    "-nobrowse",
    "-noautoopen",
    "-noverify",
  ];

  const interactiveAttach = spawnSync(
    "/bin/sh",
    ["-c", 'yes | PAGER=cat hdiutil "$@"', "hdiutil", ...attachArgs],
    {
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PAGER: "cat" },
    },
  );

  if (interactiveAttach.status === 0) {
    return;
  }

  const attachError = [interactiveAttach.stderr, interactiveAttach.stdout]
    .map((chunk) => chunk?.trim())
    .filter(Boolean)
    .join(" — ");

  const convertedBase = path.join(path.dirname(dmgPath), ".sunshine-dmg-converted");
  const convertedCdr = `${convertedBase}.cdr`;
  try {
    runHdiutil(["convert", dmgPath, "-format", "UDTO", "-o", convertedBase], { timeoutMs: 180_000 });
    runHdiutil([
      "attach",
      convertedCdr,
      "-mountpoint",
      mountPoint,
      "-nobrowse",
      "-noautoopen",
      "-noverify",
    ]);
  } catch (convertError) {
    throw new Error(
      attachError
        ? `hdiutil attach failed: ${attachError}`
        : convertError.message || "hdiutil attach failed",
    );
  }
}

function findSunshineExecutable(installDir) {
  if (!installDir || !fs.existsSync(installDir)) return null;

  const macApp = path.join(installDir, "Sunshine.app", "Contents", "MacOS", "sunshine");
  if (fs.existsSync(macApp)) return macApp;

  const macAppAlt = path.join(installDir, "Sunshine.app", "Contents", "MacOS", "Sunshine");
  if (fs.existsSync(macAppAlt)) return macAppAlt;

  const appImage = path.join(installDir, "sunshine.AppImage");
  if (fs.existsSync(appImage)) return appImage;

  const winExe = path.join(installDir, "sunshine.exe");
  if (fs.existsSync(winExe)) return winExe;

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
      if (lower === "sunshine.exe" || lower === "sunshine" || lower === "sunshine.appimage") {
        return full;
      }
    }
  }

  return null;
}

function installFromZip(zipPath, installDir) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  const extractDir = path.join(installDir, "portable");
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });
  zip.extractAllTo(extractDir, true);
}

function installFromAppImage(appImagePath, installDir) {
  const dest = path.join(installDir, "sunshine.AppImage");
  fs.copyFileSync(appImagePath, dest);
  fs.chmodSync(dest, 0o755);
}

function installFromDmg(dmgPath, installDir) {
  const mountPoint = path.join(installDir, ".dmg-mount");
  if (fs.existsSync(mountPoint)) {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
  fs.mkdirSync(mountPoint, { recursive: true });

  try {
    attachDmgNonInteractive(dmgPath, mountPoint);

    const entries = fs.readdirSync(mountPoint);
    const appName = entries.find((name) => name.endsWith(".app"));
    if (!appName) {
      throw new Error("Sunshine.app not found in DMG");
    }

    const appDest = path.join(installDir, appName);
    copyMacAppBundle(path.join(mountPoint, appName), appDest);
  } finally {
    try {
      runHdiutil(["detach", mountPoint]);
    } catch {
      // ignore
    }
    if (fs.existsSync(mountPoint)) {
      fs.rmSync(mountPoint, { recursive: true, force: true });
    }
    const convertedCdr = path.join(path.dirname(dmgPath), ".sunshine-dmg-converted.cdr");
    if (fs.existsSync(convertedCdr)) {
      try {
        fs.unlinkSync(convertedCdr);
      } catch {
        // ignore
      }
    }
  }
}

async function ensureSunshineBinary({ metadataPath, env = process.env } = {}) {
  if (env.SUNSHINE_SKIP_INSTALL === "true") {
    const installDir = resolveSunshineInstallDir(metadataPath);
    const executable = findSunshineExecutable(installDir);
    if (!executable) {
      throw new Error("SUNSHINE_SKIP_INSTALL is set but no Sunshine binary is installed");
    }
    return { installDir, executable, version: readInstallManifest(installDir)?.version || null };
  }

  const installDir = resolveSunshineInstallDir(metadataPath);
  const downloadsDir = resolveSunshineDownloadsDir(installDir);
  fs.mkdirSync(downloadsDir, { recursive: true });

  const asset = await resolveLatestSunshineAsset(env);
  const manifest = readInstallManifest(installDir);
  const existingExecutable = findSunshineExecutable(installDir);
  if (manifest?.version === asset.version && existingExecutable) {
    const appBundle = resolveMacAppBundle(existingExecutable);
    if (appBundle) {
      prepareMacAppBundle(appBundle);
    }
    return { installDir, executable: existingExecutable, version: asset.version };
  }

  console.log(`Downloading Sunshine ${asset.version} (${asset.name})...`);
  const archivePath = path.join(downloadsDir, asset.name);
  await downloadFile(asset.url, archivePath);
  validateDownloadedArchive(archivePath, asset.kind, asset.size);

  if (asset.kind === "zip") {
    installFromZip(archivePath, installDir);
  } else if (asset.kind === "appimage") {
    installFromAppImage(archivePath, installDir);
  } else if (asset.kind === "dmg") {
    installFromDmg(archivePath, installDir);
  } else {
    throw new Error(`Unsupported Sunshine package kind: ${asset.kind}`);
  }

  const executable = findSunshineExecutable(installDir);
  if (!executable) {
    throw new Error("Sunshine install completed but executable was not found");
  }

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(executable, 0o755);
    } catch {
      // ignore
    }
  }

  writeInstallManifest(installDir, {
    version: asset.version,
    asset: asset.name,
    executable,
    installedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
  });

  console.log(`Sunshine ${asset.version} installed at ${executable}`);
  return { installDir, executable, version: asset.version };
}

module.exports = {
  resolveSunshineInstallDir,
  detectPlatformAsset,
  findSunshineExecutable,
  ensureSunshineBinary,
  readInstallManifest,
  validateDownloadedArchive,
  prepareMacAppBundle,
  resolveMacAppBundle,
  MIN_DMG_BYTES,
};
