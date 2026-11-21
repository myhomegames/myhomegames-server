"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Absolute import root as a skeleton path prefix (POSIX slashes, no leading `/`).
 * Keeps parent folders (e.g. …/dreamcast/scripts) so the AI sees platform context.
 *
 *   /Volumes/Elements/Dropbox/xmame/software/dreamcast/scripts
 *     → Volumes/Elements/Dropbox/xmame/software/dreamcast/scripts
 *   C:\Games\dosprograms → C:/Games/dosprograms
 */
function skeletonPrefixForRoot(rootPath) {
  return path
    .resolve(String(rootPath || "").trim())
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .replace(/^\//, "");
}

/** Voice/speech pack folders — keep as evidence, do not expand every clip. */
const ASSET_PACK_DIR_NAMES = new Set(["talk", "speech", "voice", "voices", "vocals", "voc"]);

/** Wing Commander-style voice clips and similar non-game leaves. */
const ASSET_LEAF_EXT_RE = /\.p\d{2}$/i;

/** Audio / cutscene / driver blobs that rarely help retail naming. */
const BULK_MEDIA_EXT_RE =
  /\.(wav|dig|voc|yop|mid|rmi|xmi|cms|cmp|xa|raw|pcm|vab|vh|vb|smp|snd|voc|iff|lbm|pic|anm)$/i;

/** Launch / disc signals — do not compact a tree that contains these. */
const LAUNCH_OR_DISC_EXT_RE = /\.(exe|com|bat|cmd|iso|cue|chd|sh|conf)$/i;

function isAssetPackDirName(name) {
  return ASSET_PACK_DIR_NAMES.has(String(name || "").toLowerCase());
}

function isAssetLeafName(name) {
  return ASSET_LEAF_EXT_RE.test(String(name || ""));
}

function isBulkMediaLeafName(name) {
  const base = String(name || "");
  return isAssetLeafName(base) || BULK_MEDIA_EXT_RE.test(base);
}

/**
 * If a subdirectory tree has no launchers/discs and is mostly media blobs,
 * return file count so the listing can keep a single `...(N assets)` marker.
 * Saves tokens without removing parent game folders that still have EXE/BAT.
 *
 * @returns {number|null}
 */
function countBulkMediaOnlyTree(absDir, options = {}) {
  const minFiles = Number.isFinite(options.minFiles) ? Math.max(4, options.minFiles) : 12;
  const mediaRatio = Number.isFinite(options.mediaRatio) ? options.mediaRatio : 0.65;
  const visitLimit = Number.isFinite(options.visitLimit) ? options.visitLimit : 8000;
  let files = 0;
  let media = 0;
  let launchers = 0;
  let visited = 0;
  const stack = [absDir];

  while (stack.length && visited < visitLimit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      visited += 1;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (isAssetPackDirName(ent.name)) {
          const n = countFilesRecursive(full);
          files += n;
          media += n;
        } else {
          stack.push(full);
        }
        continue;
      }
      if (!(ent.isFile() || ent.isSymbolicLink())) continue;
      files += 1;
      if (LAUNCH_OR_DISC_EXT_RE.test(ent.name)) launchers += 1;
      else if (isBulkMediaLeafName(ent.name)) media += 1;
    }
  }

  if (launchers > 0) return null;
  if (files < minFiles) return null;
  if (files > 0 && media / files < mediaRatio) return null;
  return files;
}

/**
 * True when a skeleton/AI path points at a non-game asset (voice clip, TALK leaf, …).
 * Parent install folders (winginstall) stay valid game paths.
 */
function isNonGameAssetPath(skeletonPath) {
  const rel = String(skeletonPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!rel) return false;
  const parts = rel.split("/").filter(Boolean);
  const base = parts[parts.length - 1] || "";
  if (isAssetLeafName(base)) return true;
  if (/^\.\.\.\(\d+\s+assets?\)$/i.test(base)) return true;
  // Path inside a voice pack folder (…/TALK/… or …/SPEECH/file).
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (isAssetPackDirName(parts[i])) return true;
  }
  return false;
}

/** Count files under a directory (for compact asset markers). */
function countFilesRecursive(absDir, limit = 50000) {
  let n = 0;
  const stack = [absDir];
  while (stack.length && n < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() || ent.isSymbolicLink()) n += 1;
    }
  }
  return n;
}

