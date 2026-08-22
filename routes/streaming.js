const { launchGame, resolveGameLaunch } = require("../utils/gameLauncher");
const {
  readStreamingSettings,
  probeSunshineReachable,
  probeMoonlightWebReachable,
  defaultManagedMoonlightWebUrl,
} = require("../utils/streaming");
const {
  findSunshineExecutable,
  readInstallManifest,
  resolveSunshineInstallDir,
} = require("../utils/sunshineBinary");
const {
  findMoonlightWebExecutable,
  readInstallManifest: readMoonlightWebManifest,
  resolveMoonlightWebInstallDir,
} = require("../utils/moonlightWebBinary");
const { isSunshineEnabled } = require("../utils/sunshineService");
const {
  isMoonlightWebEnabled,
  resolveMoonlightWebPort,
  resolveLanIpHint,
} = require("../utils/moonlightWebService");
const { attachMoonlightStopHook } = require("../utils/moonlightWebEmbed");
const { ensureMoonlightAppStreamReady } = require("../utils/moonlightWebLaunch");
const { upsertSunshineStreamingApp, sunshineStreamingAppName } = require("../utils/sunshineApps");
const {
  isCloudflareTurnConfigured,
  generateCloudflareTurnIceServers,
} = require("../utils/cloudflareTurn");
const { refreshMoonlightTurnIceServers } = require("../utils/moonlightWebTurn");
const { stopRemoteStreamingSession, rememberStreamingLaunch } = require("../utils/streamingSessionStop");
const {
  isUserTunnelHostname,
  apiPublicUrlFromMoonlightWebUrl,
} = require("../utils/tunnelHostname");

