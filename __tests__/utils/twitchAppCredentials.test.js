"use strict";

const {
  resolveTwitchAppCredentials,
  requireTwitchAppCredentials,
  IGDB_CREDENTIALS_ERROR,
} = require("../../utils/twitchAppCredentials");

function mockReq(headers = {}, query = {}) {
  return {
    header(name) {
      return headers[name];
    },
    query,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("twitchAppCredentials", () => {
  test("resolveTwitchAppCredentials reads only headers", () => {
    const creds = resolveTwitchAppCredentials(
      mockReq(
        {
          "X-Twitch-Client-Id": "hdr-id",
          "X-Twitch-Client-Secret": "hdr-secret",
        },
        { clientId: "ignored", clientSecret: "ignored" }
      )
    );
    expect(creds).toEqual({ clientId: "hdr-id", clientSecret: "hdr-secret" });
  });

  test("resolveTwitchAppCredentials ignores query parameters", () => {
    const creds = resolveTwitchAppCredentials(
      mockReq({}, { clientId: "q-id", clientSecret: "q-secret" })
    );
    expect(creds).toEqual({ clientId: "", clientSecret: "" });
  });

  test("requireTwitchAppCredentials returns null and 400 when headers missing", () => {
    const res = mockRes();
    const out = requireTwitchAppCredentials(mockReq({}), res);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe(IGDB_CREDENTIALS_ERROR);
  });
});
