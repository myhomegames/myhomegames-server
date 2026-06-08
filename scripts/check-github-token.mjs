#!/usr/bin/env node
/**
 * Warn when GITHUB_TOKEN is missing — release-it falls back to the GitHub web UI.
 */

if (process.env.GITHUB_ACTIONS === "true") {
  process.exit(0);
}

const token = String(process.env.GITHUB_TOKEN || "").trim();
if (token) {
  process.exit(0);
}

console.warn(`
WARNING: GITHUB_TOKEN is not set.

release-it will open the GitHub "new release" page in the browser instead of using
the API. Build artifacts (.pkg, .deb, .rpm, .tar.gz, .zip) are not uploaded
automatically in that mode, and a long changelog in the URL may fail with
"Your request URL is too long."

Recommended:
  https://github.com/settings/tokens → Generate new token (classic) → scope "repo"
  export GITHUB_TOKEN=ghp_your_token_here
  npm run release

See DEVELOPMENT.md for details.
`);
