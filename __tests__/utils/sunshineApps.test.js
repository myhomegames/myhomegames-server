jest.mock("../../utils/moonlightWebCredentials", () => ({
  requestJson: jest.fn(),
}));

const { requestJson } = require("../../utils/moonlightWebCredentials");
const {
  sunshineStreamingAppName,
  buildSunshineLaunchCmd,
  parseSunshineAppsPayload,
  resolveSunshineUpsertIndex,
  upsertSunshineStreamingApp,
} = require("../../utils/sunshineApps");

describe("sunshineApps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds prefixed app names", () => {
    expect(sunshineStreamingAppName("Hollow Knight")).toBe("MHG: Hollow Knight");
  });

  it("quotes launch commands with spaces", () => {
    expect(buildSunshineLaunchCmd("/tmp/my game/run.sh")).toBe('"/tmp/my game/run.sh"');
  });

  it("assigns array position as Sunshine app index", () => {
    const apps = parseSunshineAppsPayload(
      JSON.stringify({
        apps: [{ name: "Desktop" }, { name: "MHG: Test Game", cmd: "old" }],
      }),
    );
    expect(apps[0].index).toBe(0);
    expect(apps[1].index).toBe(1);
  });

  it("resolves upsert index by exact title only (new game creates a new entry)", () => {
    const apps = parseSunshineAppsPayload(
      JSON.stringify([
        { name: "Desktop" },
        { name: "MHG: Other" },
        { name: "MHG: Test Game" },
      ]),
    );
    expect(resolveSunshineUpsertIndex(apps, "MHG: Test Game")).toBe(2);
    expect(resolveSunshineUpsertIndex(apps, "MHG: New Game")).toBe(-1);
    expect(resolveSunshineUpsertIndex([{ name: "Desktop" }], "MHG: New Game")).toBe(-1);
  });

  it("creates a separate Sunshine app for a new game title", async () => {
    requestJson
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify([
          { name: "Desktop" },
          { name: "MHG: Other Game", cmd: "old" },
        ]),
      })
      .mockResolvedValueOnce({ statusCode: 200, body: "{}" })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify([
          { name: "Desktop" },
          { name: "MHG: Other Game", cmd: "old" },
          { name: "MHG: Test Game", cmd: "/games/run.sh" },
        ]),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify([
          { name: "Desktop" },
          { name: "MHG: Other Game", cmd: "old" },
          { name: "MHG: Test Game", cmd: "/games/run.sh" },
        ]),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify([
          { name: "Desktop" },
          { name: "MHG: Other Game", cmd: "old" },
          { name: "MHG: Test Game", cmd: "/games/run.sh" },
        ]),
      });

    await upsertSunshineStreamingApp({
      gameTitle: "Test Game",
      fullCommandPath: "/games/run.sh",
      env: {},
    });

    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          name: "MHG: Test Game",
          index: -1,
        }),
      }),
    );
  });

  it("updates an existing Sunshine app instead of appending", async () => {
    const singleAppList = JSON.stringify([
      { name: "Desktop", cmd: "" },
      { name: "MHG: Test Game", cmd: '"/games/run.sh"' },
    ]);

    requestJson
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify([
          { name: "Desktop", cmd: "" },
          { name: "MHG: Test Game", cmd: "old" },
        ]),
      })
      .mockResolvedValueOnce({ statusCode: 200, body: "{}" })
      .mockResolvedValueOnce({ statusCode: 200, body: singleAppList })
      .mockResolvedValueOnce({ statusCode: 200, body: singleAppList })
      .mockResolvedValueOnce({ statusCode: 200, body: singleAppList });

    const result = await upsertSunshineStreamingApp({
      gameTitle: "Test Game",
      fullCommandPath: "/games/run.sh",
      env: {},
    });

    expect(result.name).toBe("MHG: Test Game");
    expect(result.sunshineIndex).toBe(1);
    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          name: "MHG: Test Game",
          index: 1,
          cmd: "/games/run.sh",
        }),
      }),
    );
  });

  it("removes duplicate entries with the same app name", async () => {
    const duplicateList = JSON.stringify([
      { name: "Desktop" },
      { name: "MHG: Test Game", cmd: "a" },
      { name: "MHG: Test Game", cmd: "b" },
    ]);
    const dedupedList = JSON.stringify([
      { name: "Desktop" },
      { name: "MHG: Test Game", cmd: '"/games/run.sh"' },
    ]);

    requestJson
      .mockResolvedValueOnce({ statusCode: 200, body: duplicateList })
      .mockResolvedValueOnce({ statusCode: 200, body: "{}" })
      .mockResolvedValueOnce({ statusCode: 200, body: duplicateList })
      .mockResolvedValueOnce({ statusCode: 200, body: duplicateList })
      .mockResolvedValueOnce({ statusCode: 200, body: "{}" })
      .mockResolvedValueOnce({ statusCode: 200, body: dedupedList });

    await upsertSunshineStreamingApp({
      gameTitle: "Test Game",
      fullCommandPath: "/games/run.sh",
      env: {},
    });

    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        urlString: "https://127.0.0.1:47990/api/apps/2",
      }),
    );
  });
});
