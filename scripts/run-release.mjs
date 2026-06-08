#!/usr/bin/env node
/**
 * Wrapper for release-it.
 * Enables NODE_DEBUG so release-it passes a valid Octokit logger (avoids log:null crash).
 */

import { spawnSync } from "node:child_process";

if (!process.env.NODE_DEBUG?.includes("release-it")) {
  process.env.NODE_DEBUG = [process.env.NODE_DEBUG, "release-it:config"]
    .filter(Boolean)
    .join(",");
}

const check = spawnSync("node", ["scripts/check-github-token.mjs"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (check.status !== 0) {
  process.exit(check.status ?? 1);
}

const result = spawnSync("npx", ["release-it", "--no-increment"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
