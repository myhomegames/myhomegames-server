"use strict";

const {
  isCloudflareTurnConfigured,
  resolveTunnelManagerUrl,
  filterBrowserSafeTurnUrls,
  toMoonlightIceServers,
  DEFAULT_TUNNEL_MANAGER_URL,
} = require("../../utils/cloudflareTurn");

describe("cloudflareTurn", () => {
  it("is enabled by default (secrets live on the tunnel manager Worker)", () => {
    expect(isCloudflareTurnConfigured({})).toBe(true);
    expect(isCloudflareTurnConfigured({ CLOUDFLARE_TURN_ENABLED: "false" })).toBe(false);
  });

  it("resolves tunnel manager URL", () => {
    expect(resolveTunnelManagerUrl({})).toBe(DEFAULT_TUNNEL_MANAGER_URL);
    expect(
      resolveTunnelManagerUrl({
        CLOUDFLARE_TUNNEL_MANAGER_URL: "https://manager.example/",
      }),
    ).toBe("https://manager.example");
  });

  it("filters TURN URLs on port 53 (blocked in browsers)", () => {
    expect(
      filterBrowserSafeTurnUrls([
        "turn:example.cloudflare.com:3478?transport=udp",
        "turn:example.cloudflare.com:53?transport=tcp",
        "turns:example.cloudflare.com:5349?transport=tcp",
      ]),
    ).toEqual([
      "turn:example.cloudflare.com:3478?transport=udp",
      "turns:example.cloudflare.com:5349?transport=tcp",
    ]);
  });

  it("normalizes Cloudflare generate-ice-servers payload for Moonlight", () => {
    const iceServers = toMoonlightIceServers({
      iceServers: [
        {
          urls: [
            "stun:stun.cloudflare.com:3478",
            "turn:turn.cloudflare.com:53?transport=tcp",
            "turn:turn.cloudflare.com:3478?transport=udp",
          ],
          username: "u",
          credential: "c",
        },
        { urls: [] },
      ],
    });
    expect(iceServers).toEqual([
      {
        urls: [
          "stun:stun.cloudflare.com:3478",
          "turn:turn.cloudflare.com:3478?transport=udp",
        ],
        username: "u",
        credential: "c",
      },
    ]);
  });
});
