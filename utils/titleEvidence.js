"use strict";

const fs = require("fs");
const path = require("path");

/** Small text sidecars that often carry the retail / TOSEC name. */
const EVIDENCE_FILE_RE =
  /^(file_id\.diz|readme(\.txt|\.1st|\.doc)?|read\.me|.*\.nfo|game\.nfo|title\.txt)$/i;

const EVIDENCE_EXT_RE = /\.(diz|nfo|txt)$/i;

/** Max bytes read per evidence file. */
const DEFAULT_FILE_BYTES = 800;
/** Soft cap for all evidence lines attached to one AI chunk. */
const DEFAULT_CHUNK_EVIDENCE_CHARS = 1600;

function isEvidenceFileName(name) {
  const base = String(name || "");
  if (EVIDENCE_FILE_RE.test(base)) return true;
  if (EVIDENCE_EXT_RE.test(base) && /file_id|readme|read\.me|\.nfo$/i.test(base)) {
    return true;
  }
  return false;
}

function cleanEvidenceText(raw, maxChars = DEFAULT_FILE_BYTES) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, maxChars)
    .trim();
}

/**
 * Read ISO 9660 Primary Volume Descriptor fields (sector 16).
 * Useful when the dump is only `AI130.iso` with no sidecar text.
 *
 * @returns {{ volumeId?: string, publisher?: string, preparer?: string, application?: string, copyright?: string } | null}
 */
function readIso9660VolumeHints(isoPath) {
  const file = path.resolve(String(isoPath || ""));
  if (!file || !fs.existsSync(file)) return null;
  let fd;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 17 * 2048) return null;
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(2048);
    const read = fs.readSync(fd, buf, 0, 2048, 16 * 2048);
    if (read < 2048) return null;
    if (buf[0] !== 1) return null;
    if (buf.slice(1, 6).toString("ascii") !== "CD001") return null;

    const field = (start, end) =>
      buf
        .slice(start, end)
        .toString("ascii")
        .replace(/\0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const volumeId = field(40, 72);
    const publisher = field(318, 446);
    const preparer = field(446, 574);
    const application = field(574, 702);
    const copyright = field(702, 739);
    if (!volumeId && !application && !publisher && !copyright) return null;
    return { volumeId, publisher, preparer, application, copyright };
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function formatIsoHints(hints) {
  if (!hints || typeof hints !== "object") return "";
  const parts = [];
  if (hints.application) parts.push(`application:${hints.application}`);
  if (hints.volumeId) parts.push(`volume:${hints.volumeId}`);
  if (hints.publisher) parts.push(`publisher:${hints.publisher}`);
  if (hints.copyright) parts.push(`copyright:${hints.copyright}`);
  if (hints.preparer) parts.push(`preparer:${hints.preparer}`);
  return parts.join(" | ");
}

/**
 * Collect retail-title hints for one folder or ISO file.
 *
 * @param {string} absPath
 * @param {{ maxFileBytes?: number, maxFiles?: number }} [options]
 * @returns {{ path: string, hints: Array<{ source: string, text: string }> }}
 */
function collectTitleEvidence(absPath, options = {}) {
  const target = path.resolve(String(absPath || ""));
  const maxFileBytes = Number.isFinite(options.maxFileBytes)
    ? Math.max(100, Math.floor(options.maxFileBytes))
    : DEFAULT_FILE_BYTES;
  const maxFiles = Number.isFinite(options.maxFiles)
    ? Math.max(1, Math.floor(options.maxFiles))
    : 6;
  const hints = [];

  if (!target || !fs.existsSync(target)) {
    return { path: target, hints };
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return { path: target, hints };
  }

  if (stat.isFile()) {
    if (/\.iso$/i.test(target)) {
      const text = formatIsoHints(readIso9660VolumeHints(target));
      if (text) hints.push({ source: path.basename(target), text });
    } else if (isEvidenceFileName(path.basename(target))) {
      try {
        const raw = fs.readFileSync(target, {
          encoding: "utf8",
          flag: "r",
        });
        const text = cleanEvidenceText(raw, maxFileBytes);
        if (text) hints.push({ source: path.basename(target), text });
      } catch {
        // ignore unreadable
      }
    }
    return { path: target, hints };
  }

  if (!stat.isDirectory()) return { path: target, hints };

  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return { path: target, hints };
  }

  const files = entries
    .filter((ent) => ent.isFile() || ent.isSymbolicLink())
    .map((ent) => ent.name)
    .sort((a, b) => {
      const score = (name) => {
        const lower = name.toLowerCase();
        if (lower === "file_id.diz") return 0;
        if (lower.endsWith(".nfo")) return 1;
        if (lower.startsWith("readme") || lower === "read.me") return 2;
        return 3;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });

  for (const name of files) {
    if (hints.length >= maxFiles) break;
    if (!isEvidenceFileName(name)) continue;
    const full = path.join(target, name);
    try {
      const raw = fs.readFileSync(full, { encoding: "utf8", flag: "r" });
      const text = cleanEvidenceText(raw, maxFileBytes);
      if (text) hints.push({ source: name, text });
    } catch {
      // ignore
    }
  }

  // Shallow ISO in the same folder (unpacked install + disc image).
  if (hints.length < maxFiles) {
    for (const name of files) {
      if (hints.length >= maxFiles) break;
      if (!/\.iso$/i.test(name)) continue;
      const text = formatIsoHints(readIso9660VolumeHints(path.join(target, name)));
      if (text) hints.push({ source: name, text });
    }
  }

  return { path: target, hints };
}

function stripListingPrefix(relPath, listingPrefix) {
  const raw = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = String(listingPrefix || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (prefix && (raw === prefix || raw.startsWith(`${prefix}/`))) {
    return raw === prefix ? "" : raw.slice(prefix.length + 1);
  }
  return raw;
}

/**
 * True when a find-path leaf is visible in a nested/brace skeleton chunk.
 */
function isRelPathVisibleInChunk(chunkText, relFromRoot) {
  const chunk = String(chunkText || "");
  if (!chunk || !relFromRoot) return false;
  const parts = String(relFromRoot)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.length === 0) return false;
  const base = parts[parts.length - 1];
  if (!chunk.includes(base)) return false;
  // Require a parent folder token when nested (avoids random cross-chunk hits).
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2];
    if (parent && !chunk.includes(parent)) return false;
  }
  return true;
}

