#!/usr/bin/env node
/**
 * Wrapper for release-it.
 * Enables NODE_DEBUG so release-it passes a valid Octokit logger (avoids log:null crash).
 * Loads `.env` / `.env.local` so GITHUB_TOKEN (and other release secrets) come from the project env files.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
dotenv.config({ path: path.join(root, ".env.local"), override: true, quiet: true });

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
