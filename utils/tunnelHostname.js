"use strict";

/** Per-user API host under vige.it (one label → covered by Universal SSL *.vige.it). */
const USER_TUNNEL_HOST_SUFFIX = "-myhomegames-server.vige.it";

function userTunnelHostname(username) {
  return `${String(username || "").trim()}${USER_TUNNEL_HOST_SUFFIX}`;
}

function isUserTunnelHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "myhomegames-server.vige.it") return false;
  return host.endsWith(USER_TUNNEL_HOST_SUFFIX);
}

module.exports = {
  USER_TUNNEL_HOST_SUFFIX,
  userTunnelHostname,
  isUserTunnelHostname,
};
