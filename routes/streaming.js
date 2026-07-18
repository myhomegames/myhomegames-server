const { launchGame } = require("../utils/gameLauncher");
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
const { isMoonlightWebEnabled, resolveMoonlightWebPort } = require("../utils/moonlightWebService");
const { listMoonlightHosts, hostLooksPaired } = require("../utils/moonlightWebPairing");
const { resolveMoonlightDesktopStreamUrl } = require("../utils/moonlightWebEmbed");
const { ensureMoonlightWebAdminCredentials } = require("../utils/moonlightWebCredentials");
const {
  isCloudflareTurnConfigured,
  generateCloudflareTurnIceServers,
} = require("../utils/cloudflareTurn");

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

      const launched = await launchGame(getAllGames(), metadataPath, gameId, executableName);
      const sunshineReachable = await probeSunshineReachable(streaming);

      let moonlightWebUrl = streaming.moonlightWebUrl;
      let moonlightStream = null;
      try {
        let cookie = "";
        try {
          const auth = await ensureMoonlightWebAdminCredentials(streaming.moonlightWebUrl);
          cookie = auth.cookie || "";
        } catch {
          // default_user_id may allow unauthenticated API access
        }
        const hosts = await listMoonlightHosts(streaming.moonlightWebUrl, cookie);
        const host =
          hosts.find((item) => hostLooksPaired(item)) ||
          hosts[0] ||
          null;
        if (host?.host_id != null) {
          moonlightStream = await resolveMoonlightDesktopStreamUrl({
            baseUrl: streaming.moonlightWebUrl,
            cookie,
            hostId: host.host_id,
          });
          moonlightWebUrl = moonlightStream.url;
        }
      } catch (error) {
        console.warn(
          `Could not resolve Moonlight Desktop stream URL: ${error.message || error}`,
        );
      }

      res.json({
        ...launched,
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
   * Short-lived Cloudflare Realtime TURN ICE servers for Moonlight Web (ice_server_script).
   * Called from inside the Moonlight container via host.docker.internal.
   */
  app.get("/streaming/turn-ice-servers", optionalToken, async (req, res) => {
    try {
      if (!isCloudflareTurnConfigured()) {
        return res.status(503).json({
          error: "Cloudflare TURN is not configured",
          detail: "Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN on the server.",
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
