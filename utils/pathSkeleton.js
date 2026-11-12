"use strict";

const fs = require("fs");
const path = require("path");

/**
 * List paths like `find <root>` (root + every dir/file), sorted depth-first as walk order
 * with names sorted per directory. Paths are relative to the parent of `root`, so the
 * chosen folder basename is the first segment (e.g. dosprograms/games/…).
 *
 * @param {string} rootPath absolute folder chosen by the user
 * @returns {{ rootPath: string, rootName: string, paths: string[] }}
 */
function listFindPaths(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || "").trim());
  if (!root || !fs.existsSync(root)) {
    const err = new Error("Folder does not exist");
    err.code = "ENOENT";
    throw err;
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    const err = new Error("Path is not a directory");
    err.code = "ENOTDIR";
    throw err;
  }

  const rootName = path.basename(root);
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 0;
  const paths = [rootName];

  function walk(absDir, relFromRoot) {
    if (maxEntries > 0 && paths.length >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const dirs = [];
    const files = [];
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      if (ent.isDirectory()) dirs.push(ent);
      else if (ent.isFile() || ent.isSymbolicLink()) files.push(ent);
    }
    for (const ent of dirs) {
      if (maxEntries > 0 && paths.length >= maxEntries) return;
      const rel = relFromRoot ? `${relFromRoot}/${ent.name}` : ent.name;
      paths.push(`${rootName}/${rel}`);
      walk(path.join(absDir, ent.name), rel);
    }
    for (const ent of files) {
      if (maxEntries > 0 && paths.length >= maxEntries) return;
      const rel = relFromRoot ? `${relFromRoot}/${ent.name}` : ent.name;
      paths.push(`${rootName}/${rel}`);
    }
  }

  walk(root, "");
  return { rootPath: root, rootName, paths };
}

/**
 * Longest common prefix of `prev` and `curr` that ends on a `/` boundary (or empty).
 */
function commonDirPrefixLength(prev, curr) {
  const a = String(prev || "");
  const b = String(curr || "");
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  if (i === 0) return 0;
  const cut = a.lastIndexOf("/", i - 1);
  return cut >= 0 ? cut + 1 : 0;
}

/**
 * Legacy column compression: repeated directory prefixes → spaces.
 *
 *   dosprograms/games/ancient-art-of-war/O1
 *                                        O0
 */
function compressPathSkeletonSpaces(paths) {
  const list = Array.isArray(paths) ? paths.map((p) => String(p).replace(/\\/g, "/")) : [];
  if (list.length === 0) return [];
  const out = [];
  let prev = "";
  for (const raw of list) {
    const p = raw.replace(/\/+/g, "/").replace(/^\//, "");
    if (!prev) {
      out.push(p);
      prev = p;
      continue;
    }
    const cut = commonDirPrefixLength(prev, p);
    if (cut <= 0) {
      out.push(p);
    } else {
      out.push(" ".repeat(cut) + p.slice(cut));
    }
    prev = p;
  }
  return out;
}

function normalizeSkeletonPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "");
}

/**
 * Build parent → child-name map from a flat find path list.
 * @returns {Map<string, Set<string>>} key "" = roots; otherwise full parent path
 */
function buildPathChildrenMap(paths) {
  const children = new Map();
  const ensure = (key) => {
    const k = key == null ? "" : key;
    if (!children.has(k)) children.set(k, new Set());
    return children.get(k);
  };
  for (const raw of paths) {
    const p = normalizeSkeletonPath(raw);
    if (!p) continue;
    const parts = p.split("/").filter(Boolean);
    let parent = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      ensure(parent).add(name);
      parent = parent ? `${parent}/${name}` : name;
    }
  }
  return children;
}

function formatBraceGroup(parent, names) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return null;
  const body = sorted.length === 1 ? sorted[0] : `{${sorted.join(",")}}`;
  if (!parent) return body;
  return `${parent}/${body}`;
}

/**
 * Compress a find listing by grouping sibling names:
 *
 *   dosprograms/games/ancient-art-of-war/{O0,O1,O7}
 *   dosprograms/cd/Afterlife/{AFTERLIFE.cue,AFTERLIFE.img}
 *
 * Directories with children are emitted recursively; leaf siblings share one brace line.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
function compressPathSkeletonBrace(paths) {
  const children = buildPathChildrenMap(paths);
  if (children.size === 0) return [];

  const lines = [];

  function emit(parent) {
    const kids = children.get(parent);
    if (!kids || kids.size === 0) return;

    const leaves = [];
    const branches = [];
    for (const name of [...kids].sort((a, b) => a.localeCompare(b))) {
      const full = parent ? `${parent}/${name}` : name;
      if (children.has(full) && children.get(full).size > 0) {
        branches.push({ name, full });
      } else {
        leaves.push(name);
      }
    }

    if (leaves.length) {
      const line = formatBraceGroup(parent, leaves);
      if (line) lines.push(line);
    }
    for (const { full } of branches) {
      emit(full);
    }
  }

  emit("");
  return lines;
}

/**
 * Default skeleton compression: brace groups (token-efficient, keeps internal files).
 */
