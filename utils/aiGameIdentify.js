"use strict";

const path = require("path");
const { isCloudflareTunnelEnabled } = require("./cloudflareTunnel");
const { splitOversizedSkeletonChunk } = require("./pathSkeleton");

const DEFAULT_MODEL = "gpt-4o-mini";
/**
 * With name-first prompts, larger batches stay under Groq free-tier TPM (~8k).
 * Override with MHG_AI_BATCH_SIZE when using a higher quota provider.
 */
const DEFAULT_BATCH_SIZE = 12;
/** Default: folder/file path only (no directory listing). Raise for ambiguous dumps. */
const DEFAULT_MAX_TREE_LINES = 1;
/**
 * Soft cap on user-prompt characters per request.
 * Nested path skeletons tokenize denser than ~4 chars/token (often ~1.4).
 * Default stays under Groq free-tier ~8k TPM including system + wrapper.
 * Override with MHG_AI_MAX_PROMPT_CHARS when using a higher quota.
 */
const DEFAULT_MAX_PROMPT_CHARS = 4500;
/**
 * Cap completion size (output tokens). Too low truncates JSON and Groq
 * `json_object` mode then returns 400 "Failed to validate JSON".
 */
const DEFAULT_MAX_COMPLETION_TOKENS = 4096;
const DEFAULT_BATCH_COMPLETION_TOKENS = 1536;
/** Auto-wait/retry 429 only when the provider asks for at most this delay (TPM bumps). */
const DEFAULT_RATE_LIMIT_MAX_WAIT_MS = 90_000;
const DEFAULT_RATE_LIMIT_RETRIES = 5;
/** Pause between skeleton chunks to reduce TPM spikes (TPD still applies). */
const DEFAULT_CHUNK_GAP_MS = 350;

function sleep(ms) {
  const wait = Math.max(0, Math.floor(Number(ms) || 0));
  return new Promise((resolve) => setTimeout(resolve, wait));
}

const SYSTEM_PROMPT =
  "Video-game metadata expert. Reply with one JSON object only, no markdown/prose: " +
  '{"results":[{index,isGame,title,year,platform,confidence}]}. ' +
  "title=official retail/IGDB name with spaces+Title Case (never slugs/DOS/CD/RIP/EN). " +
  "year=first release or null; platform=short hint or null; isGame=false for tools/BIOS/setup; confidence 0..1.";

const SKELETON_SYSTEM_PROMPT =
  "Video-game library expert. You receive a compressed filesystem find listing. " +
  "Nested form a{b{c,file1,file2}} — braces nest directories; comma-separated siblings; internal files included. " +
  'Reply with one JSON object only, no markdown/prose: {"games":[{path,title,year,platform,confidence}]}. ' +
  "path = full relative game root with slashes (e.g. dosprograms/games/alleycat), never nested-brace syntax. " +
  "Use folder names and nested file names to recognize titles when the folder slug is unclear. " +
  "title = official retail/IGDB name with spaces + Title Case. year=first release or null; " +
  "platform=short hint for that dump (DOS, PC, SNES, …) or null; confidence 0..1. " +
  "Skip tools/BIOS/setup/shared/scripts/soundfonts. Omit non-games entirely.";

function normalizeIdentifyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function truncateTree(tree, maxLines) {
  const lines = Array.isArray(tree) ? tree.map((l) => String(l)) : [];
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `…(+${lines.length - (maxLines - 1)} more)`];
}

/**
 * Stable cache/dedup key from folder or file basename (not full relative path).
 */
function candidateIdentifyKey(candidate) {
  const raw =
    candidate?.sourceName ||
    path.basename(candidate?.folderPath || candidate?.filePath || candidate?.relativePath || "");
  return normalizeIdentifyKey(String(raw).replace(/\.[^.]+$/, ""));
}

/**
 * One prompt label per candidate. With maxTreeLines<=1 skip file listings (biggest token win).
 */
