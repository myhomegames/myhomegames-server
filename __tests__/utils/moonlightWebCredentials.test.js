const http = require("http");
const {
  resolveBootstrapCredentials,
  ensureMoonlightWebAdminCredentials,
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
