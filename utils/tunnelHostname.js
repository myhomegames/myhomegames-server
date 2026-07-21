"use strict";

/** Per-user API host under vige.it (one label → covered by Universal SSL *.vige.it). */
const USER_TUNNEL_HOST_SUFFIX = "-myhomegames-server.vige.it";
/** Per-user Moonlight Web host (browser stream UI). */
const USER_MOONLIGHT_HOST_SUFFIX = "-moonlight-web.vige.it";

function userTunnelHostname(username) {
  return `${String(username || "").trim()}${USER_TUNNEL_HOST_SUFFIX}`;
}

function userMoonlightWebHostname(username) {
  return `${String(username || "").trim()}${USER_MOONLIGHT_HOST_SUFFIX}`;
}

function isUserTunnelHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "myhomegames-server.vige.it") return false;
  return host.endsWith(USER_TUNNEL_HOST_SUFFIX);
}

function isUserMoonlightWebHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.endsWith(USER_MOONLIGHT_HOST_SUFFIX);
}

/**
 * Derive public Moonlight Web URL from the per-user API tunnel URL.
 * https://user-myhomegames-server.vige.it → https://user-moonlight-web.vige.it
 */
function moonlightWebPublicUrlFromApiBase(apiPublicUrl) {
  const normalized = String(apiPublicUrl || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const host = url.hostname.toLowerCase();
    if (!isUserTunnelHostname(host)) return "";
    const username = host.slice(0, -USER_TUNNEL_HOST_SUFFIX.length);
    if (!username) return "";
    return `https://${userMoonlightWebHostname(username)}`;
  } catch {
    return "";
  }
}

/**
 * Derive public API tunnel URL from the per-user Moonlight Web URL.
 * https://user-moonlight-web.vige.it → https://user-myhomegames-server.vige.it
 */
function apiPublicUrlFromMoonlightWebUrl(moonlightPublicUrl) {
  const normalized = String(moonlightPublicUrl || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const host = url.hostname.toLowerCase();
    if (!isUserMoonlightWebHostname(host)) return "";
    const username = host.slice(0, -USER_MOONLIGHT_HOST_SUFFIX.length);
    if (!username) return "";
    return `https://${userTunnelHostname(username)}`;
  } catch {
    return "";
  }
}

module.exports = {
  USER_TUNNEL_HOST_SUFFIX,
  USER_MOONLIGHT_HOST_SUFFIX,
  userTunnelHostname,
  userMoonlightWebHostname,
  isUserTunnelHostname,
  isUserMoonlightWebHostname,
  moonlightWebPublicUrlFromApiBase,
  apiPublicUrlFromMoonlightWebUrl,
};
