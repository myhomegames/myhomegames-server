"use strict";

const path = require("path");
const { ensureDirectoryExists, readJsonFile, writeJsonFile } = require("./fileUtils");
const { twitchAppCredentialsPath } = require("./metadataTokenPaths");

/**
 * @returns {{ clientId: string, clientSecret: string, updatedAt?: string } | null}
 */
function loadStoredTwitchAppCredentials(metadataPath) {
  const filePath = twitchAppCredentialsPath(metadataPath);
  const data = readJsonFile(filePath, null);
  if (!data || typeof data !== "object") return null;
  const clientId = typeof data.clientId === "string" ? data.clientId.trim() : "";
  const clientSecret = typeof data.clientSecret === "string" ? data.clientSecret.trim() : "";
  if (!clientId && !clientSecret) return null;
  return { clientId, clientSecret, updatedAt: data.updatedAt };
}

function saveStoredTwitchAppCredentials(metadataPath, { clientId, clientSecret }) {
  const filePath = twitchAppCredentialsPath(metadataPath);
  ensureDirectoryExists(path.dirname(filePath));
  writeJsonFile(filePath, {
    clientId: String(clientId || "").trim(),
    clientSecret: String(clientSecret || "").trim(),
    updatedAt: new Date().toISOString(),
  });
}

module.exports = {
  twitchAppCredentialsFilePath: twitchAppCredentialsPath,
  loadStoredTwitchAppCredentials,
  saveStoredTwitchAppCredentials,
};
