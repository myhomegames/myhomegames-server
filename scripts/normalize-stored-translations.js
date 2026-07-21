#!/usr/bin/env node
/**
 * One-shot: apply normalizeTranslatedText to stored locale summaries and
 * keyword translations under a MyHomeGames data directory.
 *
 * Usage:
 *   node scripts/normalize-stored-translations.js [--path DIR] [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { normalizeTranslatedText } = require("../utils/googleTranslate");
const { readJsonFile, writeJsonFile } = require("../utils/fileUtils");

const CONTENT_TYPES = [
  "games",
  "collections",
  "companies",
  "series",
  "franchises",
  "platforms",
  "categories",
  "themes",
  "game-modes",
  "game-engines",
  "player-perspectives",
  "developers",
  "publishers",
  "recommended",
];

function defaultMetadataPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MyHomeGames");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "MyHomeGames");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdg, "MyHomeGames");
}

function parseArgs(argv) {
  let metadataPath = defaultMetadataPath();
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--path") {
      metadataPath = path.resolve(argv[++i] || "");
    } else if (arg.startsWith("--path=")) {
      metadataPath = path.resolve(arg.slice("--path=".length));
    }
  }
  return { metadataPath, dryRun };
}

function normalizeStringField(value) {
  if (typeof value !== "string") return { value, changed: false };
  const next = normalizeTranslatedText(value);
  return { value: next, changed: next !== value };
}

function normalizeSummary(summary) {
  if (typeof summary === "string") {
    const { value, changed } = normalizeStringField(summary);
    return { value, changed, fields: changed ? 1 : 0 };
  }
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return { value: summary, changed: false, fields: 0 };
  }
  let fields = 0;
  const next = { ...summary };
  for (const [lang, text] of Object.entries(summary)) {
    if (typeof text !== "string") continue;
    const normalized = normalizeTranslatedText(text);
    if (normalized !== text) {
      next[lang] = normalized;
      fields += 1;
    }
  }
  return { value: next, changed: fields > 0, fields };
}

function processMetadataFile(filePath, dryRun) {
  const meta = readJsonFile(filePath, null);
  if (!meta || typeof meta !== "object") return { updated: false, fields: 0 };

  if (!Object.prototype.hasOwnProperty.call(meta, "summary")) {
    return { updated: false, fields: 0 };
  }

  const { value, changed, fields } = normalizeSummary(meta.summary);
  if (!changed) return { updated: false, fields: 0 };
  meta.summary = value;
  if (!dryRun) writeJsonFile(filePath, meta);
  return { updated: true, fields };
}

function processKeywordStore(filePath, dryRun) {
  if (!fs.existsSync(filePath)) return { updated: false, fields: 0 };
  const store = readJsonFile(filePath, null);
  const entries = store?.entries;
  if (!entries || typeof entries !== "object") return { updated: false, fields: 0 };

  let fields = 0;
  let dirty = false;
  for (const entry of Object.values(entries)) {
    const translations = entry?.translations;
    if (!translations || typeof translations !== "object") continue;
    for (const [lang, text] of Object.entries(translations)) {
      if (typeof text !== "string") continue;
      const normalized = normalizeTranslatedText(text);
      if (normalized !== text) {
        translations[lang] = normalized;
        dirty = true;
        fields += 1;
      }
    }
  }

  if (!dirty) return { updated: false, fields: 0 };
  if (!dryRun) writeJsonFile(filePath, store);
  return { updated: true, fields };
}

function main() {
  const { metadataPath, dryRun } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(metadataPath)) {
    console.error(`Data directory not found: ${metadataPath}`);
    process.exit(1);
  }

  console.log(`${dryRun ? "[dry-run] " : ""}Normalizing translations in ${metadataPath}`);

  const contentRoot = path.join(metadataPath, "content");
  let filesUpdated = 0;
  let summaryFields = 0;

  for (const typeName of CONTENT_TYPES) {
    const typeDir = path.join(contentRoot, typeName);
    if (!fs.existsSync(typeDir)) continue;

    let typeUpdated = 0;
    let typeFields = 0;
    for (const idName of fs.readdirSync(typeDir)) {
      const metaPath = path.join(typeDir, idName, "metadata.json");
      if (!fs.existsSync(metaPath)) continue;
      const result = processMetadataFile(metaPath, dryRun);
      if (result.updated) {
        typeUpdated += 1;
        typeFields += result.fields;
      }
    }
    if (typeUpdated > 0) {
      console.log(`  ${typeName}: ${typeUpdated} files (${typeFields} locale fields touched)`);
      filesUpdated += typeUpdated;
      summaryFields += typeFields;
    }
  }

  const keywordsPath = path.join(metadataPath, "keyword-translations.json");
  const kw = processKeywordStore(keywordsPath, dryRun);
  if (kw.updated) {
    console.log(`  keyword-translations.json: ${kw.fields} fields`);
  }

  console.log(
    `Done: ${filesUpdated} metadata files, ${summaryFields} summary fields` +
      (kw.updated ? `, ${kw.fields} keyword fields` : "") +
      (dryRun ? " (dry-run, no writes)" : ""),
  );
}

main();