/**
 * Chunk is only voice/asset evidence (no BAT/EXE/ISO/… signals).
 * Used to skip identify / avoid empty-split into Hello/DStar phantoms.
 */
function isAssetEvidenceOnlyChunk(chunkText) {
  const text = String(chunkText || "");
  if (!text.trim()) return false;
  const assetLeaves = (text.match(/[^,{}\s/]+\.p\d{2}\b/gi) || []).length;
  const assetMarkers = (text.match(/\.\.\.\(\d+\s+assets?\)/gi) || []).length;
  const hasTalk = /(?:^|[/{,])(?:talk|speech|voice|voices|vocals|voc)\{/i.test(text);
  if (assetLeaves === 0 && assetMarkers === 0 && !hasTalk) return false;
  const gameSignals = (
    text.match(/\.(bat|exe|com|sh|iso|cue|img|ima|gog|zip|conf|d64|bin|ccd|mdf)\b/gi) || []
  ).length;
  if (gameSignals > 0) return false;
  return true;
}

/**
 * List paths like `find <root>` (root + every dir/file), sorted depth-first as walk order
 * with names sorted per directory. Listing paths stay short (chosen-folder basename +
 * relatives) so AI prompts stay small. The full absolute path is returned separately as
 * `rootName` for prompt context only (e.g. …/dreamcast/scripts → platform hint).
 *
 * Voice/speech packs (TALK, …) stay as a single folder + `...(N assets)` marker so the AI
 * still sees evidence without exploding into identify-able clip leaves.
 *
 * @param {string} rootPath absolute folder chosen by the user
 * @returns {{ rootPath: string, rootName: string, listingPrefix: string, paths: string[] }}
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

  // Short listing prefix (keeps skeleton compact). Full path only in rootName for the AI.
  const listingPrefix = path.basename(root);
  const rootName = skeletonPrefixForRoot(root);
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 0;
  const paths = [listingPrefix];

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
      paths.push(`${listingPrefix}/${rel}`);
      // Keep pack as evidence under the parent game; do not list every clip.
      if (isAssetPackDirName(ent.name)) {
        const n = countFilesRecursive(path.join(absDir, ent.name));
        if (n > 0 && (maxEntries <= 0 || paths.length < maxEntries)) {
          paths.push(`${listingPrefix}/${rel}/...(${n} assets)`);
        }
        continue;
      }
      // Compact WAV/DIG/YOP-only trees (e.g. COLC/LANGE) — titles come from
      // file_id.diz / ISO PVD evidence, not from hundreds of media basenames.
      if (options.compactBulkMedia !== false) {
        const bulkCount = countBulkMediaOnlyTree(path.join(absDir, ent.name));
        if (bulkCount != null) {
          if (maxEntries <= 0 || paths.length < maxEntries) {
            paths.push(`${listingPrefix}/${rel}/...(${bulkCount} assets)`);
          }
          continue;
        }
      }
      walk(path.join(absDir, ent.name), rel);
    }
    for (const ent of files) {
      if (maxEntries > 0 && paths.length >= maxEntries) return;
      // Stray voice clips outside pack dirs still skip as individual listing leaves.
      if (isAssetLeafName(ent.name)) continue;
      const rel = relFromRoot ? `${relFromRoot}/${ent.name}` : ent.name;
      paths.push(`${listingPrefix}/${rel}`);
    }
  }

  walk(root, "");
  return { rootPath: root, rootName, listingPrefix, paths };
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
 * Compress a find listing by grouping sibling names (flat lines):
 *
 *   dosprograms/games/ancient-art-of-war/{O0,O1,O7}
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
 * Build a nested tree from find paths. Directories are objects; leaf files are null.
 */
function buildNestedTreeFromPaths(paths) {
  const root = {};
  for (const raw of Array.isArray(paths) ? paths : []) {
    const p = normalizeSkeletonPath(raw);
    if (!p) continue;
    const parts = p.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const last = i === parts.length - 1;
      if (!last) {
        if (node[name] == null || node[name] === null) node[name] = {};
        node = node[name];
      } else if (node[name] === undefined) {
        node[name] = null;
      }
      // if already an object, keep directory
    }
  }
  return root;
}

/**
 * Format one nested node: name{child,dir{...},fileA,fileB}
 */
function formatNestedBraceNode(node, name) {
  if (node == null || typeof node !== "object") {
    return name || "";
  }
  const keys = Object.keys(node).sort((a, b) => a.localeCompare(b));
  const leafFiles = [];
  const dirs = [];
  for (const key of keys) {
    if (node[key] === null) leafFiles.push(key);
    else dirs.push(key);
  }
  const parts = [];
  if (leafFiles.length) parts.push(leafFiles.join(","));
  for (const dir of dirs) {
    parts.push(formatNestedBraceNode(node[dir], dir));
  }
  const body = `{${parts.join(",")}}`;
  return name ? `${name}${body}` : body;
}

/**
 * Nested brace compression (default):
 *
 *   dosprograms{games{night-shift{night{BEAST_1.CMP,...}},midnightresque{CLOSE.GRA,...}}}
 *
 * @returns {string[]} single-element array with the nested string (or [] if empty)
 */
function compressPathSkeletonNested(paths) {
  const tree = buildNestedTreeFromPaths(paths);
  const roots = Object.keys(tree).sort((a, b) => a.localeCompare(b));
  if (roots.length === 0) return [];
  if (roots.length === 1) {
    return [formatNestedBraceNode(tree[roots[0]], roots[0])];
  }
  return [formatNestedBraceNode(tree, "")];
}

const LAUNCH_SCRIPT_LEAF_RE = /\.(sh|bat)$/i;

function isLaunchScriptLeafName(name) {
  return LAUNCH_SCRIPT_LEAF_RE.test(String(name || ""));
}

/**
 * True when a tree node is mostly flat launch-script siblings (.sh/.bat).
 * Name-agnostic: works for scripts/, launchers/, bins/, etc.
 * False for deep trees like dosprograms/{games,cd,…} so char-based chunking stays.
 */
function isFlatLaunchCandidateTree(node, options = {}) {
  if (!node || typeof node !== "object") return false;
  const minScripts = Number.isFinite(options.minScripts) ? Math.max(2, options.minScripts) : 10;
  const keys = Object.keys(node);
  if (keys.length < minScripts) return false;
  let scriptLeaves = 0;
  let otherLeaves = 0;
  let dirs = 0;
  for (const key of keys) {
    const value = node[key];
    if (value === null) {
      if (isLaunchScriptLeafName(key)) scriptLeaves += 1;
      else otherLeaves += 1;
    } else if (value && typeof value === "object") {
      dirs += 1;
    }
  }
  const total = scriptLeaves + otherLeaves + dirs;
  if (total === 0 || scriptLeaves < minScripts) return false;
  // ≥80% launch scripts, ≤10% nested dirs (allow .DS_Store and a stray folder).
  return scriptLeaves / total >= 0.8 && dirs / total <= 0.1;
}

/**
 * Split a flat launch-script tree into sibling batches so each AI call can
 * return one JSON row per script without blowing max_tokens.
 */
function chunkFlatLaunchSiblings(rootNode, label, maxPerChunk) {
  const limit =
    Number.isFinite(maxPerChunk) && maxPerChunk > 0 ? Math.floor(maxPerChunk) : 20;
  const childKeys = Object.keys(rootNode || {}).sort((a, b) => a.localeCompare(b));
  if (childKeys.length === 0) return [];
  const chunks = [];
  let batch = {};
  let batchCount = 0;
  const flush = () => {
    if (batchCount === 0) return;
    chunks.push(formatNestedBraceNode(batch, label));
    batch = {};
    batchCount = 0;
  };
  for (const key of childKeys) {
    if (batchCount >= limit) flush();
    batch[key] = rootNode[key];
    batchCount += 1;
  }
  flush();
  return chunks.length ? chunks : [formatNestedBraceNode(rootNode, label)].filter(Boolean);
}

/**
 * Split a nested tree into chunks under maxChars by grouping sibling subtrees.
 * Each chunk is a valid nested string rooted at `rootName` (or the shared parent path).
 */
function chunkNestedSkeleton(tree, rootName, maxChars) {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;
  const rootNode =
    rootName && tree && typeof tree[rootName] === "object" && tree[rootName] !== null
      ? tree[rootName]
      : tree;
  const label = rootName || "";
  const full = formatNestedBraceNode(rootNode, label);
  if (!full) return [];
  if (!limit || full.length <= limit) return [full];

  const childKeys = Object.keys(rootNode || {}).sort((a, b) => a.localeCompare(b));
  if (childKeys.length === 0) return [full];

  const chunks = [];
  let batch = {};
  let batchCount = 0;

  const flush = () => {
    if (batchCount === 0) return;
    chunks.push(formatNestedBraceNode(batch, label));
    batch = {};
    batchCount = 0;
  };

  for (const key of childKeys) {
    const value = rootNode[key];
    const aloneTree = { [key]: value };
    const alone = formatNestedBraceNode(aloneTree, label);

    if (alone.length > limit && value && typeof value === "object") {
      flush();
      // Split oversized child: produce key{...} chunks, then wrap as rootName{key{...}}.
      const innerLimit = Math.max(500, limit - (label ? label.length + 2 : 0));
      const innerChunks = chunkNestedSkeleton({ [key]: value }, key, innerLimit);
      for (const inner of innerChunks) {
        chunks.push(label ? `${label}{${inner}}` : inner);
      }
      continue;
    }

    const trial = { ...batch, [key]: value };
    const trialText = formatNestedBraceNode(trial, label);
    if (batchCount > 0 && trialText.length > limit) {
      flush();
    }
    batch[key] = value;
    batchCount += 1;
    if (formatNestedBraceNode(batch, label).length > limit && batchCount > 1) {
      delete batch[key];
      batchCount -= 1;
      flush();
      batch[key] = value;
      batchCount = 1;
    }
  }
  flush();
  return chunks.length ? chunks : [full];
}

/**
 * Split a comma-separated nested-brace body on top-level commas only
 * (commas inside `{…}` stay with their sibling).
 */
function splitTopLevelCommaParts(body) {
  const text = String(body ?? "");
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.filter((p) => p.length > 0);
}

/**
 * Binary-split one nested brace chunk (typically a single line) into two smaller
 * rooted chunks by dividing top-level siblings. Recurses into a lone child when
 * needed. Returns null when the chunk cannot be split further.
 */
function splitNestedBraceInHalf(chunkText) {
  const text = String(chunkText || "").trim();
  const open = text.indexOf("{");
  if (open <= 0 || !text.endsWith("}")) return null;
  const name = text.slice(0, open);
  const body = text.slice(open + 1, -1);
  const parts = splitTopLevelCommaParts(body);
  if (parts.length >= 2) {
    const mid = Math.ceil(parts.length / 2);
    return [
      `${name}{${parts.slice(0, mid).join(",")}}`,
      `${name}{${parts.slice(mid).join(",")}}`,
    ];
  }
  if (parts.length === 1) {
    const child = parts[0];
    const childOpen = child.indexOf("{");
    if (childOpen > 0 && child.endsWith("}")) {
      const halves = splitNestedBraceInHalf(child);
      if (halves && halves.length === 2) {
        return [`${name}{${halves[0]}}`, `${name}{${halves[1]}}`];
      }
    }
  }
  return null;
}

/**
 * Split an oversized skeleton chunk for 413 retries: multi-line → half by lines;
 * nested one-liner → half by top-level siblings.
 */
function splitOversizedSkeletonChunk(chunkText) {
  const text = String(chunkText || "").trim();
  if (!text) return [];
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length > 1) {
    const mid = Math.ceil(lines.length / 2);
    return [lines.slice(0, mid).join("\n"), lines.slice(mid).join("\n")];
  }
  return splitNestedBraceInHalf(text) || [];
}

