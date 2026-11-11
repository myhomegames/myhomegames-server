"use strict";

const path = require("path");
const { isCloudflareTunnelEnabled } = require("./cloudflareTunnel");

const DEFAULT_MODEL = "gpt-4o-mini";
/** Small batches keep Groq free-tier TPM (~8k) and similar request caps happy. */
const DEFAULT_BATCH_SIZE = 4;
/** Max tree lines sent per candidate (folder name + key files). */
const DEFAULT_MAX_TREE_LINES = 12;
/**
 * Soft cap on user-prompt characters per request (~chars/4 ≈ tokens).
 * Leave headroom under common 8k TPM / request limits for system + completion.
 */
const DEFAULT_MAX_PROMPT_CHARS = 14000;

function readHeader(req, name) {
  if (!req) return "";
  if (typeof req.header === "function") return String(req.header(name) || "").trim();
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  const raw = headers[name] ?? headers[lower];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim();
}

/**
 * Headers injected by the Cloudflare Worker (never trust browser-supplied values alone
 * on public paths; the Worker strips spoofed headers before inject).
 */
function readOpenAiHeaders(req) {
  return {
    apiKey: readHeader(req, "X-OpenAI-Api-Key"),
    baseURL: readHeader(req, "X-OpenAI-Base-Url"),
    model: readHeader(req, "X-OpenAI-Model"),
    configuredFlag: readHeader(req, "X-MHG-Ai-Configured").toLowerCase(),
  };
}

/**
 * Resolve OpenAI-compatible credentials.
 * Tunnel enabled: only X-OpenAI-* headers from the API gateway (same pattern as Twitch).
 * Tunnel disabled: explicit options → request headers → OPENAI_* / MHG_AI_* env.
 */
function resolveAiIdentifyConfig(env = process.env, options = {}) {
  const header = readOpenAiHeaders(options.req);
  const tunnel = isCloudflareTunnelEnabled(env);

  let apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  let baseURL = typeof options.baseURL === "string" ? options.baseURL.trim() : "";
  let model = typeof options.model === "string" ? options.model.trim() : "";

  if (tunnel) {
    apiKey = apiKey || header.apiKey;
    baseURL = baseURL || header.baseURL;
    model = model || header.model;
  } else {
    apiKey =
      apiKey ||
      header.apiKey ||
      String(env.OPENAI_API_KEY || env.MHG_AI_API_KEY || "").trim();
    baseURL =
      baseURL ||
      header.baseURL ||
      String(env.OPENAI_BASE_URL || env.MHG_AI_BASE_URL || "").trim();
    model =
      model ||
      header.model ||
      String(env.OPENAI_MODEL || env.MHG_AI_MODEL || "").trim();
  }

  baseURL = baseURL || undefined;
  model = model || DEFAULT_MODEL;

  const enabledFlag = String(env.MHG_AI_GAME_IDENTIFY || "true").trim().toLowerCase();
  const enabled =
    options.enabled != null
      ? Boolean(options.enabled)
      : enabledFlag !== "false" && enabledFlag !== "0";

  const batchFromEnv = Number(env.MHG_AI_BATCH_SIZE);
  const batchSize = Number.isFinite(options.batchSize)
    ? options.batchSize
    : Number.isFinite(batchFromEnv) && batchFromEnv > 0
      ? Math.floor(batchFromEnv)
      : DEFAULT_BATCH_SIZE;

  const treeFromEnv = Number(env.MHG_AI_MAX_TREE_LINES);
  const maxTreeLines = Number.isFinite(options.maxTreeLines)
    ? options.maxTreeLines
    : Number.isFinite(treeFromEnv) && treeFromEnv > 0
      ? Math.floor(treeFromEnv)
      : DEFAULT_MAX_TREE_LINES;

  const charsFromEnv = Number(env.MHG_AI_MAX_PROMPT_CHARS);
  const maxPromptChars = Number.isFinite(options.maxPromptChars)
    ? options.maxPromptChars
    : Number.isFinite(charsFromEnv) && charsFromEnv > 1000
      ? Math.floor(charsFromEnv)
      : DEFAULT_MAX_PROMPT_CHARS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey: apiKey || null,
    baseURL,
    model,
    batchSize: Math.max(1, batchSize),
    maxTreeLines: Math.max(2, maxTreeLines),
    maxPromptChars: Math.max(2000, maxPromptChars),
    source: tunnel ? "gateway-headers" : apiKey ? "local" : "none",
  };
}

/**
 * Whether the Add Game "Import from folder" control should be shown.
 * Tunnel: Worker sets X-MHG-Ai-Configured (key never appears in JSON).
 * Local: OPENAI_API_KEY (or alias) present in env / headers.
 */
