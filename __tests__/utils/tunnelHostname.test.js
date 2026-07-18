"use strict";

const {
  userTunnelHostname,
  userMoonlightWebHostname,
  isUserTunnelHostname,
  isUserMoonlightWebHostname,
  moonlightWebPublicUrlFromApiBase,
} = require("../../utils/tunnelHostname");

describe("tunnelHostname", () => {
  it("builds per-user hostname under vige.it", () => {
    expect(userTunnelHostname("myhomegames")).toBe("myhomegames-myhomegames-server.vige.it");
    expect(userTunnelHostname("luca")).toBe("luca-myhomegames-server.vige.it");
  });

  it("builds per-user Moonlight Web hostname", () => {
    expect(userMoonlightWebHostname("luca")).toBe("luca-moonlight-web.vige.it");
  });

  it("detects user tunnel hostnames", () => {
    expect(isUserTunnelHostname("luca-myhomegames-server.vige.it")).toBe(true);
    expect(isUserTunnelHostname("myhomegames.myhomegames-server.vige.it")).toBe(false);
    expect(isUserTunnelHostname("myhomegames-server.vige.it")).toBe(false);
  });

  it("detects Moonlight Web hostnames", () => {
    expect(isUserMoonlightWebHostname("luca-moonlight-web.vige.it")).toBe(true);
    expect(isUserMoonlightWebHostname("luca-myhomegames-server.vige.it")).toBe(false);
  });

  it("derives public Moonlight Web URL from API_BASE", () => {
    expect(
      moonlightWebPublicUrlFromApiBase("https://luca-myhomegames-server.vige.it"),
    ).toBe("https://luca-moonlight-web.vige.it");
    expect(moonlightWebPublicUrlFromApiBase("http://127.0.0.1:4000")).toBe("");
    expect(moonlightWebPublicUrlFromApiBase("")).toBe("");
  });
});
