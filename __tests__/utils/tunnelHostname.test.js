"use strict";

const {
  userTunnelHostname,
  isUserTunnelHostname,
} = require("../../utils/tunnelHostname");

describe("tunnelHostname", () => {
  it("builds per-user hostname under vige.it", () => {
    expect(userTunnelHostname("myhomegames")).toBe("myhomegames-myhomegames-server.vige.it");
    expect(userTunnelHostname("luca")).toBe("luca-myhomegames-server.vige.it");
  });

  it("detects user tunnel hostnames", () => {
    expect(isUserTunnelHostname("luca-myhomegames-server.vige.it")).toBe(true);
    expect(isUserTunnelHostname("myhomegames.myhomegames-server.vige.it")).toBe(false);
    expect(isUserTunnelHostname("myhomegames-server.vige.it")).toBe(false);
  });
});
