#!/usr/bin/env node
/**
 * Merge the release tag into main and push main.
 * Runs only after release-it succeeds. main keeps its merge history, so this
 * is a merge commit (same shape as "Merge tag '1.2.7'"), not a branch reset.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args, { cwd = root, allowFail = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (!allowFail && result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }
  return result;
}

function httpsRemote(url) {
  const ssh = String(url || "").match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  return String(url || "").replace(/\.git$/, "");
}

function readReleaseVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const version = String(packageJson.version || "").trim();
  if (!/^[0-9A-Za-z._+-]+$/.test(version)) {
    throw new Error(`Refusing to align main: unexpected package version "${version}"`);
  }
  return version;
}

function removeWorktree(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  git(["worktree", "remove", "--force", dir], { allowFail: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

function alignMainToReleaseTag() {
  const version = readReleaseVersion();
  const tagRef = git(["rev-parse", "--verify", `refs/tags/${version}^{commit}`], { allowFail: true });
  if (tagRef.status !== 0) {
    throw new Error(`Release tag ${version} is not available locally, so main was not updated.`);
  }

  git(["fetch", "origin", "main"]);
  const originMain = git(["rev-parse", "--verify", "origin/main"]).stdout.trim();
  const already = git(["merge-base", "--is-ancestor", version, "origin/main"], { allowFail: true });
  if (already.status === 0) {
    const current = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (current !== "main") {
      git(["branch", "-f", "main", "origin/main"]);
    }
    console.log(`main already contains release tag ${version}.`);
    return;
  }

  const remoteUrl = httpsRemote(git(["remote", "get-url", "origin"]).stdout.trim());
  const tagSubject =
    git(["for-each-ref", `refs/tags/${version}`, "--format=%(contents:subject)"]).stdout.trim() ||
    `Release ${version}`;
  const message = `Merge tag '${version}' of ${remoteUrl}\n\n${tagSubject}\n`;

  const worktree = path.join(os.tmpdir(), `mhg-align-main-${version}-${process.pid}`);
  removeWorktree(worktree);
  try {
    git(["worktree", "add", "--detach", worktree, "origin/main"]);
    const merge = git(["merge", "--no-ff", version, "-m", message], { cwd: worktree, allowFail: true });
    if (merge.status !== 0) {
      git(["merge", "--abort"], { cwd: worktree, allowFail: true });
      throw new Error(
        (merge.stderr || merge.stdout || "").trim() || `Could not merge tag ${version} into main.`,
      );
    }
    git(["push", "origin", "HEAD:main"], { cwd: worktree });
    const merged = git(["rev-parse", "HEAD"], { cwd: worktree }).stdout.trim();
    const current = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (current !== "main") {
      const update = git(["branch", "-f", "main", merged], { allowFail: true });
      if (update.status !== 0) {
        console.warn("Pushed main, but the local main branch was left unchanged.");
      }
    }
    console.log(`Aligned main to release tag ${version} (${merged.slice(0, 7)}), was ${originMain.slice(0, 7)}.`);
  } finally {
    removeWorktree(worktree);
  }
}

try {
  alignMainToReleaseTag();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