function candidatePromptLines(item, maxTreeLines) {
  const label =
    item.relativePath ||
    item.sourceName ||
    path.basename(item.folderPath || item.filePath || "") ||
    "?";
  if (maxTreeLines <= 1) return [String(label)];

  const rawTree = Array.isArray(item.tree) ? item.tree.map((l) => String(l)) : [];
  const extras = [];
  const labelKey = normalizeIdentifyKey(path.basename(String(label).replace(/\/$/, "")));
  for (const line of rawTree) {
    if (extras.length >= maxTreeLines - 1) break;
    const base = normalizeIdentifyKey(path.basename(String(line).replace(/\/$/, "")));
    if (
      base &&
      base === labelKey &&
      String(line).replace(/\/$/, "") === String(label).replace(/\/$/, "")
    ) {
      continue;
    }
    if (String(line) === String(label)) continue;
    extras.push(String(line));
  }
  return truncateTree([String(label), ...extras], maxTreeLines);
}

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
    maxTreeLines: Math.max(1, maxTreeLines),
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

function buildIdentifyPrompt(batch, options = {}) {
  const maxTreeLines = Number.isFinite(options.maxTreeLines)
    ? options.maxTreeLines
    : DEFAULT_MAX_TREE_LINES;
  const blocks = batch.map((item, index) => {
    const lines = candidatePromptLines(item, maxTreeLines);
    if (lines.length === 1) return `${index}. ${lines[0]}`;
    return [`${index}.`, ...lines.map((line) => `  ${line}`)].join("\n");
  });
  return [
    `One JSON object only, no markdown: {"results":[${batch.length}×{"index","isGame","title","year","platform","confidence"}]}.`,
    'Examples: aloneinthedark→"Alone in the Dark"; Fallout_1997→"Fallout",year 1997; setup/dosbox→isGame false.',
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
 * Extract a JSON array from model output: bare array, {"games"|"results"|…: [...]},
 * or the first [...] substring (legacy markdown wrappers).
 */
function extractJsonArray(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  let jsonText = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1].trim();

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(jsonText);
  if (parsed === undefined) {
    const objStart = jsonText.indexOf("{");
    const objEnd = jsonText.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      parsed = tryParse(jsonText.slice(objStart, objEnd + 1));
    }
  }
  if (parsed === undefined) {
    const start = jsonText.indexOf("[");
    const end = jsonText.lastIndexOf("]");
    if (start >= 0 && end > start) {
      parsed = tryParse(jsonText.slice(start, end + 1));
    }
  }
  if (parsed === undefined) return [];
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["games", "results", "items", "data", "candidates"]) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return [];
}

/**
 * True when we should retry without response_format:
 * - provider does not support json_object
 * - Groq validated the model output and rejected it (failed_generation)
 */
function isJsonModeUnsupportedError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const msg = String(
    error?.message || error?.error?.message || error?.error || error || ""
  ).toLowerCase();
  const looksLikeJsonModeIssue =
    msg.includes("response_format") ||
    msg.includes("json_object") ||
    msg.includes("json mode") ||
    msg.includes("json schema") ||
    msg.includes("failed to validate json") ||
    msg.includes("failed_generation") ||
    (msg.includes("validate") && msg.includes("json")) ||
    (msg.includes("json") && msg.includes("not support"));
  // Groq often returns 400 with failed_generation when json_object output truncates.
  if (status != null && status !== 400 && status !== 422) {
    return (
      msg.includes("failed to validate json") ||
      msg.includes("failed_generation")
    );
  }
  return looksLikeJsonModeIssue;
}

/**
 * Chat completion with json_object mode + max_tokens.
 * Falls back to plain completion if JSON mode is unsupported or Groq rejects
 * the generated JSON (common when output truncates mid-object).
 */
function summarizeAiMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => {
    const content = String(m?.content || "");
    return {
      role: m?.role || "?",
      chars: content.length,
      preview: content.length > 240 ? `${content.slice(0, 240)}…` : content,
    };
  });
}

async function createChatCompletionLogged(client, params, meta = {}) {
  const model = params?.model || "?";
  const jsonMode = Boolean(params?.response_format);
  const label = meta.label || "completion";
  const started = Date.now();
  console.log("[ai-identify] request", {
    label,
    model,
    jsonMode,
    temperature: params?.temperature,
    max_tokens: params?.max_tokens,
    messages: summarizeAiMessages(params?.messages),
  });
  try {
    const completion = await client.chat.completions.create(params);
    const choice = completion?.choices?.[0];
    const content = String(choice?.message?.content || "");
    console.log("[ai-identify] response", {
      label,
      model,
      jsonMode,
      ms: Date.now() - started,
      finish_reason: choice?.finish_reason || null,
      contentChars: content.length,
      contentPreview: content.length > 240 ? `${content.slice(0, 240)}…` : content,
      usage: completion?.usage || null,
    });
    return completion;
  } catch (error) {
    console.warn("[ai-identify] error", {
      label,
      model,
      jsonMode,
      ms: Date.now() - started,
      status: error?.status || error?.statusCode || null,
      message: error?.message || String(error),
    });
    throw error;
  }
}