/**
 * Default skeleton compression: nested a{b{c{…}}} (most token-efficient).
 */
function compressPathSkeleton(paths) {
  return compressPathSkeletonNested(paths);
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
 * Strip the import-root prefix from an AI/skeleton path.
 * Accepts full absolute-style prefixes and legacy basename-only prefixes.
 */
function stripSkeletonRootPrefix(rootPath, skeletonPath) {
  const root = path.resolve(String(rootPath || ""));
  const fullPrefix = skeletonPrefixForRoot(root);
  const shortPrefix = path.basename(root);
  let rel = String(skeletonPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\{|\}/g, "")
    .trim();
  if (!rel || rel === ".") return "";

  const stripOne = (prefix) => {
    if (!prefix) return null;
    if (rel === prefix) return "";
    const withSlash = `${prefix}/`;
    if (rel.startsWith(withSlash)) return rel.slice(withSlash.length);
    return null;
  };

  for (const prefix of [fullPrefix, shortPrefix]) {
    const stripped = stripOne(prefix);
    if (stripped != null) return stripped;
  }
  return rel;
}

/**
 * Map a skeleton path (full absolute-style or legacy basename-relative) back to FS.
 */
function skeletonPathToAbsolute(rootPath, skeletonPath) {
  const root = path.resolve(String(rootPath || ""));
  const rel = stripSkeletonRootPrefix(root, skeletonPath);
  return rel ? path.join(root, rel) : root;
}

/**
 * Normalize a skeleton path to be relative to the import root (no root prefix).
 */
function skeletonPathRelativeToRoot(rootPath, skeletonPath) {
  return stripSkeletonRootPrefix(rootPath, skeletonPath);
}

/**
 * Build basename → relative-path[] index from find listing paths
 * (`dosprograms/games/budokan-the-martial-spirit`, …).
 * Used to repair AI paths that drop parent segments (e.g. bare `budokan-the-martial-spirit`).
 */
function buildSkeletonBasenameIndex(findPaths, rootName) {
  const index = new Map();
  const root = String(rootName || "").trim();
  const prefix = root ? `${root}/` : "";
  for (const raw of Array.isArray(findPaths) ? findPaths : []) {
    let rel = String(raw || "").replace(/\\/g, "/");
    if (!rel) continue;
    if (prefix && rel.startsWith(prefix)) rel = rel.slice(prefix.length);
    else if (root && rel === root) continue;
    if (!rel) continue;
    const base = path.basename(rel);
    if (!base || base === "." || base === "..") continue;
    const key = base.toLowerCase();
    let list = index.get(key);
    if (!list) {
      list = [];
      index.set(key, list);
    }
    if (!list.includes(rel)) list.push(rel);
  }
  return index;
}

function pathExists(absPath) {
  try {
    return Boolean(absPath) && fs.existsSync(absPath);
  } catch {
    return false;
  }
}

function scoreSkeletonCandidate(rel, rootPath) {
  const abs = path.join(rootPath, rel);
  let isDir = false;
  try {
    isDir = fs.statSync(abs).isDirectory();
  } catch {
    return null;
  }
  const gamesBoost = /(^|\/)games(\/|$)/i.test(rel) ? 0 : 1;
  const cdBoost = /(^|\/)cd(\/|$)/i.test(rel) ? 1 : 2;
  return {
    rel,
    abs,
    isDir,
    gamesBoost,
    cdBoost,
    depth: rel.split("/").filter(Boolean).length,
  };
}

function pickBestSkeletonCandidate(rels, rootPath) {
  const scored = [];
  for (const rel of rels || []) {
    const item = scoreSkeletonCandidate(rel, rootPath);
    if (item) scored.push(item);
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (a.gamesBoost !== b.gamesBoost) return a.gamesBoost - b.gamesBoost;
    if (a.cdBoost !== b.cdBoost) return a.cdBoost - b.cdBoost;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.rel.localeCompare(b.rel);
  });
  return scored[0];
}

