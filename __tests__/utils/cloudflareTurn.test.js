"use strict";

const {
  isCloudflareTurnConfigured,
  filterBrowserSafeTurnUrls,
  toMoonlightIceServers,
} = require("../../utils/cloudflareTurn");

describe("cloudflareTurn", () => {
  it("detects TURN configuration from env", () => {
    expect(isCloudflareTurnConfigured({})).toBe(false);
    expect(
      isCloudflareTurnConfigured({
        CLOUDFLARE_TURN_KEY_ID: "key",
        CLOUDFLARE_TURN_API_TOKEN: "token",
      }),
    ).toBe(true);
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
