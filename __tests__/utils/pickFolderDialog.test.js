const {
  pickFolderDialog,
  normalizePickedPath,
} = require("../../utils/pickFolderDialog");

describe("normalizePickedPath", () => {
  test("trims trailing separators", () => {
    expect(normalizePickedPath("/Users/me/Games/")).toBe("/Users/me/Games");
    expect(normalizePickedPath("C:\\Games\\")).toBe("C:\\Games");
  });
});

describe("pickFolderDialog", () => {
  test("returns selected path on macOS", () => {
    const spawnSync = jest.fn(() => ({
      status: 0,
      stdout: "/Users/me/Games/\n",
      error: null,
    }));
    const result = pickFolderDialog({ platform: "darwin", spawnSync });
    expect(result.folderPath).toBe("/Users/me/Games");
    expect(spawnSync).toHaveBeenCalled();
    const script = String(spawnSync.mock.calls[0][1][1] || "");
    // Must not use dual `on error` handlers (AppleScript syntax error).
    expect(script.match(/\bon error\b/g) || []).toHaveLength(1);
  });

  test("treats empty stdout as cancelled on macOS", () => {
    const spawnSync = jest.fn(() => ({ status: 0, stdout: "", error: null }));
    const result = pickFolderDialog({ platform: "darwin", spawnSync });
    expect(result.cancelled).toBe(true);
    expect(result.folderPath).toBeNull();
  });

  test("surfaces osascript failures instead of silent cancel", () => {
    const spawnSync = jest.fn(() => ({
      status: 1,
      stdout: "",
      stderr: 'syntax error: Expected "end" but found "on". (-2741)\n',
      error: null,
    }));
    const result = pickFolderDialog({ platform: "darwin", spawnSync });
    expect(result.folderPath).toBeNull();
    expect(result.cancelled).toBeUndefined();
    expect(result.error).toMatch(/syntax error/i);
  });

  test("uses zenity on linux when available", () => {
    const spawnSync = jest.fn((cmd) => {
      if (cmd === "zenity") {
        return { status: 0, stdout: "/home/me/roms\n", error: null };
      }
      return { status: 127, stdout: "", error: new Error("missing") };
    });
    const result = pickFolderDialog({ platform: "linux", spawnSync });
    expect(result.folderPath).toBe("/home/me/roms");
  });
});
