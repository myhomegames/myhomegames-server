#!/usr/bin/env node
/**
 * Backfill externalLogoUrl on game metadata.json — same path as “Reload metadata”:
 * GET {catalogBase}/igdb/game/:id (Cloudflare Worker injects Twitch creds) → write logo URL.
 *
 * No TWITCH_CLIENT_* in .env. Credentials live on the API gateway (myhomegames-proxy).
 *
 * Usage:
 *   node scripts/import-external-logo-urls.js [--path DIR] [--catalog-base URL]
 *     [--dry-run] [--force] [--limit N] [--delay-ms N] [--no-tunnel]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { readJsonFile, writeJsonFile } = require("../utils/fileUtils");
const { loadStoredTunnelCredentials } = require("../utils/cloudflareTunnelStore");
const {
  startCloudflareTunnel,
  stopCloudflareTunnel,
} = require("../utils/cloudflareTunnel");

function defaultMetadataPath() {
  if (process.env.METADATA_PATH && String(process.env.METADATA_PATH).trim()) {
    return path.resolve(String(process.env.METADATA_PATH).trim());
  }
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

function normalizeBaseUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/$/, "");
}

/** cloudflared on macOS often resolves "localhost" to ::1; Node here listens on 127.0.0.1 only. */
function localOriginForTunnel() {
  const fromEnv = normalizeBaseUrl(process.env.API_BASE);
  if (!fromEnv) return "http://127.0.0.1:4000";
  try {
    const u = new URL(fromEnv);
    if (u.hostname === "localhost" || u.hostname === "::1") {
      u.hostname = "127.0.0.1";
    }
    return u.origin;
  } catch {
    return "http://127.0.0.1:4000";
  }
}

function parseArgs(argv) {
  let metadataPath = defaultMetadataPath();
  let catalogBase = "";
  let dryRun = false;
  let force = false;
  let noTunnel = false;
  let limit = null;
  let delayMs = 300;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg === "--no-tunnel") noTunnel = true;
    else if (arg === "--path") metadataPath = path.resolve(argv[++i] || "");
    else if (arg.startsWith("--path=")) metadataPath = path.resolve(arg.slice("--path=".length));
    else if (arg === "--catalog-base") catalogBase = normalizeBaseUrl(argv[++i] || "");
    else if (arg.startsWith("--catalog-base=")) catalogBase = normalizeBaseUrl(arg.slice("--catalog-base=".length));
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else if (arg === "--delay-ms") delayMs = Number(argv[++i]);
    else if (arg.startsWith("--delay-ms=")) delayMs = Number(arg.slice("--delay-ms=".length));
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/import-external-logo-urls.js [options]

Options:
  --path DIR            Metadata root (default: OS MyHomeGames data dir)
  --catalog-base URL    Catalog API base (default: stored tunnel publicUrl, else API_BASE)
  --dry-run             Do not write files
  --force               Overwrite existing externalLogoUrl
  --limit N             Process at most N games
  --delay-ms N          Pause between catalog requests (default 300)
  --no-tunnel           Do not auto-start cloudflared if catalog is unreachable
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = 300;
  if (limit != null && (!Number.isFinite(limit) || limit < 1)) limit = null;

  return { metadataPath, catalogBase, dryRun, force, noTunnel, limit, delayMs };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExternalLogo(meta) {
  return typeof meta?.externalLogoUrl === "string" && meta.externalLogoUrl.trim().length > 0;
}

function hasLocalLogo(gameDir) {
  return fs.existsSync(path.join(gameDir, "logo.webp"));
}

function httpRequest(urlString, options = {}) {
  const url = new URL(urlString);
  const lib = url.protocol === "https:" ? https : http;
  const method = options.method || "GET";
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };
  const body = options.body || null;
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchJson(urlString) {
  const res = await httpRequest(urlString);
  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, raw: res.body };
}

async function catalogReachable(catalogBase) {
  try {
    const probe = await fetchJson(`${catalogBase}/igdb/game/1`);
    // 200 = ok, 404 = IGDB miss but gateway/tunnel works, 400 = local creds missing (tunnel not injecting)
    if (probe.status === 200 || probe.status === 404) return { ok: true, status: probe.status };
    return { ok: false, status: probe.status, detail: probe.raw?.slice(0, 200) || "" };
  } catch (err) {
    return { ok: false, status: 0, detail: err.message || String(err) };
  }
}

