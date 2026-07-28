const http = require("http");
const {
  resolveBootstrapCredentials,
  ensureMoonlightWebAdminCredentials,
  requestMoonlightWebJson,
  isMoonlightWebAuthError,
  resolveMoonlightWebApiCookie,
  DEFAULT_USERNAME,
  DEFAULT_PASSWORD,
} = require("../../utils/moonlightWebCredentials");

describe("moonlightWebCredentials", () => {
  it("defaults to sunshine/admin", () => {
    expect(resolveBootstrapCredentials({})).toEqual({
      username: DEFAULT_USERNAME,
      password: DEFAULT_PASSWORD,
    });
  });

  it("allows env overrides", () => {
    expect(
      resolveBootstrapCredentials({
        MOONLIGHT_WEB_USERNAME: "custom",
        MOONLIGHT_WEB_PASSWORD: "secret",
      }),
    ).toEqual({ username: "custom", password: "secret" });
  });

  it("detects stale Moonlight session auth failures", () => {
    expect(isMoonlightWebAuthError(401, "the host was not found")).toBe(true);
    expect(isMoonlightWebAuthError(400, "hex error occured: Invalid string length")).toBe(true);
    expect(isMoonlightWebAuthError(404, "not found")).toBe(false);
  });

  it("prefers anonymous API cookie for Docker installs", () => {
    expect(
      resolveMoonlightWebApiCookie({
        kind: "docker",
        sessionCookie: "mlSession=abc",
      }),
    ).toBe("");
    expect(
      resolveMoonlightWebApiCookie({
        kind: "native",
        sessionCookie: "mlSession=abc",
      }),
    ).toBe("mlSession=abc");
  });

  it("retries Moonlight API without stale cookie after 401", async () => {
    let hostsCalls = 0;
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/hosts") {
        hostsCalls += 1;
        const cookie = req.headers.cookie || "";
        if (cookie.includes("stale")) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("the host was not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end('{"hosts":[]}\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      const response = await requestMoonlightWebJson({
        baseUrl: `http://127.0.0.1:${port}`,
        urlString: `http://127.0.0.1:${port}/api/hosts`,
        method: "GET",
        cookie: "mlSession=stale",
      });
      expect(response.statusCode).toBe(200);
      expect(hostsCalls).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("bootstraps admin via POST /api/login on first login", async () => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/login") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          expect(parsed).toEqual({ name: "sunshine", password: "admin" });
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": "mlSession=abc123; Path=/; HttpOnly",
          });
          res.end("{}");
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      const result = await ensureMoonlightWebAdminCredentials(`http://127.0.0.1:${port}`);
      expect(result.applied).toBe(true);
      expect(result.username).toBe("sunshine");
      expect(result.cookie).toContain("mlSession=");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