/**
 * Build a compact Title evidence block for paths mentioned in one skeleton chunk.
 *
 * @param {string} rootPath
 * @param {string} chunkText
 * @param {string[]} findPaths listing paths (with basename prefix)
 * @param {{ listingPrefix?: string, maxChars?: number, maxFileBytes?: number }} [options]
 * @returns {string} empty or multi-line evidence section (without heading)
 */
function collectChunkTitleEvidence(rootPath, chunkText, findPaths, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const listingPrefix =
    options.listingPrefix || (root ? path.basename(root) : "");
  const maxChars = Number.isFinite(options.maxChars)
    ? Math.max(200, Math.floor(options.maxChars))
    : DEFAULT_CHUNK_EVIDENCE_CHARS;
  const list = Array.isArray(findPaths) ? findPaths : [];
  const lines = [];
  let used = 0;
  const seen = new Set();

  for (const raw of list) {
    if (used >= maxChars) break;
    const fullRel = String(raw || "").replace(/\\/g, "/");
    const rel = stripListingPrefix(fullRel, listingPrefix);
    if (!rel) continue;
    const base = path.basename(rel);
    const isIso = /\.iso$/i.test(base);
    if (!isEvidenceFileName(base) && !isIso) continue;
    if (!isRelPathVisibleInChunk(chunkText, rel) && !isRelPathVisibleInChunk(chunkText, fullRel)) {
      continue;
    }

    const abs = path.join(root, rel);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const collected = collectTitleEvidence(abs, {
      maxFileBytes: options.maxFileBytes,
      maxFiles: isIso ? 1 : 4,
    });
    for (const hint of collected.hints) {
      const gameRel = isIso ? rel : path.dirname(rel).replace(/\\/g, "/");
      const line = `${gameRel || rel}: ${hint.source}: ${hint.text}`;
      if (!line.trim()) continue;
      if (used + line.length + 1 > maxChars && lines.length > 0) return lines.join("\n");
      lines.push(line);
      used += line.length + 1;
    }
  }

  return lines.join("\n");
}

/**
 * Prefer a game-root folder over nested files / ISO-only leaves when titles match.
 */
function preferGameIdentity(a, b) {
  const score = (g) => {
    const p = String(g?.path || "").replace(/\\/g, "/");
    const conf = Number(g?.confidence) || 0;
    const depth = p.split("/").filter(Boolean).length;
    const isFile = /\.[a-z0-9]{2,4}$/i.test(path.basename(p));
    // Prefer higher confidence, then shallower path, then directories over files.
    return conf * 10 - depth - (isFile ? 0.5 : 0);
  };
  return score(a) >= score(b) ? a : b;
}

/**
 * Collapse AI rows that share a normalized retail title (ISO + unpacked, nested leaves).
 * Keeps alternatePaths for attach/debug. Does not call IGDB.
 *
 * @param {Array<object>} games
 * @param {(title: string) => string} normalizeTitleKey
 */
function mergeGamesByTitleKey(games, normalizeTitleKey) {
  const normalize =
    typeof normalizeTitleKey === "function"
      ? normalizeTitleKey
      : // Keep in sync with folderGameImport.normalizeTitleKey fallback shape.
        require("./folderGameImport").normalizeTitleKey;
  const byKey = new Map();
  const order = [];

  for (const game of Array.isArray(games) ? games : []) {
    if (!game || !game.title || !game.path) continue;
    const key = normalize(game.title);
    if (!key) {
      order.push({ ...game, alternatePaths: [] });
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      const row = { ...game, alternatePaths: [] };
      byKey.set(key, row);
      order.push(row);
      continue;
    }
    const winner = preferGameIdentity(prev, game);
    const loser = winner === prev ? game : prev;
    const alternatePaths = [
      ...(prev.alternatePaths || []),
      String(loser.path),
    ].filter((p, i, arr) => p && p !== winner.path && arr.indexOf(p) === i);
    const merged = {
      ...winner,
      alternatePaths,
      year: winner.year ?? loser.year ?? null,
      platform: winner.platform || loser.platform || null,
      confidence: Math.max(Number(winner.confidence) || 0, Number(loser.confidence) || 0),
    };
    byKey.set(key, merged);
    const idx = order.indexOf(prev);
    if (idx >= 0) order[idx] = merged;
  }

  return order.filter((g) => g && g.path && g.title);
}

module.exports = {
  EVIDENCE_FILE_RE,
  DEFAULT_FILE_BYTES,
  DEFAULT_CHUNK_EVIDENCE_CHARS,
  isEvidenceFileName,
  cleanEvidenceText,
  readIso9660VolumeHints,
  formatIsoHints,
  collectTitleEvidence,
  collectChunkTitleEvidence,
  isRelPathVisibleInChunk,
  preferGameIdentity,
  mergeGamesByTitleKey,
  stripListingPrefix,
};
