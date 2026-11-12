const {
  parseIdentifyResponse,
  parseSkeletonIdentifyResponse,
  resolveAiIdentifyConfig,
  isAiFolderImportEnabled,
  resolveCandidateTitle,
  identifyGamesWithAi,
  identifyGamesFromSkeleton,
  packBatches,
  isRequestTooLargeError,
  candidateIdentifyKey,
  dedupeCandidatesForIdentify,
  buildIdentifyPrompt,
} = require("../../utils/aiGameIdentify");
const {
  loadAiIdentifyCache,
  saveAiIdentifyCache,
  readCacheEntry,
  writeCacheEntry,
} = require("../../utils/aiIdentifyCache");
const fs = require("fs");
const os = require("os");
const path = require("path");

function mockReq(headers) {
  return {
    header(name) {
      return headers[name] || headers[name.toLowerCase()] || "";
    },
  };
}

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
    expect(cfg.batchSize).toBe(12);
    expect(cfg.maxTreeLines).toBe(1);
  });

  test("tunnel mode uses gateway headers only (ignores env key)", () => {
    const cfg = resolveAiIdentifyConfig(
      {
        CLOUDFLARE_TUNNEL_ENABLED: "true",
        OPENAI_API_KEY: "sk-env-should-be-ignored",
      },
      {
        req: mockReq({
          "X-OpenAI-Api-Key": "sk-from-worker",
          "X-OpenAI-Base-Url": "https://api.groq.com/openai/v1",
          "X-OpenAI-Model": "openai/gpt-oss-20b",
        }),
      }
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe("sk-from-worker");
    expect(cfg.baseURL).toBe("https://api.groq.com/openai/v1");
    expect(cfg.model).toBe("openai/gpt-oss-20b");
    expect(cfg.source).toBe("gateway-headers");
  });

  test("tunnel mode without headers is disabled even if env has a key", () => {
    const cfg = resolveAiIdentifyConfig(
      {
        CLOUDFLARE_TUNNEL_ENABLED: "true",
        OPENAI_API_KEY: "sk-env-only",
      },
      { req: mockReq({}) }
    );
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBeNull();
  });
});

describe("isAiFolderImportEnabled", () => {
  test("tunnel uses X-MHG-Ai-Configured without exposing a key", () => {
    expect(
      isAiFolderImportEnabled(mockReq({ "X-MHG-Ai-Configured": "true" }), {
        CLOUDFLARE_TUNNEL_ENABLED: "true",
      })
    ).toBe(true);
    expect(
      isAiFolderImportEnabled(mockReq({ "X-MHG-Ai-Configured": "false" }), {
        CLOUDFLARE_TUNNEL_ENABLED: "true",
      })
    ).toBe(false);
  });

  test("local uses env key", () => {
    expect(
      isAiFolderImportEnabled(mockReq({}), { OPENAI_API_KEY: "sk-local" })
    ).toBe(true);
    expect(isAiFolderImportEnabled(mockReq({}), { OPENAI_API_KEY: "" })).toBe(false);
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

  test("prompt asks for year/platform/confidence and uses name-only by default", async () => {
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
          relativePath: "games/Fallout_1997",
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
    expect(prompt).toMatch(/games\/Fallout_1997/);
    expect(prompt).not.toMatch(/FALLOUT\.EXE/);
  });

  test("dedupes identical keys and reuses cache entries", async () => {
    const create = jest.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                index: 0,
                isGame: true,
                title: "Doom",
                year: 1993,
                platform: "DOS",
                confidence: 0.99,
              },
            ]),
          },
        },
      ],
    }));
    const cache = { version: 1, entries: {} };
    writeCacheEntry(cache, "quake", {
      isGame: true,
      title: "Quake",
      year: 1996,
      platform: "DOS",
      confidence: 0.95,
    });
    const out = await identifyGamesWithAi(
      [
        { sourceName: "doom", filePath: "/a/doom", relativePath: "games/doom" },
        { sourceName: "DOOM", filePath: "/b/DOOM", relativePath: "games/DOOM" },
        { sourceName: "quake", filePath: "/c/quake", relativePath: "games/quake" },
      ],
      {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
        cache,
        readCacheEntry,
        writeCacheEntry,
      }
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.stats.cacheHits).toBe(1);
    expect(out.stats.deduped).toBe(1);
    expect(out.stats.sent).toBe(1);
    expect(out.results[0].title).toBe("Doom");
    expect(out.results[1].title).toBe("Doom");
    expect(out.results[2].title).toBe("Quake");
    expect(out.results[2].fromCache).toBe(true);
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