function isAiFolderImportEnabled(req, env = process.env) {
  if (isCloudflareTunnelEnabled(env)) {
    const flag = readHeader(req, "X-MHG-Ai-Configured").toLowerCase();
    if (flag === "true" || flag === "1") return true;
    if (flag === "false" || flag === "0") return false;
    // Fallback if /settings was not routed through the Worker yet.
    return Boolean(readHeader(req, "X-OpenAI-Api-Key"));
  }
  return Boolean(resolveAiIdentifyConfig(env, { req }).enabled);
}

function truncateTree(tree, maxLines) {
  const lines = Array.isArray(tree) ? tree.map((l) => String(l)) : [];
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `…(+${lines.length - (maxLines - 1)} more)`];
}

function buildIdentifyPrompt(batch, options = {}) {
  const maxTreeLines = Number.isFinite(options.maxTreeLines)
    ? options.maxTreeLines
    : DEFAULT_MAX_TREE_LINES;
  const blocks = batch.map((item, index) => {
    const folder =
      item.relativePath ||
      item.sourceName ||
      path.basename(item.folderPath || item.filePath || "");
    const rawTree =
      Array.isArray(item.tree) && item.tree.length > 0 ? item.tree : [String(folder)];
    const tree = truncateTree(rawTree, maxTreeLines);
    return [`${index}.`, ...tree.map((line) => `  ${line}`)].join("\n");
  });
  return [
    `Return ONLY a JSON array (no markdown) with one object per input index (${batch.length} items).`,
    'Each object: {"index":number,"isGame":boolean,"title":string,"year":number|null,"platform":string|null,"confidence":number}',
    '- title: official retail/IGDB name, Spaces + Title Case (e.g. "Alone in the Dark"). Never glued slugs (aloneinthedark), codes (AI130), or dump tags (DOS/CD/RIP/EN/ISO) in the title.',
    "- year: first release year when known, else null (used to filter catalog search).",
    '- platform: short catalog platform hint when clear (e.g. "DOS", "PC", "SNES", "Arcade"), else null.',
    "- isGame=false for tools/BIOS/setup/dosbox/mappers/installers (title may be empty).",
    "- confidence: 0..1 (use <0.55 when unsure).",
    'Examples: aloneinthedark→title "Alone in the Dark"; alien rampage dos rip→title "Alien Rampage", platform "DOS"; Fallout_1997→title "Fallout", year 1997.',
    "- Keep index aligned with the numbered list. Same commercial game → identical title string.",
    "",
    "Inputs:",
    ...blocks,
  ].join("\n");
}

/**
 * Pack candidates into batches that respect both count and prompt size limits.
 */
function packBatches(items, { batchSize, maxTreeLines, maxPromptChars }) {
  const batches = [];
  let current = [];
  for (const item of items) {
    const trial = [...current, item];
    const prompt = buildIdentifyPrompt(trial, { maxTreeLines });
    const overChars = prompt.length > maxPromptChars;
    const overCount = trial.length > batchSize;
    if (current.length > 0 && (overChars || overCount)) {
      batches.push(current);
      current = [item];
      // Single huge tree: still send alone (caller may truncate further on 413).
      continue;
    }
    current = trial;
  }
  if (current.length) batches.push(current);
  return batches;
}

function normalizeIdentifyRow(row, fallbackIndex) {
  if (row == null) return null;
  if (typeof row === "string") {
    const title = row.trim();
    if (!title) {
      return {
        index: fallbackIndex,
        isGame: false,
        title: null,
        year: null,
        platform: null,
        confidence: 0,
      };
    }
    return {
      index: fallbackIndex,
      isGame: true,
      title,
      year: null,
      platform: null,
      confidence: 0.8,
    };
  }
  if (typeof row !== "object") return null;
  const index = Number.isInteger(Number(row.index)) ? Number(row.index) : fallbackIndex;
  const title = String(row.title || "").trim();
  const isGame = row.isGame !== false && Boolean(title);
  const yearNum = Number(row.year);
  return {
    index,
    isGame,
    title: isGame ? title : null,
    year: Number.isFinite(yearNum) && yearNum >= 1970 && yearNum <= 2100 ? Math.floor(yearNum) : null,
    platform: row.platform != null ? String(row.platform).trim() || null : null,
    confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
  };
}

/**
 * Parse AI response as a JSON array of identify objects (aligned by index).
 * Also accepts a legacy titles-only string array.
 */
