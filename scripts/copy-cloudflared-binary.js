#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { cloudflaredExecutableName } = require("../utils/cloudflaredBinary");

/**
 * Copy cloudflared from node_modules into a release directory (macOS .app Resources, Linux opt, etc.).
 * @param {string} destDir directory that will contain the executable (not the full file path)
 * @returns {boolean} true when copied
 */
function copyCloudflaredBinary(destDir) {
  const binName = cloudflaredExecutableName();
  const src = path.join(__dirname, "..", "node_modules", "cloudflared", "bin", binName);
  if (!fs.existsSync(src)) {
    console.warn(
      `⚠️  cloudflared binary not found at ${src}; release will download on first server start.`,
    );
    return false;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, binName);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`✅ cloudflared copied to ${dest}`);
  return true;
}

module.exports = { copyCloudflaredBinary };