async function createJsonCompletion(
  client,
  { model, messages, maxTokens, temperature = 0.1, label = "completion" }
) {
  const base = {
    model,
    temperature,
    max_tokens: Math.max(64, Math.floor(maxTokens || DEFAULT_MAX_COMPLETION_TOKENS)),
    messages,
  };
  return withRateLimitRetry(async () => {
    try {
      return await createChatCompletionLogged(
        client,
        {
          ...base,
          response_format: { type: "json_object" },
        },
        { label: `${label}:json_object` }
      );
    } catch (error) {
      if (!isJsonModeUnsupportedError(error)) throw error;
      console.warn("[ai-identify] falling back to plain completion (no response_format)", {
        label,
      });
      return createChatCompletionLogged(client, base, { label: `${label}:plain_fallback` });
    }
  });
}

/**
 * Parse AI response as a JSON array of identify objects (aligned by index).
 * Also accepts a legacy titles-only string array and {"results":[...]} wrappers.
 */
function parseIdentifyResponse(rawText, batchLength) {
  const parsed = extractJsonArray(rawText);
  if (!parsed.length) return [];

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
  // Daily TPD / org quota 429s are rate limits, not "request too large" splits.
  if (status === 429) return false;
  return (
    msg.includes("request too large") ||
    msg.includes("reduce your message size") ||
    msg.includes("context_length") ||
    msg.includes("maximum context length") ||
    (msg.includes("tokens per minute") && msg.includes("requested") && !msg.includes("rate limit"))
  );
}

function isRateLimitError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const msg = String(
    error?.message || error?.error?.message || error?.error || error || ""
  ).toLowerCase();
  if (status === 429) return true;
  return (
    msg.includes("rate limit") ||
    msg.includes("tokens per day") ||
    msg.includes("too many requests") ||
    (msg.includes("tpd") && msg.includes("limit"))
  );
}

/**
 * Parse Groq/OpenAI-style "Please try again in 22m57.648s" (or Retry-After seconds).
 * @returns {number|null} milliseconds
 */
function parseRetryAfterMs(error) {
  const headers = error?.headers || error?.response?.headers;
  const rawHeader =
    (headers && (headers["retry-after"] || headers["Retry-After"])) || null;
  if (rawHeader != null) {
    const sec = Number(rawHeader);
    if (Number.isFinite(sec) && sec >= 0) return Math.ceil(sec * 1000);
  }
  const msg = String(error?.message || error?.error?.message || error?.error || error || "");
  const full = msg.match(
    /try again in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(\d+(?:\.\d+)?)\s*s/i
  );
  if (full) {
    const hours = Number(full[1] || 0);
    const mins = Number(full[2] || 0);
    const secs = Number(full[3] || 0);
    const ms = ((hours * 60 + mins) * 60 + secs) * 1000;
    if (Number.isFinite(ms) && ms >= 0) return Math.ceil(ms);
  }
  const secsOnly = msg.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (secsOnly) {
    const ms = Number(secsOnly[1]) * 1000;
    if (Number.isFinite(ms) && ms >= 0) return Math.ceil(ms);
  }
  return null;
}

