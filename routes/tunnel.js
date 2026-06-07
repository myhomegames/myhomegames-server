"use strict";

const {
  isCloudflareTunnelEnabled,
  startCloudflareTunnel,
  stopCloudflareTunnel,
} = require("../utils/cloudflareTunnel");
const {
  loadStoredTunnelCredentials,
  saveStoredTunnelCredentials,
  clearStoredTunnelCredentials,
} = require("../utils/cloudflareTunnelStore");

async function startTunnelFromStored(deps, stored) {
  const { getTunnelProcess, setTunnelProcess, getLocalOrigin, applyPublicUrl } = deps;
  const token = String(stored?.token || "").trim();
  let publicUrl = String(stored?.publicUrl || "").trim();

  if (!token) {
    throw new Error("tunnel token is required");
  }

  if (publicUrl && !/^https?:\/\//i.test(publicUrl)) {
    publicUrl = `https://${publicUrl}`;
  }
  publicUrl = publicUrl.replace(/\/$/, "");

  if (publicUrl) {
    applyPublicUrl(publicUrl);
  }

  const existing = getTunnelProcess();
  if (existing) {
    stopCloudflareTunnel(existing);
    setTunnelProcess(null);
  }

  const tunnel = await startCloudflareTunnel({
    localOrigin: getLocalOrigin(),
    runtimeToken: token,
    publicUrl: publicUrl || undefined,
  });
  setTunnelProcess(tunnel);

  return {
    connected: true,
    publicUrl: publicUrl || "",
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ metadataPath: string, getTunnelProcess: () => import('cloudflared').Tunnel | null, setTunnelProcess: (t: import('cloudflared').Tunnel | null) => void, getLocalOrigin: () => string, applyPublicUrl: (url: string) => void }} deps
 */
function registerTunnelRoutes(app, deps) {
  const { metadataPath, getTunnelProcess, setTunnelProcess, getLocalOrigin, applyPublicUrl } = deps;

  app.get("/tunnel/status", (req, res) => {
    const stored = loadStoredTunnelCredentials(metadataPath);
    const process = getTunnelProcess();
    res.json({
      featureEnabled: isCloudflareTunnelEnabled(),
      hasStoredToken: Boolean(stored?.token),
      connected: Boolean(process),
      publicUrl: (stored?.publicUrl || "").replace(/\/$/, ""),
    });
  });

  app.post("/tunnel/connect", async (req, res) => {
    if (!isCloudflareTunnelEnabled()) {
      return res.status(400).json({ error: "Cloudflare Tunnel is not enabled on this server." });
    }

    const token = String(req.body?.token || "").trim();
    let publicUrl = String(req.body?.url || req.body?.publicUrl || "").trim();

    if (!token) {
      return res.status(400).json({ error: "tunnel token is required" });
    }

    if (publicUrl && !/^https?:\/\//i.test(publicUrl)) {
      publicUrl = `https://${publicUrl}`;
    }
    publicUrl = publicUrl.replace(/\/$/, "");

    saveStoredTunnelCredentials(metadataPath, { token, publicUrl });

    try {
      const result = await startTunnelFromStored(deps, { token, publicUrl });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: "Failed to start Cloudflare Tunnel",
        detail: err.message || String(err),
      });
    }
  });

  app.post("/tunnel/reconnect", async (req, res) => {
    if (!isCloudflareTunnelEnabled()) {
      return res.status(400).json({ error: "Cloudflare Tunnel is not enabled on this server." });
    }

    if (getTunnelProcess()) {
      const stored = loadStoredTunnelCredentials(metadataPath);
      return res.json({
        connected: true,
        publicUrl: (stored?.publicUrl || "").replace(/\/$/, ""),
      });
    }

    const stored = loadStoredTunnelCredentials(metadataPath);
    if (!stored?.token) {
      return res.status(400).json({ error: "No stored tunnel credentials" });
    }

    try {
      const result = await startTunnelFromStored(deps, stored);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: "Failed to start Cloudflare Tunnel",
        detail: err.message || String(err),
      });
    }
  });

  app.post("/tunnel/logout", (req, res) => {
    const existing = getTunnelProcess();
    if (existing) {
      stopCloudflareTunnel(existing);
      setTunnelProcess(null);
    }
    clearStoredTunnelCredentials(metadataPath);
    res.json({ ok: true });
  });
}

module.exports = { registerTunnelRoutes, startTunnelFromStored };
