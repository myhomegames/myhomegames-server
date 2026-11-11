const {
  parseIdentifyResponse,
  resolveAiIdentifyConfig,
  resolveCandidateTitle,
  identifyGamesWithAi,
  packBatches,
  isRequestTooLargeError,
} = require("../../utils/aiGameIdentify");

describe("resolveAiIdentifyConfig", () => {
  test("disabled without API key", () => {
    const cfg = resolveAiIdentifyConfig({ OPENAI_API_KEY: "" });
    expect(cfg.enabled).toBe(false);
  });

  test("enabled with API key", () => {
    const cfg = resolveAiIdentifyConfig({
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-4o-mini",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.batchSize).toBe(4);
  });
});

describe("packBatches", () => {
  test("splits by batch size", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      absoluteIndex: i,
      sourceName: `g${i}`,
      tree: [`g${i}/`],
    }));
    const batches = packBatches(items, {
      batchSize: 4,
      maxTreeLines: 12,
      maxPromptChars: 14000,
    });
    expect(batches.map((b) => b.length)).toEqual([4, 4, 1]);
  });
});

describe("isRequestTooLargeError", () => {
  test("detects Groq 413 TPM message", () => {
    expect(
      isRequestTooLargeError({
        status: 413,
        message:
          "413 Request too large for model `openai/gpt-oss-20b` ... Limit 8000, Requested 8515",
      })
    ).toBe(true);
  });
});

describe("parseIdentifyResponse", () => {
  test("parses object array with year/platform/confidence", () => {
    const rows = parseIdentifyResponse(
      JSON.stringify([
        {
          index: 0,
          isGame: true,
          title: "Super Mario World",
          year: 1990,
          platform: "SNES",
          confidence: 0.95,
        },
        { index: 1, isGame: false, title: "", year: null, platform: null, confidence: 0.9 },
        {
          index: 2,
          isGame: true,
          title: "Doom",
          year: 1993,
          platform: "DOS",
          confidence: 1,
        },
      ]),
      3
    );
    expect(rows[0].title).toBe("Super Mario World");
    expect(rows[0].year).toBe(1990);
    expect(rows[0].platform).toBe("SNES");
    expect(rows[0].confidence).toBeCloseTo(0.95);
    expect(rows[1].isGame).toBe(false);
    expect(rows[2].title).toBe("Doom");
    expect(rows[2].platform).toBe("DOS");
  });

  test("still accepts legacy titles-only string array", () => {
    const rows = parseIdentifyResponse(
      JSON.stringify(["Super Mario World", "", "Doom"]),
      3
    );
    expect(rows[0].title).toBe("Super Mario World");
    expect(rows[0].isGame).toBe(true);
    expect(rows[1].isGame).toBe(false);
    expect(rows[2].title).toBe("Doom");
  });
});

describe("resolveCandidateTitle", () => {
  test("uses AI title as-is (no app-side rewrite)", () => {
    const resolved = resolveCandidateTitle(
      { title: "SMW" },
      { isGame: true, title: "Alone in the Dark", confidence: 0.9 }
    );
    expect(resolved.title).toBe("Alone in the Dark");
    expect(resolved.skip).toBe(false);
  });

  test("skips low confidence", () => {
    const resolved = resolveCandidateTitle(
      { title: "x" },
      { isGame: true, title: "Maybe Game", confidence: 0.2 }
    );
    expect(resolved.skip).toBe(true);
    expect(resolved.reason).toBe("low_confidence");
  });

  test("does not fall back to folder slug when AI title is missing", () => {
    const resolved = resolveCandidateTitle(
      { title: "aloneinthedark", sourceName: "aloneinthedark" },
      null
    );
    expect(resolved.skip).toBe(true);
    expect(resolved.reason).toBe("ai_not_a_game");
  });

  test("skips non-games per AI empty title", () => {
    const resolved = resolveCandidateTitle(
      { title: "bios" },
      { isGame: false, title: null, confidence: 0.9 }
    );
    expect(resolved.skip).toBe(true);
  });
});

describe("identifyGamesWithAi", () => {
  test("returns disabled when no key", async () => {
    const out = await identifyGamesWithAi([{ title: "X", filePath: "/x.nes", sourceName: "x.nes" }], {
      env: {},
    });
    expect(out.enabled).toBe(false);
  });

  test("prompt asks for year/platform/confidence fields", async () => {
    const create = jest.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                index: 0,
                isGame: true,
                title: "Fallout",
                year: 1997,
                platform: "PC",
                confidence: 0.97,
              },
            ]),
          },
        },
      ],
    }));
    await identifyGamesWithAi(
      [
        {
          title: "Fallout_1997",
          filePath: "/x",
          folderPath: "/games/Fallout_1997",
          sourceName: "Fallout_1997",
          tree: ["Fallout_1997/", "Fallout_1997/FALLOUT.EXE"],
        },
      ],
      {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
      }
    );
    const prompt = String(create.mock.calls[0][0].messages[1].content);
    expect(prompt).toMatch(/"year"/);
    expect(prompt).toMatch(/"platform"/);
    expect(prompt).toMatch(/confidence/);
    expect(prompt).toMatch(/aloneinthedark/);
  });

  test("retries with smaller batches on 413 Request too large", async () => {
    let calls = 0;
    const create = jest.fn(async ({ messages }) => {
      calls += 1;
      const prompt = String(messages[1].content);
      const count = (prompt.match(/^\d+\./gm) || []).length;
      if (count > 1) {
        const err = new Error(
          "413 Request too large ... Limit 8000, Requested 8515, please reduce your message size"
        );
        err.status = 413;
        throw err;
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  index: 0,
                  isGame: true,
                  title: "Game A",
                  year: 1995,
                  platform: "DOS",
                  confidence: 0.9,
                },
              ]),
            },
          },
        ],
      };
    });
    const out = await identifyGamesWithAi(
      [
        { title: "a", filePath: "/a", sourceName: "a", tree: ["a/"] },
        { title: "b", filePath: "/b", sourceName: "b", tree: ["b/"] },
      ],
      {
        env: { OPENAI_API_KEY: "sk-test" },
        batchSize: 2,
        client: { chat: { completions: { create } } },
      }
    );
    expect(out.used).toBe(true);
    expect(calls).toBeGreaterThan(1);
    expect(out.results[0].title).toBe("Game A");
    expect(out.results[0].year).toBe(1995);
    expect(out.results[1].title).toBe("Game A");
  });
});
