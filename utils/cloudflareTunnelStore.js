"use strict";

const fs = require("fs");
const path = require("path");
const { ensureDirectoryExists, readJsonFile, writeJsonFile } = require("./fileUtils");
const { migrateUserTunnelPublicUrl } = require("./tunnelHostname");

function tunnelCredentialsPath(metadataPath) {
  return path.join(metadataPath, "cloudflared", "tunnel-credentials.json");
}

/**
 * @returns {{ token: string, publicUrl: string, updatedAt?: string } | null}
 */
function loadStoredTunnelCredentials(metadataPath) {
  const filePath = tunnelCredentialsPath(metadataPath);
  const data = readJsonFile(filePath, null);
  if (!data || typeof data !== "object") return null;
  const token = typeof data.token === "string" ? data.token.trim() : "";
  let publicUrl = typeof data.publicUrl === "string" ? data.publicUrl.trim() : "";
  if (!token) return null;
  const migrated = migrateUserTunnelPublicUrl(publicUrl);
  if (migrated && migrated !== publicUrl.replace(/\/$/, "")) {
    publicUrl = migrated;
    saveStoredTunnelCredentials(metadataPath, { token, publicUrl });
  }
  return { token, publicUrl, updatedAt: data.updatedAt };
}

function saveStoredTunnelCredentials(metadataPath, { token, publicUrl }) {
  const filePath = tunnelCredentialsPath(metadataPath);
  ensureDirectoryExists(path.dirname(filePath));
  writeJsonFile(filePath, {
    token: String(token).trim(),
    publicUrl: String(publicUrl || "").trim(),
    updatedAt: new Date().toISOString(),
  });
}

function clearStoredTunnelCredentials(metadataPath) {
  const filePath = tunnelCredentialsPath(metadataPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  tunnelCredentialsPath,
  loadStoredTunnelCredentials,
  saveStoredTunnelCredentials,
  clearStoredTunnelCredentials,
};
