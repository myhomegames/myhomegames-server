#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  cloudflaredExecutableName,
  cloudflaredBinaryLooksCompatible,
  cloudflaredReleaseAssetName,
  downloadCloudflaredAssetSync,
} = require("../utils/cloudflaredBinary");

/**
 * Place a cloudflared binary into destDir for a release package.
 * When packaging for another OS (e.g. Linux .deb on macOS), downloads that
 * platform's GitHub release asset instead of copying the host node_modules binary.
 *
 * @param {string} destDir directory that will contain the executable
 * @param {{ platform?: string, arch?: string, version?: string }} [options]
 * @returns {boolean} true when a binary was written
 */
function copyCloudflaredBinary(destDir, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const version = options.version || process.env.CLOUDFLARED_VERSION?.trim() || "latest";
  const binName = cloudflaredExecutableName(platform);
  const dest = path.join(destDir, binName);

  fs.mkdirSync(destDir, { recursive: true });

  const hostMatches = platform === process.platform && arch === process.arch;
  const src = path.join(
    __dirname,
    "..",
    "node_modules",
    "cloudflared",
    "bin",
    cloudflaredExecutableName(process.platform),
  );

  if (
    hostMatches &&
    fs.existsSync(src) &&
    cloudflaredBinaryLooksCompatible(src, platform)
  ) {
    fs.copyFileSync(src, dest);
    if (platform !== "win32") {
      fs.chmodSync(dest, 0o755);
    }
    console.log(`✅ cloudflared copied to ${dest}`);
    return true;
  }

  if (!cloudflaredReleaseAssetName(platform, arch)) {
    console.warn(
      `⚠️  No cloudflared release asset for ${platform}/${arch}; release will download on first server start.`,
    );
    return false;
  }

  try {
    console.log(
      `Downloading cloudflared for ${platform}/${arch} (${version}) into ${destDir}...`,
    );
    downloadCloudflaredAssetSync(dest, { platform, arch, version });
    console.log(`✅ cloudflared downloaded to ${dest}`);
    return true;
  } catch (err) {
    console.warn(
      `⚠️  cloudflared download failed (${err.message || err}); release will download on first server start.`,
    );
    return false;
  }
}

module.exports = { copyCloudflaredBinary };