describe("candidateIdentifyKey / dedupe", () => {
  test("normalizes basename keys", () => {
    expect(candidateIdentifyKey({ sourceName: "Alone_In_The_Dark" })).toBe("aloneinthedark");
    expect(candidateIdentifyKey({ sourceName: "doom.exe" })).toBe("doom");
  });

  test("dedupeCandidatesForIdentify groups by key", () => {
    const { unique, membersOf } = dedupeCandidatesForIdentify([
      { absoluteIndex: 0, identifyKey: "doom", sourceName: "doom" },
      { absoluteIndex: 1, identifyKey: "quake", sourceName: "quake" },
      { absoluteIndex: 2, identifyKey: "doom", sourceName: "DOOM" },
    ]);
    expect(unique).toHaveLength(2);
    expect(membersOf[0]).toEqual([0, 2]);
    expect(membersOf[1]).toEqual([1]);
  });
});

describe("buildIdentifyPrompt", () => {
  test("name-only when maxTreeLines is 1", () => {
    const prompt = buildIdentifyPrompt(
      [
        {
          relativePath: "games/aloneinthedark",
          sourceName: "aloneinthedark",
          tree: ["aloneinthedark/", "aloneinthedark/AITD.EXE"],
        },
      ],
      { maxTreeLines: 1 }
    );
    expect(prompt).toContain("0. games/aloneinthedark");
    expect(prompt).not.toContain("AITD.EXE");
  });
});

describe("aiIdentifyCache", () => {
  test("persists and reloads entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ai-cache-"));
    const cache = loadAiIdentifyCache(dir);
    writeCacheEntry(cache, "fallout", {
      isGame: true,
      title: "Fallout",
      year: 1997,
      platform: "PC",
      confidence: 0.9,
    });
    saveAiIdentifyCache(dir, cache);
    const reloaded = loadAiIdentifyCache(dir);
    const hit = readCacheEntry(reloaded, "fallout");
    expect(hit.title).toBe("Fallout");
    expect(hit.year).toBe(1997);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("identifyGamesFromSkeleton", () => {
  test("parses skeleton JSON and maps absolute paths", () => {
    const root = path.join("/tmp", "dosprograms");
    const games = parseSkeletonIdentifyResponse(
      JSON.stringify([
        {
          path: "dosprograms/games/alleycat",
          title: "Alley Cat",
          year: 1983,
          platform: "DOS",
          confidence: 0.95,
        },
      ]),
      root
    );
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("Alley Cat");
    expect(games[0].absPath).toBe(path.join(root, "games", "alleycat"));
  });

  test("sends brace-compressed skeleton chunk to the model", async () => {
    const create = jest.fn(async ({ messages }) => {
      const prompt = String(messages[1].content);
      expect(prompt).toMatch(/parent\/\{a,b,c\}/);
      expect(prompt).toMatch(/dosprograms\/games\/alleycat\/\{CAT\.EXE,README\.TXT\}/);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  path: "dosprograms/games/alleycat",
                  title: "Alley Cat",
                  year: 1983,
                  platform: "DOS",
                  confidence: 0.9,
                },
              ]),
            },
          },
        ],
      };
    });
    const out = await identifyGamesFromSkeleton(
      {
        rootPath: path.join("/tmp", "dosprograms"),
        rootName: "dosprograms",
        chunks: ["dosprograms/games/alleycat/{CAT.EXE,README.TXT}"],
      },
      {
        env: { OPENAI_API_KEY: "sk-test" },
        client: { chat: { completions: { create } } },
      }
    );
    expect(out.used).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.games[0].title).toBe("Alley Cat");
    expect(out.stats.chunks).toBe(1);
  });
});
