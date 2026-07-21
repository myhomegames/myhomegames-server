const http = require("http");
const {
  resolveSunshineAddressForMoonlight,
  extractPin,
  parseNdjson,
  hostLooksPaired,
  addressesMatch,
  ensureMoonlightWebSunshinePairing,
} = require("../../utils/moonlightWebPairing");

describe("moonlightWebPairing", () => {
  it("uses host.docker.internal for docker kind without LAN hint", () => {
    expect(resolveSunshineAddressForMoonlight({ kind: "docker", env: {} })).toBe(
      "host.docker.internal",
    );
  });

  it("prefers WEBRTC_NAT_1TO1_HOST for docker kind", () => {
    expect(
      resolveSunshineAddressForMoonlight({
        kind: "docker",
        env: { WEBRTC_NAT_1TO1_HOST: "192.168.0.81" },
      }),
    ).toBe("192.168.0.81");
  });

  it("uses localhost for native kind", () => {
    expect(resolveSunshineAddressForMoonlight({ kind: "native", env: {} })).toBe("127.0.0.1");
  });

  it("parses Pin and Paired NDJSON messages", () => {
    expect(extractPin({ Pin: "4821" })).toBe("4821");
    expect(hostLooksPaired({ paired: "Paired" })).toBe(true);
    expect(hostLooksPaired({ paired: "NotPaired" })).toBe(false);
    expect(addressesMatch("127.0.0.1", "localhost")).toBe(true);
    expect(addressesMatch("127.0.0.1", "host.docker.internal")).toBe(false);
    expect(parseNdjson('{"hosts":[]}\n{"host_id":1,"paired":"Paired"}\n')).toEqual([
      { hosts: [] },
      { host_id: 1, paired: "Paired" },
    ]);
  });

  it("adds host, pairs with PIN, and submits PIN to Sunshine", async () => {
    let sunshinePin = null;
    const hosts = [];

    const moonlight = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/hosts") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(
          `${JSON.stringify({
            hosts: hosts.map((h) => ({
              host_id: h.host_id,
              name: h.name,
              paired: h.paired,
              owner: "ThisUser",
              server_state: "Free",
            })),
          })}\n`,
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/host") {
        const hostId = Number(url.searchParams.get("host_id"));
        const host = hosts.find((h) => h.host_id === hostId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ host }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/host") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          const host = {
            host_id: 7,
            name: "Sunshine",
            paired: "NotPaired",
            address: parsed.address,
            http_port: parsed.http_port,
            https_port: 47990,
            external_port: 47989,
            version: "1",
            gfe_version: "1",
            unique_id: "abc",
            mac: null,
            local_ip: parsed.address,
            current_game: 0,
            max_luma_pixels_hevc: 0,
            server_codec_mode_support: 0,
            owner: "ThisUser",
            server_state: "Free",
          };
          hosts.push(host);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ host }));
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/pair") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ Pin: "1337" })}\n`);
        setTimeout(() => {
          const host = hosts[0];
          host.paired = "Paired";
          res.end(`${JSON.stringify({ Paired: host })}\n`);
        }, 80);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const sunshine = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/pin") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          sunshinePin = JSON.parse(body);
          expect(req.headers.authorization).toMatch(/^Basic /);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: true }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => moonlight.listen(0, "127.0.0.1", resolve));
    await new Promise((resolve) => sunshine.listen(0, "127.0.0.1", resolve));
    const moonlightPort = moonlight.address().port;
    const sunshinePort = sunshine.address().port;

    try {
      const result = await ensureMoonlightWebSunshinePairing({
        baseUrl: `http://127.0.0.1:${moonlightPort}`,
        cookie: "mlSession=test",
        kind: "native",
        env: {
          SUNSHINE_API_BASE: `http://127.0.0.1:${sunshinePort}`,
          SUNSHINE_USERNAME: "sunshine",
          SUNSHINE_PASSWORD: "admin",
          MOONLIGHT_WEB_CLIENT_NAME: "MyHomeGames",
        },
      });

      expect(result).toEqual({
        paired: true,
        hostId: 7,
        alreadyPaired: false,
        host: expect.objectContaining({ host_id: 7, paired: "Paired" }),
      });
      expect(sunshinePin).toEqual({ pin: "1337", name: "MyHomeGames" });
      expect(hosts[0].paired).toBe("Paired");
    } finally {
      await new Promise((resolve) => moonlight.close(resolve));
      await new Promise((resolve) => sunshine.close(resolve));
    }
  });

  it("skips pairing when host is already Paired", async () => {
    const moonlight = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/hosts") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(
          `${JSON.stringify({
            hosts: [
              {
                host_id: 3,
                name: "Sunshine",
                paired: "Paired",
                owner: "ThisUser",
                server_state: "Free",
              },
            ],
          })}\n`,
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/host") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            host: {
              host_id: 3,
              paired: "Paired",
              address: "127.0.0.1",
              local_ip: "127.0.0.1",
              name: "Sunshine",
            },
          }),
        );
        return;
      }
      res.writeHead(500);
      res.end("unexpected");
    });

    await new Promise((resolve) => moonlight.listen(0, "127.0.0.1", resolve));
    const { port } = moonlight.address();
    try {
      const result = await ensureMoonlightWebSunshinePairing({
        baseUrl: `http://127.0.0.1:${port}`,
        cookie: "mlSession=test",
        kind: "native",
        env: {},
      });
      expect(result).toEqual({ paired: true, hostId: 3, alreadyPaired: true });
    } finally {
      await new Promise((resolve) => moonlight.close(resolve));
    }
  });
});