function compressPathSkeleton(paths) {
  return compressPathSkeletonBrace(paths);
}

/**
 * Expand a space-compressed skeleton line using the previous full path.
 */
function expandCompressedLine(line, previousFullPath) {
  const raw = String(line ?? "");
  if (!raw) return previousFullPath || "";
  let i = 0;
  while (i < raw.length && raw[i] === " ") i += 1;
  if (i === 0) return raw;
  const prev = String(previousFullPath || "");
  if (i > prev.length) return raw.trim();
  return prev.slice(0, i) + raw.slice(i);
}

function expandCompressedSkeleton(lines) {
  const out = [];
  let prev = "";
  for (const line of lines) {
    const full = expandCompressedLine(line, prev);
    out.push(full);
    prev = full;
  }
  return out;
}

/**
 * Expand brace lines back to individual paths (best-effort; used in tests / retries).
 *   parent/{a,b} → parent/a, parent/b
 *   parent/x → parent/x
 */
function expandBraceSkeleton(lines) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const m = line.match(/^(.*)\/\{([^}]*)\}$/);
    if (m) {
      const parent = m[1];
      const names = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        out.push(parent ? `${parent}/${name}` : name);
      }
      continue;
    }
    // root-only brace: {a,b}
    const rootBrace = line.match(/^\{([^}]*)\}$/);
    if (rootBrace) {
      for (const name of rootBrace[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        out.push(name);
      }
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Chunk skeleton lines under maxChars. Brace lines are independent (no space prefix).
 */
function chunkCompressedSkeleton(compressedLines, maxChars) {
  const lines = Array.isArray(compressedLines)
    ? compressedLines.map((l) => String(l)).filter((l) => l.length > 0)
    : [];
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;
  if (!limit || lines.length === 0) {
    return lines.length ? [lines.join("\n")] : [];
  }

  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    // Oversized single line: still emit alone (caller / model may 413-split).
    const addLen = line.length + (current.length ? 1 : 0);
    if (current.length > 0 && currentLen + addLen > limit) {
      chunks.push(current.join("\n"));
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += addLen;
    }
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

/**
 * Map a skeleton-relative path (dosprograms/games/X) back to an absolute filesystem path.
 */
function skeletonPathToAbsolute(rootPath, skeletonPath) {
  const root = path.resolve(String(rootPath || ""));
  const rootName = path.basename(root);
  let rel = String(skeletonPath || "").replace(/\\/g, "/").replace(/^\//, "");
  // Strip accidental brace leftovers.
  rel = rel.replace(/\{|\}/g, "");
  if (rel === rootName) return root;
  const prefix = `${rootName}/`;
  if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);
  else if (rel.startsWith(rootName)) rel = rel.slice(rootName.length).replace(/^\//, "");
  return path.join(root, rel);
}

/**
 * Build compressed find skeleton text for a chosen folder (brace groups by default).
 */
function buildCompressedFindSkeleton(rootPath, options = {}) {
  const listed = listFindPaths(rootPath, options);
  const mode = String(options.mode || "brace").toLowerCase();
  const compressed =
    mode === "spaces"
      ? compressPathSkeletonSpaces(listed.paths)
      : compressPathSkeletonBrace(listed.paths);
  const text = compressed.join("\n");
  const chunks = chunkCompressedSkeleton(compressed, options.maxChars);
  return {
    rootPath: listed.rootPath,
    rootName: listed.rootName,
    pathCount: listed.paths.length,
    paths: listed.paths,
    compressed,
    text,
    chunks,
    mode: mode === "spaces" ? "spaces" : "brace",
  };
}

module.exports = {
  listFindPaths,
  compressPathSkeleton,
  compressPathSkeletonBrace,
  compressPathSkeletonSpaces,
  expandCompressedLine,
  expandCompressedSkeleton,
  expandBraceSkeleton,
  chunkCompressedSkeleton,
  skeletonPathToAbsolute,
  buildCompressedFindSkeleton,
  commonDirPrefixLength,
  buildPathChildrenMap,
};