function resolvePublicApiBaseForStop(req, moonlightWebUrl) {
  const forwarded = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = String(forwarded || req.get("host") || "")
    .split(":")[0]
    .trim()
    .toLowerCase();
  if (host && isUserTunnelHostname(host)) {
    return `https://${host}`;
  }
  const fromMoonlight = apiPublicUrlFromMoonlightWebUrl(moonlightWebUrl);
  if (fromMoonlight) return fromMoonlight;
  const envBase = String(process.env.API_BASE || "").trim().replace(/\/$/, "");
  if (envBase) {
    try {
      const u = new URL(/^https?:\/\//i.test(envBase) ? envBase : `https://${envBase}`);
      if (isUserTunnelHostname(u.hostname)) return `${u.protocol}//${u.host}`;
    } catch {
      // ignore
    }
  }
  return "";
}

/**
 * @param {import('express').Express} app
 * @param {(req: any, res: any, next: any) => void} optionalToken
 * @param {() => object} readSettings
 * @param {string} metadataPath
 * @param {() => Record<number, object>} getAllGames
 */
function registerStreamingRoutes(app, optionalToken, readSettings, metadataPath, getAllGames) {
  app.get("/streaming/status", optionalToken, async (req, res) => {
    try {
      const settings = readSettings();
      const streaming = readStreamingSettings(settings);
      const sunshineReachable = await probeSunshineReachable(streaming);
      const moonlightProbeUrl =
        streaming.moonlightWebUrl || defaultManagedMoonlightWebUrl(resolveMoonlightWebPort());
      const moonlightWebReachable = await probeMoonlightWebReachable(moonlightProbeUrl);
      const installDir = resolveSunshineInstallDir(metadataPath);
      const manifest = readInstallManifest(installDir);
      const executable = findSunshineExecutable(installDir);
      const moonlightInstallDir = resolveMoonlightWebInstallDir(metadataPath);
      const moonlightManifest = readMoonlightWebManifest(moonlightInstallDir);
      const moonlightExecutable = findMoonlightWebExecutable(moonlightInstallDir);
      res.json({
        remoteStreamingEnabled: streaming.remoteStreamingEnabled,
        moonlightWebUrl: streaming.moonlightWebUrl,
        sunshineReachable,
        sunshineEnabled: isSunshineEnabled(),
        sunshineInstalled: Boolean(executable),
        sunshineVersion: manifest?.version || null,
        moonlightWebEnabled: isMoonlightWebEnabled(),
        moonlightWebReachable,
        moonlightWebInstalled: Boolean(moonlightExecutable) || moonlightManifest?.kind === "docker",
        moonlightWebVersion: moonlightManifest?.version || null,
        moonlightWebKind: moonlightManifest?.kind || null,
        ready:
          streaming.remoteStreamingEnabled &&
          sunshineReachable &&
          !!streaming.moonlightWebUrl &&
          moonlightWebReachable,
      });
    } catch (err) {
      console.error("GET /streaming/status failed:", err?.message || err);
      res.status(500).json({ error: "streaming status failed" });
    }
  });

  app.post("/streaming/launch", optionalToken, async (req, res) => {
    try {
      const settings = readSettings();
      const streaming = readStreamingSettings(settings);
      if (!streaming.remoteStreamingEnabled || !streaming.moonlightWebUrl) {
        return res.status(400).json({
          error: "Remote streaming is not configured",
          detail: "Enable remote streaming and set a Moonlight Web URL in server settings.",
        });
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const gameId = body.gameId ?? req.query.gameId;
      if (!gameId) {
        return res.status(400).json({ error: "Missing gameId" });
      }

      const executableName =
        typeof body.executableName === "string"
          ? body.executableName
          : typeof req.query.executableName === "string"
            ? req.query.executableName
            : undefined;

      const moonlightInstallDir = resolveMoonlightWebInstallDir(metadataPath);
      const moonlightKind = readMoonlightWebManifest(moonlightInstallDir)?.kind || null;
      const moonlightKindForApi = moonlightKind === "docker" ? "docker" : null;

      const resolved = resolveGameLaunch(getAllGames(), metadataPath, gameId, executableName);
      if (!resolved.ok) {
        return res.status(resolved.status).json({
          error: resolved.error,
          ...(resolved.detail ? { detail: resolved.detail } : {}),
        });
      }

      const entry = getAllGames()[Number(gameId)];
      const gameTitle =
        String(entry?.title || entry?.name || "").trim() || `Game ${gameId}`;
      const streamAppTitle = sunshineStreamingAppName(gameTitle);

      const sunshineReachableBefore = await probeSunshineReachable(streaming);
      if (!sunshineReachableBefore) {
        return res.status(503).json({
          error: "Sunshine is not reachable",
          detail: "Start Sunshine on the home PC before remote play.",
        });
      }

      try {
        await upsertSunshineStreamingApp({
          gameTitle,
          fullCommandPath: resolved.fullCommandPath,
          env: process.env,
        });
      } catch (error) {
        console.error("Sunshine app registration failed:", error?.message || error);
        return res.status(502).json({
          error: "Could not register Sunshine application",
          detail: error?.message || "Unknown error",
        });
      }

      let moonlightWebUrl = streaming.moonlightWebUrl;
      let moonlightStream = null;
      try {
        moonlightStream = await ensureMoonlightAppStreamReady({
          baseUrl: streaming.moonlightWebUrl,
          kind: moonlightKindForApi,
          env: process.env,
          lanIp: resolveLanIpHint(),
          cachedHostId: streaming.moonlightDesktopHostId,
          appTitle: streamAppTitle,
          maxAttempts: 5,
        });
        moonlightWebUrl = moonlightStream.url;
      } catch (error) {
        console.warn(
          `Could not resolve Moonlight application stream URL: ${error.message || error}`,
        );
        return res.status(502).json({
          error: "Could not open application stream",
          detail: error?.message || "Moonlight application not found after Sunshine registration",
        });
      }

      rememberStreamingLaunch({
        pid: null,
        gameId,
        executableName: resolved.executableName,
        fullCommandPath: resolved.fullCommandPath,
      });
      const sunshineReachable = await probeSunshineReachable(streaming);

      try {
        if (moonlightKind === "docker" || moonlightKind == null) {
          await refreshMoonlightTurnIceServers({
            installDir: moonlightInstallDir,
            kind: moonlightKind === "docker" ? "docker" : null,
          });
        }
      } catch (error) {
        console.warn(`Could not refresh Cloudflare TURN ICE servers: ${error.message || error}`);
      }

      if (!moonlightStream) {
        return res.status(502).json({
          error: "Could not open application stream",
          detail: "Moonlight application stream URL could not be resolved",
        });
      }

      const publicApiBase = resolvePublicApiBaseForStop(req, moonlightWebUrl);
      moonlightWebUrl = attachMoonlightStopHook(moonlightWebUrl, {
        apiBase: publicApiBase,
        gameId,
        executableName: resolved.executableName,
        hostId: moonlightStream?.hostId ?? null,
      });
      if (moonlightStream) {
        moonlightStream = { ...moonlightStream, url: moonlightWebUrl };
      }
      if (publicApiBase) {
        console.log(`[streaming/launch] mhgStop attached via ${publicApiBase}`);
      } else {
        console.warn("[streaming/launch] could not resolve public API base for mhgStop");
      }
      if (moonlightWebUrl && !/\/stream(?:\.mhg\d+)?\.html(\?|$)/i.test(moonlightWebUrl)) {
        console.warn(
          `[streaming/launch] moonlightWebUrl is not a direct application stream link: ${moonlightWebUrl}`,
        );
      } else if (moonlightWebUrl) {
        console.log(
          `[streaming/launch] opening Moonlight app stream (${moonlightStream.appTitle || streamAppTitle})`,
        );
      }

      res.json({
        status: "stream-ready",
        executableName: resolved.executableName,
        fullCommandPath: resolved.fullCommandPath,
        gameTitle,
        moonlightWebUrl,
        moonlightStream,
        sunshineReachable,
      });
    } catch (err) {
      if (err?.payload && err?.status) {
        return res.status(err.status).json(err.payload);
      }
      console.error("POST /streaming/launch failed:", err?.message || err);
      res.status(500).json({
        error: "Launch failed",
        detail: err?.message || "Unknown error",
      });
    }
  });

  /**
   * Cancel Moonlight Web / Sunshine stream and kill the game started by /streaming/launch.
   */
  async function handleStreamingStop(req, res) {
    try {
      const settings = readSettings();
      const streaming = readStreamingSettings(settings);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const hostIdRaw = body.hostId ?? body.host_id ?? req.query.hostId ?? req.query.host_id;
      const hostId = hostIdRaw != null ? Number(hostIdRaw) : null;
      const gameId = body.gameId ?? body.game_id ?? req.query.gameId ?? req.query.game_id ?? null;
      const executableName =
        typeof body.executableName === "string"
          ? body.executableName
          : typeof body.executable === "string"
            ? body.executable
            : typeof req.query.executableName === "string"
              ? req.query.executableName
              : typeof req.query.executable === "string"
                ? req.query.executable
                : "";

      const result = await stopRemoteStreamingSession({
        moonlightWebUrl: streaming.moonlightWebUrl,
        hostId: Number.isFinite(hostId) ? hostId : null,
        gameId,
        executableName,
        allGames: getAllGames(),
        metadataPath,
      });
      console.log(
        `[streaming/stop] moonlight=${JSON.stringify(result.moonlightCancel)} sunshine=${JSON.stringify(result.sunshineClose)} local=${JSON.stringify(result.localGame)}`,
      );
      // Prefer HTTP 200 even if some sub-steps failed (best-effort cleanup).
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("POST /streaming/stop failed:", err?.message || err);
      res.status(502).json({
        error: "Stop streaming session failed",
        detail: err?.message || "Unknown error",
      });
    }
  }

  app.post("/streaming/stop", optionalToken, handleStreamingStop);
  // GET for Moonlight Exit fallback (img/beacon / simple fetch without preflight).
  app.get("/streaming/stop", optionalToken, handleStreamingStop);

  /**
   * Short-lived Cloudflare Realtime TURN ICE servers for Moonlight Web (ice_server_script).
   * Proxies to the tunnel manager Worker (TURN long-term secrets stay on Cloudflare).
   */
  app.get("/streaming/turn-ice-servers", optionalToken, async (req, res) => {
    try {
      if (!isCloudflareTurnConfigured()) {
        return res.status(503).json({
          error: "Cloudflare TURN is disabled",
          detail: "Set CLOUDFLARE_TURN_ENABLED=true (default) to mint ICE via the tunnel manager.",
        });
      }
      const { iceServers } = await generateCloudflareTurnIceServers();
      res.json(iceServers);
    } catch (err) {
      console.error("GET /streaming/turn-ice-servers failed:", err?.message || err);
      res.status(502).json({
        error: "TURN credential generation failed",
        detail: err?.message || "Unknown error",
      });
    }
  });
}

module.exports = { registerStreamingRoutes };