/**
 * Resolve an AI skeleton path to an existing filesystem location under root.
 * Repairs common model mistakes (dropped `games/` / `dosprograms/` prefixes) using
 * only local FS checks — no extra AI calls.
 *
 * @returns {{ absPath: string, path: string, repaired: boolean, missing: boolean }}
 */
function resolveSkeletonGamePath(rootPath, skeletonPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const relIn = skeletonPathRelativeToRoot(root, skeletonPath);
  const originalAbs = relIn ? path.join(root, relIn) : root;

  if (pathExists(originalAbs)) {
    return {
      absPath: originalAbs,
      path: relIn || path.basename(root),
      repaired: false,
      missing: false,
    };
  }

  const base = path.basename(relIn || String(skeletonPath || "").replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") {
    return {
      absPath: originalAbs,
      path: relIn || String(skeletonPath || ""),
      repaired: false,
      missing: true,
    };
  }

  const tried = new Set();
  const candidates = [];

  const pushCand = (rel) => {
    const normalized = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || tried.has(normalized)) return;
    tried.add(normalized);
    candidates.push(normalized);
  };

  // Common collection layouts under the import root.
  for (const prefix of ["games", "cd", "Games", "CD"]) {
    pushCand(`${prefix}/${base}`);
  }
  // Bare basename directly under root (already tried as relIn when it was bare).
  pushCand(base);

  const index = options.index instanceof Map ? options.index : null;
  if (index) {
    const fromIndex = index.get(base.toLowerCase()) || [];
    for (const rel of fromIndex) pushCand(rel);
  }

  const best = pickBestSkeletonCandidate(candidates, root);
  if (best) {
    return {
      absPath: best.abs,
      path: best.rel,
      repaired: best.rel !== relIn,
      missing: false,
    };
  }

  return {
    absPath: originalAbs,
    path: relIn || String(skeletonPath || ""),
    repaired: false,
    missing: true,
  };
}

