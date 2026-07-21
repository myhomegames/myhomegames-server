"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  writeMoonlightIceServerScript,
  resolveIceScriptHostPath,
  CONTAINER_SCRIPT_PATH,
} = require("../../utils/moonlightWebTurn");

describe("moonlightWebTurn", () => {
  it("writes an executable ice_server_script that curls the local API", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ice-"));
    try {
      const scriptPath = writeMoonlightIceServerScript(dir, { httpPort: 4123 });
      expect(scriptPath).toBe(resolveIceScriptHostPath(dir));
      const body = fs.readFileSync(scriptPath, "utf8");
      expect(body).toContain("host.docker.internal:4123/streaming/turn-ice-servers");
      expect(CONTAINER_SCRIPT_PATH).toContain("ice_servers_cf.sh");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
