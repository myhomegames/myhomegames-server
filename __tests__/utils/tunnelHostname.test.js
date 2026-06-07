"use strict";

const {
  userTunnelHostname,
  isUserTunnelHostname,
  migrateUserTunnelPublicUrl,
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

  it("migrates legacy nested subdomain", () => {
    expect(migrateUserTunnelPublicUrl("https://myhomegames.myhomegames-server.vige.it")).toBe(
      "https://myhomegames-myhomegames-server.vige.it",
    );
  });

  it("migrates interim -api hostname", () => {
    expect(migrateUserTunnelPublicUrl("https://luca-api.vige.it")).toBe(
      "https://luca-myhomegames-server.vige.it",
    );
  });

  it("leaves manager host unchanged", () => {
    expect(migrateUserTunnelPublicUrl("https://myhomegames-server.vige.it")).toBe(
      "https://myhomegames-server.vige.it",
    );
  });
});
