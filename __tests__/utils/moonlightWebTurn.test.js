"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  writeMoonlightIceServerScript,
  writeMoonlightIceServersJson,
  resolveIceScriptHostPath,
  resolveIceJsonHostPath,
  CONTAINER_SCRIPT_PATH,
  CONTAINER_JSON_PATH,
} = require("../../utils/moonlightWebTurn");

describe("moonlightWebTurn", () => {
  it("writes an ice_server_script that cats host-minted JSON (no curl)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-"));
    try {
      const scriptPath = writeMoonlightIceServerScript(dir);
      expect(scriptPath).toBe(resolveIceScriptHostPath(dir));
      const body = fs.readFileSync(scriptPath, "utf8");
      expect(body).toContain(`cat "${CONTAINER_JSON_PATH}"`);
      expect(body).not.toContain("curl");
      expect(CONTAINER_SCRIPT_PATH).toContain("ice_servers_cf.sh");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes ice_servers.json for the container bind mount", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-json-"));
    try {
      const servers = [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }];
      const jsonPath = writeMoonlightIceServersJson(dir, servers);
      expect(jsonPath).toBe(resolveIceJsonHostPath(dir));
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual(servers);
      expect(CONTAINER_JSON_PATH).toContain("ice_servers.json");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