function parseIdentifyResponse(rawText, batchLength) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  let jsonText = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1].trim();
  const start = jsonText.indexOf("[");
  const end = jsonText.lastIndexOf("]");
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byIndex = new Map();
  parsed.forEach((row, i) => {
    const normalized = normalizeIdentifyRow(row, i);
    if (!normalized) return;
    const index = Number.isInteger(normalized.index) ? normalized.index : i;
    if (index < 0 || index >= batchLength) return;
    byIndex.set(index, { ...normalized, index });
  });

  return Array.from({ length: batchLength }, (_, index) => byIndex.get(index) || null);
}

function isRequestTooLargeError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const msg = String(error?.message || error || "").toLowerCase();
  if (status === 413) return true;
  return (
    msg.includes("request too large") ||
    msg.includes("reduce your message size") ||
    msg.includes("context_length") ||
    msg.includes("maximum context length") ||
    (msg.includes("tokens per minute") && msg.includes("requested"))
  );
}

/**
 * Ask an OpenAI-compatible model to identify games from scanned folder candidates.
 * Folder import requires AI: callers must not fall back to heuristics.
 */
async function identifyGamesWithAi(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const config = resolveAiIdentifyConfig(options.env || process.env, options);
  if (!config.enabled) {
    return { enabled: false, used: false, model: null, results: list.map(() => null) };
  }

  const OpenAI = options.OpenAI || require("openai");
  const client =
    options.client ||
    new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

  const batchSize = Number.isFinite(options.batchSize) ? options.batchSize : config.batchSize;
  const maxTreeLines = Number.isFinite(options.maxTreeLines)
    ? options.maxTreeLines
    : config.maxTreeLines;
  const maxPromptChars = Number.isFinite(options.maxPromptChars)
    ? options.maxPromptChars
    : config.maxPromptChars;
  const identified = new Array(list.length).fill(null);

  const SYSTEM =
    'Video-game metadata expert. Reply with JSON only: array of {index,isGame,title,year,platform,confidence}. Official titles with spaces + Title Case; never folder slugs or DOS/CD/RIP/EN in title. year/platform help catalog search.';

  async function completeBatch(batch, treeCap) {
    const prompt = buildIdentifyPrompt(batch, { maxTreeLines: treeCap });
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    });
    const content = completion?.choices?.[0]?.message?.content || "";
    return parseIdentifyResponse(content, batch.length);
  }

  async function identifyBatchWithRetry(batch, treeCap) {
    try {
      return await completeBatch(batch, treeCap);
    } catch (error) {
      if (!isRequestTooLargeError(error)) throw error;
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const left = await identifyBatchWithRetry(batch.slice(0, mid), treeCap);
        const right = await identifyBatchWithRetry(batch.slice(mid), treeCap);
        return [...left, ...right];
      }
      if (treeCap > 4) {
        return identifyBatchWithRetry(batch, Math.max(4, Math.floor(treeCap / 2)));
      }
      throw error;
    }
  }

  try {
    const indexed = list.map((c, absoluteIndex) => ({ ...c, absoluteIndex }));
    const batches = packBatches(indexed, { batchSize, maxTreeLines, maxPromptChars });
    for (const batch of batches) {
      const parsed = await identifyBatchWithRetry(batch, maxTreeLines);
      parsed.forEach((row, i) => {
        if (!row) return;
        identified[batch[i].absoluteIndex] = row;
      });
    }
    return { enabled: true, used: true, model: config.model, results: identified };
  } catch (error) {
    return {
      enabled: true,
      used: false,
      model: config.model,
      results: list.map(() => null),
      error: error?.message || String(error),
    };
  }
}

/**
 * Use the AI title as-is. No app-side rewriting — AI is the only naming authority.
 * year/platform/confidence are passed through for IGDB filtering.
 */
function resolveCandidateTitle(candidate, aiRow, options = {}) {
  const minConfidence =
    Number.isFinite(options.minConfidence) ? options.minConfidence : 0.55;
  if (!aiRow || aiRow.isGame === false || !aiRow.title) {
    return {
      title: candidate?.title || "",
      skip: true,
      reason: "ai_not_a_game",
      ai: aiRow || null,
    };
  }
  if ((aiRow.confidence || 0) < minConfidence) {
    return {
      title: String(aiRow.title).trim(),
      skip: true,
      reason: "low_confidence",
      ai: aiRow,
    };
  }
  return { title: String(aiRow.title).trim(), skip: false, ai: aiRow };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_TREE_LINES,
  DEFAULT_MAX_PROMPT_CHARS,
  resolveAiIdentifyConfig,
  isAiFolderImportEnabled,
  parseIdentifyResponse,
  identifyGamesWithAi,
  resolveCandidateTitle,
  buildIdentifyPrompt,
  packBatches,
  truncateTree,
  isRequestTooLargeError,
  readOpenAiHeaders,
};
