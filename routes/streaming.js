const { launchGame } = require("../utils/gameLauncher");
const { readStreamingSettings, probeSunshineReachable } = require("../utils/streaming");
const {
  findSunshineExecutable,
  readInstallManifest,
  resolveSunshineInstallDir,
} = require("../utils/sunshineBinary");
const { isSunshineEnabled } = require("../utils/sunshineService");

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
      const installDir = resolveSunshineInstallDir(metadataPath);
      const manifest = readInstallManifest(installDir);
      const executable = findSunshineExecutable(installDir);
      res.json({
        remoteStreamingEnabled: streaming.remoteStreamingEnabled,
        moonlightWebUrl: streaming.moonlightWebUrl,
        sunshineReachable,
        sunshineEnabled: isSunshineEnabled(),
        sunshineInstalled: Boolean(executable),
        sunshineVersion: manifest?.version || null,
        ready: streaming.remoteStreamingEnabled && sunshineReachable && !!streaming.moonlightWebUrl,
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

      res.json({
        ...launched,
        moonlightWebUrl: streaming.moonlightWebUrl,
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
}

module.exports = { registerStreamingRoutes };