/**
 * Build compressed find skeleton text for a chosen folder.
 * Default mode: nested `a{b{c{…}}}` (token-efficient, keeps internal files).
 */
function buildCompressedFindSkeleton(rootPath, options = {}) {
  const listed = listFindPaths(rootPath, options);
  const mode = String(options.mode || "nested").toLowerCase();

  let compressed;
  let chunks;
  if (mode === "spaces") {
    compressed = compressPathSkeletonSpaces(listed.paths);
    chunks = chunkCompressedSkeleton(compressed, options.maxChars);
  } else if (mode === "brace" || mode === "flat") {
    compressed = compressPathSkeletonBrace(listed.paths);
    chunks = chunkCompressedSkeleton(compressed, options.maxChars);
  } else {
    compressed = compressPathSkeletonNested(listed.paths);
    const tree = buildNestedTreeFromPaths(listed.paths);
    // Listing uses short basename prefix (folder name) as the tree root key.
    const rootNode =
      listed.listingPrefix &&
      tree &&
      typeof tree[listed.listingPrefix] === "object" &&
      tree[listed.listingPrefix] !== null
        ? tree[listed.listingPrefix]
        : tree;
    // Flat folders of .sh/.bat (any name) need small sibling batches for AI completion size.
    // Deep trees (dosprograms/games/…) keep char-based chunking only.
    const maxLaunchSiblings =
      Number.isFinite(options.maxLaunchScriptSiblings) && options.maxLaunchScriptSiblings > 0
        ? Math.floor(options.maxLaunchScriptSiblings)
        : 20;
    if (isFlatLaunchCandidateTree(rootNode)) {
      chunks = chunkFlatLaunchSiblings(rootNode, listed.listingPrefix, maxLaunchSiblings);
    } else {
      chunks = chunkNestedSkeleton(tree, listed.listingPrefix, options.maxChars);
    }
  }

  const text = compressed.join("\n");
  return {
    rootPath: listed.rootPath,
    // Full absolute path for AI prompt context only (not repeated on every listing line).
    rootName: listed.rootName,
    listingPrefix: listed.listingPrefix,
    pathCount: listed.paths.length,
    paths: listed.paths,
    compressed,
    text,
    chunks,
    mode: mode === "spaces" ? "spaces" : mode === "brace" || mode === "flat" ? "brace" : "nested",
  };
}

module.exports = {
  listFindPaths,
  skeletonPrefixForRoot,
  compressPathSkeleton,
  compressPathSkeletonBrace,
  compressPathSkeletonNested,
  compressPathSkeletonSpaces,
  buildNestedTreeFromPaths,
  formatNestedBraceNode,
  chunkNestedSkeleton,
  isFlatLaunchCandidateTree,
  isLaunchScriptLeafName,
  chunkFlatLaunchSiblings,
  isAssetPackDirName,
  isAssetLeafName,
  isBulkMediaLeafName,
  isNonGameAssetPath,
  isAssetEvidenceOnlyChunk,
  countBulkMediaOnlyTree,
  countFilesRecursive,
  splitTopLevelCommaParts,
  splitNestedBraceInHalf,
  splitOversizedSkeletonChunk,
  expandCompressedLine,
  expandCompressedSkeleton,
  expandBraceSkeleton,
  chunkCompressedSkeleton,
  skeletonPathToAbsolute,
  skeletonPathRelativeToRoot,
  stripSkeletonRootPrefix,
  buildSkeletonBasenameIndex,
  resolveSkeletonGamePath,
  buildCompressedFindSkeleton,
  commonDirPrefixLength,
  buildPathChildrenMap,
};