async function ensureTunnel(metadataPath, catalogBase) {
  const stored = loadStoredTunnelCredentials(metadataPath);
  if (!stored?.token) {
    throw new Error(
      "No stored Cloudflare tunnel token. Connect the tunnel once from the web app (Settings), then re-run.",
    );
  }

  const publicUrl = normalizeBaseUrl(catalogBase || stored.publicUrl);
  if (!publicUrl) {
    throw new Error("Missing catalog base / tunnel publicUrl.");
  }

  console.log(`Starting Cloudflare Tunnel → local ${localOriginForTunnel()} …`);
  const localOrigin = localOriginForTunnel();
  const tunnel = await startCloudflareTunnel({
    localOrigin,
    runtimeToken: stored.token,
    publicUrl,
    metadataPath,
    onLog: (line) => {
      const s = String(line || "").trim();
      if (s) console.log(`  [tunnel] ${s}`);
    },
  });

  for (let i = 0; i < 40; i += 1) {
    await sleep(1500);
    const reach = await catalogReachable(publicUrl);
    if (reach.ok) {
      console.log(`Catalog reachable via ${publicUrl} (HTTP ${reach.status})`);
      return tunnel;
    }
    if (i % 5 === 4) {
      console.log(`  waiting for catalog… last HTTP ${reach.status}`);
    }
  }

  stopCloudflareTunnel(tunnel);
  throw new Error(`Catalog still unreachable at ${publicUrl} after starting tunnel`);
}

async function main() {
  const { metadataPath, catalogBase: catalogBaseArg, dryRun, force, noTunnel, limit, delayMs } =
    parseArgs(process.argv.slice(2));
  const gamesDir = path.join(metadataPath, "content", "games");

  if (!fs.existsSync(gamesDir)) {
    console.error(`Games directory not found: ${gamesDir}`);
    process.exit(1);
  }

  const stored = loadStoredTunnelCredentials(metadataPath);
  let catalogBase =
    catalogBaseArg ||
    normalizeBaseUrl(stored?.publicUrl) ||
    normalizeBaseUrl(process.env.API_BASE);

  if (!catalogBase) {
    console.error("No catalog base URL. Pass --catalog-base or connect Cloudflare Tunnel once from the app.");
    process.exit(1);
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Importing externalLogoUrl via catalog ${catalogBase}` +
      (force ? " (--force)" : ""),
  );

  let tunnelHandle = null;
  let reach = await catalogReachable(catalogBase);
  if (!reach.ok) {
    console.log(`Catalog not reachable (HTTP ${reach.status}). ${reach.detail || ""}`);
    if (noTunnel) {
      console.error("Pass without --no-tunnel to auto-start cloudflared, or connect the tunnel from the app.");
      process.exit(1);
    }
    tunnelHandle = await ensureTunnel(metadataPath, catalogBase);
    catalogBase = normalizeBaseUrl(stored?.publicUrl) || catalogBase;
  } else {
    console.log(`Catalog OK (HTTP ${reach.status})`);
  }

  const candidates = [];
  for (const idName of fs.readdirSync(gamesDir)) {
    const gameDir = path.join(gamesDir, idName);
    if (!fs.statSync(gameDir).isDirectory()) continue;
    const metaPath = path.join(gameDir, "metadata.json");
    if (!fs.existsSync(metaPath)) continue;

    const gameId = Number(idName);
    if (!Number.isFinite(gameId)) continue;

    const meta = readJsonFile(metaPath, null);
    if (!meta || typeof meta !== "object") continue;

    if (!force && hasExternalLogo(meta)) continue;
    if (hasLocalLogo(gameDir)) continue;

    candidates.push({ gameId, metaPath, meta });
  }

  const toProcess = limit != null ? candidates.slice(0, limit) : candidates;
  console.log(`Candidates: ${toProcess.length} (of ${candidates.length} needing fill)`);

  let updated = 0;
  let found = 0;
  let missing = 0;
  let errors = 0;

  try {
    for (let i = 0; i < toProcess.length; i += 1) {
      const item = toProcess[i];
      try {
        const { status, json } = await fetchJson(`${catalogBase}/igdb/game/${item.gameId}`);
        if (status !== 200 || !json || typeof json !== "object") {
          if (status === 404) missing += 1;
          else {
            errors += 1;
            console.error(`  #${item.gameId}: HTTP ${status}`);
          }
        } else {
          const logo = typeof json.logo === "string" ? json.logo.trim() : "";
          if (!logo) {
            missing += 1;
          } else {
            found += 1;
            item.meta.externalLogoUrl = logo;
            if (!dryRun) writeJsonFile(item.metaPath, item.meta);
            updated += 1;
          }
        }
      } catch (err) {
        errors += 1;
        console.error(`  #${item.gameId}:`, err.message || err);
      }

      if ((i + 1) % 50 === 0 || i + 1 === toProcess.length) {
        console.log(
          `  progress ${i + 1}/${toProcess.length} (updated ${updated}, no-logo ${missing}, errors ${errors})`,
        );
      }

      if (i + 1 < toProcess.length) await sleep(delayMs);
    }
  } finally {
    if (tunnelHandle) {
      console.log("Stopping Cloudflare Tunnel started by this script…");
      stopCloudflareTunnel(tunnelHandle);
    }
  }

  console.log(
    `Done: updated=${updated}, withLogo=${found}, noLogoOnIgdb=${missing}, errors=${errors}` +
      (dryRun ? " (dry-run, no writes)" : ""),
  );
  console.log("Hint: POST /reload-games (or restart the app) so the in-memory library picks up the new URLs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
