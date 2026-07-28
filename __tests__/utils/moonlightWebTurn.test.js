"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  writeMoonlightIceServerScript,
  writeMoonlightIceServersJson,
  resolveIceScriptHostPath,
  resolveIceJsonHostPath,
  moonlightContainerHasIceBindMounts,
  refreshMoonlightTurnIceServers,
  CONTAINER_SCRIPT_PATH,
  CONTAINER_JSON_PATH,
} = require("../../utils/moonlightWebTurn");

jest.mock("../../utils/cloudflareTurn", () => ({
  isCloudflareTurnConfigured: jest.fn(() => true),
  generateCloudflareTurnIceServers: jest.fn(async () => ({
    iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }],
  })),
}));

jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
}));

describe("moonlightWebTurn", () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

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

  it("detects bind-mounted ICE files in the Moonlight container", () => {
    execFileSync.mockReturnValue(
      JSON.stringify([
        { Destination: CONTAINER_SCRIPT_PATH },
        { Destination: CONTAINER_JSON_PATH },
      ]),
    );
    expect(moonlightContainerHasIceBindMounts()).toBe(true);
  });

  it("refreshes TURN ICE by writing host files only when bind mounts are present", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-refresh-"));
    execFileSync.mockReturnValue(
      JSON.stringify([
        { Destination: CONTAINER_SCRIPT_PATH },
        { Destination: CONTAINER_JSON_PATH },
      ]),
    );
    try {
      const result = await refreshMoonlightTurnIceServers({ installDir: dir, kind: "docker", env: {} });
      expect(result.applied).toBe(true);
      expect(result.viaBindMount).toBe(true);
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(execFileSync.mock.calls[0][0]).toBe("docker");
      expect(execFileSync.mock.calls[0][1]).toEqual(
        expect.arrayContaining(["inspect", "-f", "{{json .Mounts}}", "myhomegames-moonlight-web"]),
      );
      expect(fs.existsSync(resolveIceJsonHostPath(dir))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
