const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  hasSunshineWebCredentials,
  resolveBootstrapCredentials,
  resolveSunshineStatePath,
  DEFAULT_USERNAME,
  DEFAULT_PASSWORD,
} = require("../../utils/sunshineCredentials");

describe("sunshineCredentials", () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sunshine-creds-test-"));
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it("detects missing credentials when state file is absent", () => {
    expect(hasSunshineWebCredentials(path.join(tempDir, "missing.json"))).toBe(false);
  });

  it("detects configured credentials", () => {
    const statePath = path.join(tempDir, "sunshine_state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({ username: "sunshine", password: "hash", salt: "x" }),
      "utf8",
    );
    expect(hasSunshineWebCredentials(statePath)).toBe(true);
  });

  it("treats empty username as unconfigured", () => {
    const statePath = path.join(tempDir, "sunshine_state.json");
    fs.writeFileSync(statePath, JSON.stringify({ username: "", password: "hash" }), "utf8");
    expect(hasSunshineWebCredentials(statePath)).toBe(false);
  });

  it("uses default sunshine/admin credentials", () => {
    expect(resolveBootstrapCredentials({})).toEqual({
      username: DEFAULT_USERNAME,
      password: DEFAULT_PASSWORD,
    });
  });

  it("allows env overrides for username/password", () => {
    expect(
      resolveBootstrapCredentials({
        SUNSHINE_USERNAME: "custom",
        SUNSHINE_PASSWORD: "secret",
      }),
    ).toEqual({ username: "custom", password: "secret" });
  });

  it("resolves state path under SUNSHINE_CONFIG_DIR", () => {
    expect(resolveSunshineStatePath({ SUNSHINE_CONFIG_DIR: tempDir })).toBe(
      path.join(tempDir, "sunshine_state.json"),
    );
  });
});
