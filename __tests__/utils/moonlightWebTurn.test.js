"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  writeMoonlightIceServerScript,
  writeMoonlightIceServersJson,
  resolveIceScriptHostPath,
  resolveIceJsonHostPath,
  refreshMoonlightTurnIceServers,
} = require("../../utils/moonlightWebTurn");

jest.mock("../../utils/cloudflareTurn", () => ({
  isCloudflareTurnConfigured: jest.fn(() => true),
  generateCloudflareTurnIceServers: jest.fn(async () => ({
    iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }],
  })),
}));

describe("moonlightWebTurn", () => {
  it("writes an ice_server_script that cats the package JSON (no curl)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-"));
    try {
      const jsonPath = resolveIceJsonHostPath(dir);
      const scriptPath = writeMoonlightIceServerScript(dir, jsonPath);
      expect(scriptPath).toBe(resolveIceScriptHostPath(dir));
      const body = fs.readFileSync(scriptPath, "utf8");
      expect(body).toContain(`cat "${jsonPath}"`);
      expect(body).not.toContain("curl");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes ice_servers.json next to the Moonlight package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-json-"));
    try {
      const servers = [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }];
      const jsonPath = writeMoonlightIceServersJson(dir, servers);
      expect(jsonPath).toBe(resolveIceJsonHostPath(dir));
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual(servers);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refreshes TURN ICE by writing files into the package server directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-refresh-"));
    const packageRoot = path.join(dir, "package");
    fs.mkdirSync(packageRoot);
    try {
      const result = await refreshMoonlightTurnIceServers({
        installDir: dir,
        packageRoot,
        env: {},
      });
      expect(result.applied).toBe(true);
      const jsonPath = path.join(packageRoot, "server", "ice_servers.json");
      const scriptPath = path.join(packageRoot, "server", "ice_servers_cf.sh");
      expect(result.jsonPath).toBe(jsonPath);
      expect(result.scriptPath).toBe(scriptPath);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.readFileSync(scriptPath, "utf8")).toContain(`cat "${jsonPath}"`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