function formatDurationForUser(ms) {
  const totalSec = Math.max(1, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

/**
 * User-facing rate-limit error. Long TPD waits are not auto-slept (import would hang).
 */
function createRateLimitError(error, waitMs) {
  const wait = waitMs != null ? waitMs : parseRetryAfterMs(error);
  const human = wait != null ? formatDurationForUser(wait) : null;
  const msg = human
    ? `AI rate limit reached (provider daily/token quota). Try again in about ${human}.`
    : "AI rate limit reached (provider daily/token quota). Try again later.";
  const err = new Error(msg);
  err.status = 429;
  err.code = "AI_RATE_LIMIT";
  err.retryAfterMs = wait;
  err.cause = error;
  return err;
}

/**
 * Retry on short 429 waits; for long daily-quota waits, throw a clear error immediately.
 */
async function withRateLimitRetry(fn, options = {}) {
  const maxWaitMs = Number.isFinite(options.maxWaitMs)
    ? options.maxWaitMs
    : DEFAULT_RATE_LIMIT_MAX_WAIT_MS;
  const maxAttempts = Number.isFinite(options.maxAttempts)
    ? Math.max(1, Math.floor(options.maxAttempts))
    : DEFAULT_RATE_LIMIT_RETRIES;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      lastError = error;
      const suggested = parseRetryAfterMs(error);
      if (suggested == null) {
        // Unknown delay: brief exponential backoff for a few attempts.
        if (attempt >= maxAttempts - 1) throw createRateLimitError(error, null);
        const waitMs = 1000 * (attempt + 1);
        console.warn("[ai-identify] rate limit, retrying", {
          attempt: attempt + 1,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }
      if (suggested > maxWaitMs) {
        throw createRateLimitError(error, suggested);
      }
      if (attempt >= maxAttempts - 1) throw createRateLimitError(error, suggested);
      console.warn("[ai-identify] rate limit, retrying", {
        attempt: attempt + 1,
        waitMs: suggested + 250,
      });
      await sleep(suggested + 250);
    }
  }
  throw createRateLimitError(lastError, parseRetryAfterMs(lastError));
}

/**
 * Collapse candidates that share the same identify key so we call the model once.
 * Each item must carry `absoluteIndex` (index into the original candidates array).
 * @returns {{ unique: object[], membersOf: number[][] }}
 */
function dedupeCandidatesForIdentify(list) {
  const unique = [];
  const keyToUnique = new Map();
  const membersOf = [];
  for (const item of list) {
    const absoluteIndex = item.absoluteIndex;
    const key = item.identifyKey || candidateIdentifyKey(item) || `__idx_${absoluteIndex}`;
    if (keyToUnique.has(key)) {
      membersOf[keyToUnique.get(key)].push(absoluteIndex);
      continue;
    }
    const uniqueIdx = unique.length;
    keyToUnique.set(key, uniqueIdx);
    membersOf.push([absoluteIndex]);
    unique.push({ ...item, absoluteIndex, identifyKey: key, uniqueIdx });
  }
  return { unique, membersOf };
}

/**
 * Ask an OpenAI-compatible model to identify games from scanned folder candidates.
 * Uses name-first prompts, dedupes by slug key, and optional AI-result cache.
 * Folder import requires AI: callers must not fall back to heuristics.
 */
async function identifyGamesWithAi(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const config = resolveAiIdentifyConfig(options.env || process.env, options);
  if (!config.enabled) {
    return {
      enabled: false,
      used: false,
      model: null,
      results: list.map(() => null),
      stats: { total: list.length, cacheHits: 0, deduped: 0, sent: 0 },
    };
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
  const cache = options.cache && typeof options.cache === "object" ? options.cache : null;
  const readCache =
    typeof options.readCacheEntry === "function" ? options.readCacheEntry : null;
  const writeCache =
    typeof options.writeCacheEntry === "function" ? options.writeCacheEntry : null;

  async function completeBatch(batch, treeCap) {
    const prompt = buildIdentifyPrompt(batch, { maxTreeLines: treeCap });
    const completion = await createJsonCompletion(client, {
      model: config.model,
      maxTokens: DEFAULT_BATCH_COMPLETION_TOKENS,
      label: `batch(size=${batch.length},tree=${treeCap})`,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
      if (treeCap > 1) {
        return identifyBatchWithRetry(batch, Math.max(1, Math.floor(treeCap / 2)));
      }
      throw error;
    }
  }

  try {
    let cacheHits = 0;
    const needAi = [];
    list.forEach((c, absoluteIndex) => {
      const key = candidateIdentifyKey(c);
      if (cache && readCache && key) {
        const hit = readCache(cache, key);
        if (hit) {
          identified[absoluteIndex] = hit;
          cacheHits += 1;
          return;
        }
      }
      needAi.push({ ...c, absoluteIndex, identifyKey: key });
    });

    const { unique, membersOf } = dedupeCandidatesForIdentify(needAi);
    const deduped = Math.max(0, needAi.length - unique.length);
    const batches = packBatches(unique, { batchSize, maxTreeLines, maxPromptChars });
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const parsed = await identifyBatchWithRetry(batch, maxTreeLines);
      batch.forEach((uniqueItem, i) => {
        const row = parsed[i];
        if (!row) return;
        const uniqueIdx = Number.isInteger(uniqueItem.uniqueIdx)
          ? uniqueItem.uniqueIdx
          : unique.findIndex((u) => u.absoluteIndex === uniqueItem.absoluteIndex);
        const absIndexes =
          uniqueIdx >= 0 ? membersOf[uniqueIdx] : [uniqueItem.absoluteIndex];
        for (const abs of absIndexes) {
          identified[abs] = row;
        }
        if (cache && writeCache && uniqueItem.identifyKey) {
          writeCache(cache, uniqueItem.identifyKey, row, { model: config.model });
        }
      });

      if (onProgress) {
        onProgress({
          phase: "ai",
          batchIndex: batchIndex + 1,
          batchCount: Math.max(1, batches.length),
          candidateCount: list.length,
          cacheHits,
          deduped,
        });
      }
    }

    if (batches.length === 0 && onProgress) {
      onProgress({
        phase: "ai",
        batchIndex: 1,
        batchCount: 1,
        candidateCount: list.length,
        cacheHits,
        deduped,
      });
    }

    return {
      enabled: true,
      used: true,
      model: config.model,
      results: identified,
      stats: {
        total: list.length,
        cacheHits,
        deduped,
        sent: unique.length,
      },
    };
  } catch (error) {
    return {
      enabled: true,
      used: false,
      model: config.model,
      results: list.map(() => null),
      error: error?.message || String(error),
      stats: { total: list.length, cacheHits: 0, deduped: 0, sent: 0 },
    };
  }
}

function buildSkeletonIdentifyPrompt(skeletonChunk, rootName) {
  return [
    `Root folder name: ${rootName}.`,
    "Compressed find listing (nested a{b{c,file}}). Identify every game.",
    'Return ONLY {"games":[{"path","title","year","platform","confidence"}]} — no markdown.',
    "path = full relative game root with slashes (folder or primary file), not nested-brace syntax.",
    "",
    skeletonChunk,
  ].join("\n");
}

/**
 * Parse AI skeleton response into game rows with absolute paths.
 * Accepts {"games":[...]}, a bare array, or legacy markdown-wrapped JSON.
 */
function parseSkeletonIdentifyResponse(rawText, rootPath) {
  const { skeletonPathToAbsolute } = require("./pathSkeleton");
  const parsed = extractJsonArray(rawText);

  const games = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const relPath = String(row.path || row.relativePath || "").trim().replace(/\\/g, "/");
    const title = String(row.title || "").trim();
    if (!relPath || !title) continue;
    const yearNum = Number(row.year);
    const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0));
    games.push({
      path: relPath.replace(/^\.\//, ""),
      title,
      year: Number.isFinite(yearNum) && yearNum >= 1970 && yearNum <= 2100 ? Math.floor(yearNum) : null,
      platform: row.platform != null ? String(row.platform).trim() || null : null,
      confidence,
      isGame: true,
      absPath: skeletonPathToAbsolute(rootPath, relPath),
    });
  }
  return games;
}

/**
 * Identify games from a compressed find skeleton (chunked if needed for provider limits).
 * Returns one merged list — AI decides which paths are games (no hardcoded games/cd layout).
 */
async function identifyGamesFromSkeleton(skeleton, options = {}) {
  const rootPath = skeleton?.rootPath || options.rootPath;
  const rootName = skeleton?.rootName || path.basename(String(rootPath || ""));
  const chunks = Array.isArray(skeleton?.chunks)
    ? skeleton.chunks.filter((c) => String(c || "").trim())
    : skeleton?.text
      ? [String(skeleton.text)]
      : [];

  const config = resolveAiIdentifyConfig(options.env || process.env, options);
  if (!config.enabled) {
    return {
      enabled: false,
      used: false,
      model: null,
      games: [],
      results: [],
      stats: { chunks: 0, games: 0 },
    };
  }
  if (!rootPath || chunks.length === 0) {
    return {
      enabled: true,
      used: false,
      model: config.model,
      games: [],
      results: [],
      error: "Empty folder skeleton",
      stats: { chunks: 0, games: 0 },
    };
  }

  const OpenAI = options.OpenAI || require("openai");
  const client =
    options.client ||
    new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const onChunkGames =
    typeof options.onChunkGames === "function" ? options.onChunkGames : null;
  const cache = options.cache && typeof options.cache === "object" ? options.cache : null;
  const readCache =
    typeof options.readCacheEntry === "function" ? options.readCacheEntry : null;
  const writeCache =
    typeof options.writeCacheEntry === "function" ? options.writeCacheEntry : null;
  const chunkCache =
    options.chunkCache && typeof options.chunkCache === "object" ? options.chunkCache : null;
  const {
    hashSkeletonChunk,
    readSkeletonChunk,
    writeSkeletonChunk,
  } = require("./aiIdentifyCache");
  const onChunkPersisted =
    typeof options.onChunkPersisted === "function" ? options.onChunkPersisted : null;

  let cacheHits = 0;
  let apiCalls = 0;

  function hydrateCachedGames(rows) {
    const { skeletonPathToAbsolute } = require("./pathSkeleton");
    return (Array.isArray(rows) ? rows : []).map((g) => ({
      ...g,
      isGame: true,
      absPath: skeletonPathToAbsolute(rootPath, g.path),
    }));
  }

  function persistSuccessfulChunk(chunkText, games, label) {
    if (chunkCache) {
      const hash = hashSkeletonChunk(config.model, rootName, chunkText);
      writeSkeletonChunk(chunkCache, hash, games, {
        model: config.model,
        label,
      });
    }
    if (cache && writeCache) {
      for (const game of games) {
        const cacheKey = candidateIdentifyKey({ sourceName: path.basename(game.path) });
        if (cacheKey) writeCache(cache, cacheKey, game, { model: config.model });
      }
    }
    if (onChunkPersisted) {
      try {
        onChunkPersisted({ label, games: games.length });
      } catch (persistErr) {
        console.warn(
          "[ai-identify] chunk persist callback failed:",
          persistErr?.message || persistErr
        );
      }
    }
  }

  async function completeChunk(chunkText, label) {
    const prompt = buildSkeletonIdentifyPrompt(chunkText, rootName);
    apiCalls += 1;
    const completion = await createJsonCompletion(client, {
      model: config.model,
      maxTokens: DEFAULT_MAX_COMPLETION_TOKENS,
      label,
      messages: [
        { role: "system", content: SKELETON_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
    return parseSkeletonIdentifyResponse(
      completion?.choices?.[0]?.message?.content || "",
      rootPath
    );
  }

  async function completeChunkWithRetry(chunkText, label) {
    if (chunkCache) {
      const hash = hashSkeletonChunk(config.model, rootName, chunkText);
      const hit = readSkeletonChunk(chunkCache, hash);
      if (hit) {
        cacheHits += 1;
        console.log("[ai-identify] chunk cache hit", {
          label,
          hash: hash.slice(0, 12),
          games: hit.games.length,
        });
        return hydrateCachedGames(hit.games);
      }
    }
    try {
      const games = await completeChunk(chunkText, label);
      persistSuccessfulChunk(chunkText, games, label);
      return games;
    } catch (error) {
      if (!isRequestTooLargeError(error)) throw error;
      const parts = splitOversizedSkeletonChunk(chunkText);
      if (parts.length < 2) throw error;
      console.warn("[ai-identify] splitting oversized skeleton chunk", {
        label,
        parts: parts.length,
      });
      const out = [];
      for (let p = 0; p < parts.length; p += 1) {
        out.push(
          ...(await completeChunkWithRetry(parts[p], `${label}/split${p + 1}`))
        );
      }
      return out;
    }
  }

  const chunkGapMs = Number.isFinite(options.chunkGapMs)
    ? Math.max(0, Math.floor(options.chunkGapMs))
    : DEFAULT_CHUNK_GAP_MS;

  const byPath = new Map();
  try {
    console.log("[ai-identify] skeleton identify start", {
      rootName,
      chunks: chunks.length,
      model: config.model,
      baseURL: config.baseURL || null,
      chunkCache: Boolean(chunkCache),
    });
    for (let i = 0; i < chunks.length; i++) {
      const label = `skeleton ${i + 1}/${chunks.length}`;
      const hash = chunkCache
        ? hashSkeletonChunk(config.model, rootName, chunks[i])
        : null;
      const willHit =
        hash && chunkCache ? Boolean(readSkeletonChunk(chunkCache, hash)) : false;
      if (i > 0 && chunkGapMs > 0 && !willHit) await sleep(chunkGapMs);
      const chunkGames = await completeChunkWithRetry(chunks[i], label);
      const newlyMerged = [];
      for (const game of chunkGames) {
        const key = String(game.path || "").toLowerCase();
        if (!key) continue;
        if (cache && readCache) {
          const cacheKey = candidateIdentifyKey({ sourceName: path.basename(game.path) });
          const hit = cacheKey ? readCache(cache, cacheKey) : null;
          if (hit?.title && hit.isGame !== false) {
            game.title = hit.title;
            game.year = hit.year ?? game.year;
            game.platform = hit.platform ?? game.platform;
            game.confidence = hit.confidence ?? game.confidence;
          } else if (writeCache && cacheKey) {
            writeCache(cache, cacheKey, game, { model: config.model });
          }
        }
        const prev = byPath.get(key);
        if (!prev || (game.confidence || 0) >= (prev.confidence || 0)) {
          byPath.set(key, game);
        }
        newlyMerged.push(game);
      }
      if (onProgress) {
        onProgress({
          phase: "ai",
          batchIndex: i + 1,
          batchCount: chunks.length,
          candidateCount: byPath.size,
          cacheHits,
          apiCalls,
        });
      }
      // Import as soon as a chunk is identified (caller may add games immediately).
      if (onChunkGames && newlyMerged.length > 0) {
        await onChunkGames(newlyMerged, {
          batchIndex: i + 1,
          batchCount: chunks.length,
          candidateCount: byPath.size,
          cacheHits,
          apiCalls,
        });
      }
    }

    const games = Array.from(byPath.values());
    const results = games.map((g) => ({
      isGame: true,
      title: g.title,
      year: g.year,
      platform: g.platform,
      confidence: g.confidence,
    }));

    console.log("[ai-identify] skeleton identify done", {
      games: games.length,
      cacheHits,
      apiCalls,
    });

    return {
      enabled: true,
      used: true,
      model: config.model,
      games,
      results,
      stats: {
        chunks: chunks.length,
        games: games.length,
        cacheHits,
        apiCalls,
      },
    };
  } catch (error) {
    const partialGames = Array.from(byPath.values());
    const retryAfterMs =
      Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : parseRetryAfterMs(error);
    const errorCode =
      error?.code ||
      (isRateLimitError(error) ? "AI_RATE_LIMIT" : null);
    console.warn("[ai-identify] skeleton identify failed", {
      message: error?.message || String(error),
      code: errorCode,
      retryAfterMs,
      cacheHits,
      apiCalls,
      partialGames: partialGames.length,
    });
    return {
      enabled: true,
      used: partialGames.length > 0,
      model: config.model,
      games: partialGames,
      results: partialGames.map((g) => ({
        isGame: true,
        title: g.title,
        year: g.year,
        platform: g.platform,
        confidence: g.confidence,
      })),
      error: error?.message || String(error),
      errorCode,
      retryAfterMs,
      stats: {
        chunks: chunks.length,
        games: partialGames.length,
        cacheHits,
        apiCalls,
      },
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
  DEFAULT_MAX_COMPLETION_TOKENS,
  DEFAULT_BATCH_COMPLETION_TOKENS,
  DEFAULT_RATE_LIMIT_MAX_WAIT_MS,
  DEFAULT_RATE_LIMIT_RETRIES,
  DEFAULT_CHUNK_GAP_MS,
  SYSTEM_PROMPT,
  SKELETON_SYSTEM_PROMPT,
  resolveAiIdentifyConfig,
  isAiFolderImportEnabled,
  parseIdentifyResponse,
  parseSkeletonIdentifyResponse,
  extractJsonArray,
  createJsonCompletion,
  identifyGamesWithAi,
  identifyGamesFromSkeleton,
  resolveCandidateTitle,
  buildIdentifyPrompt,
  buildSkeletonIdentifyPrompt,
  packBatches,
  truncateTree,
  candidateIdentifyKey,
  candidatePromptLines,
  dedupeCandidatesForIdentify,
  isRequestTooLargeError,
  isRateLimitError,
  isJsonModeUnsupportedError,
  parseRetryAfterMs,
  formatDurationForUser,
  createRateLimitError,
  withRateLimitRetry,
  readOpenAiHeaders,
};
