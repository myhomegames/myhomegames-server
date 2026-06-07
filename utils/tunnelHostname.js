"use strict";

/** Per-user API host under vige.it (one label → covered by Universal SSL *.vige.it). */
const USER_TUNNEL_HOST_SUFFIX = "-myhomegames-server.vige.it";
const INTERIM_API_SUFFIX = "-api.vige.it";

function userTunnelHostname(username) {
  return `${String(username || "").trim()}${USER_TUNNEL_HOST_SUFFIX}`;
}

function isUserTunnelHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "myhomegames-server.vige.it") return false;
  return host.endsWith(USER_TUNNEL_HOST_SUFFIX);
}

function migrateUserTunnelPublicUrl(publicUrl) {
  const raw = String(publicUrl || "").trim();
  if (!raw) return raw;
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(normalized).hostname.toLowerCase();
    if (isUserTunnelHostname(host)) {
      return raw.replace(/\/$/, "");
    }
    if (host.endsWith(INTERIM_API_SUFFIX)) {
      const username = host.slice(0, -INTERIM_API_SUFFIX.length);
      if (username && !username.includes(".")) {
        return `https://${userTunnelHostname(username)}`;
      }
    }
    const nested = host.match(/^([a-z0-9-]+)\.myhomegames-server\.vige\.it$/);
    if (nested) {
      return `https://${userTunnelHostname(nested[1])}`;
    }
    return raw.replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

module.exports = {
  USER_TUNNEL_HOST_SUFFIX,
  userTunnelHostname,
  isUserTunnelHostname,
  migrateUserTunnelPublicUrl,
};
