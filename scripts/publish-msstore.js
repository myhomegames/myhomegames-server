#!/usr/bin/env node
/**
 * Publish MyHomeGames MSIX to the Microsoft Store (Partner Center).
 *
 * Called from release-it after:release. Skipped when Store env vars are missing.
 *
 * Typical release on macOS: GitHub Actions workflow `.github/workflows/msstore-release.yml`
 * runs automatically when the GitHub release is published (configure MSSTORE_* secrets
 * in the repository).
 *
 * Release on Windows: builds MSIX locally (if missing) and runs `msstore publish`.
 *
 * Env (local Windows publish, or documented for GitHub secrets):
 *   MSSTORE_APP_ID
 *   MSSTORE_TENANT_ID
 *   MSSTORE_SELLER_ID
 *   MSSTORE_CLIENT_ID
 *   MSSTORE_CLIENT_SECRET
 *   MSSTORE_IDENTITY_PUBLISHER       CN=... (Partner Center app identity)
 *   MSSTORE_IDENTITY_NAME           optional, default MyHomeGames.Server
 *   MSSTORE_PUBLISHER_DISPLAY_NAME  optional
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
require('dotenv').config({ path: path.join(ROOT, '.env.local'), override: true, quiet: true });

const { buildWindowsMsix, msixPathForVersion } = require('./build-windows-msix');

function log(msg) {
  console.log(`[msstore] ${msg}`);
}

function warn(msg) {
  console.warn(`[msstore] ⚠️  ${msg}`);
}

function storeConfigured() {
  return Boolean(
    process.env.MSSTORE_APP_ID &&
      process.env.MSSTORE_TENANT_ID &&
      process.env.MSSTORE_SELLER_ID &&
      process.env.MSSTORE_CLIENT_ID &&
      process.env.MSSTORE_CLIENT_SECRET &&
      process.env.MSSTORE_IDENTITY_PUBLISHER,
  );
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function msstoreAvailable() {
  const r = spawnSync('msstore', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function reconfigureMsstore() {
  const { MSSTORE_TENANT_ID, MSSTORE_SELLER_ID, MSSTORE_CLIENT_ID, MSSTORE_CLIENT_SECRET } =
    process.env;
  run(
    `msstore reconfigure --tenantId ${shellQuote(MSSTORE_TENANT_ID)} --sellerId ${shellQuote(MSSTORE_SELLER_ID)} --clientId ${shellQuote(MSSTORE_CLIENT_ID)} --clientSecret ${shellQuote(MSSTORE_CLIENT_SECRET)}`,
  );
}

function publishMsix(msixPath) {
  const appId = process.env.MSSTORE_APP_ID;
  if (!msstoreAvailable()) {
    throw new Error(
      'msstore CLI not found. Install: winget install "Microsoft Store Developer CLI"',
    );
  }
  reconfigureMsstore();
  log(`Publishing ${path.basename(msixPath)} → Store app ${appId}`);
  run(`msstore publish ${shellQuote(msixPath)} -id ${shellQuote(appId)}`);
  log('Store submission started (certification may take hours in Partner Center)');
}

function main() {
  if (process.platform !== 'win32') {
    log(
      'Store: on macOS/Linux the MSIX is built and submitted by GitHub Actions (msstore-release.yml) when the GitHub release is published.',
    );
    log('Configure MSSTORE_* secrets in the repository. See docs/install-msstore.md.');
    return;
  }

  if (!storeConfigured()) {
    warn(
      'Store: skipped (set MSSTORE_APP_ID, MSSTORE_* credentials, MSSTORE_IDENTITY_PUBLISHER)',
    );
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const msixPath = msixPathForVersion(version);

  try {
    if (!fs.existsSync(msixPath)) {
      log('Building MSIX locally…');
      buildWindowsMsix();
    }
    publishMsix(msixPath);
  } catch (err) {
    warn(`Store: failed (${err.message})`);
  }
}

main();
