const {
  parseIgdbGamePayload,
  mergeIgdbGameMetadata,
  mergeStringArray,
  mergeAgeRatings,
  mergeSimilarGameIds,
  idsToAdd,
  devPubItemsToAdd,
  franchiseCollectionItemsToAdd,
} = require("../../utils/igdbGameMerge");

describe("parseIgdbGamePayload", () => {
  test("maps IGDB game response to local merge shape", () => {
    const parsed = parseIgdbGamePayload({
      summary: "A great game",
      releaseDateFull: { year: 2020, month: 3, day: 15, timestamp: 1584230400 },
      criticRating: 85,
      userRating: 72,
      cover: "https://images.igdb.com/cover.jpg",
      background: "https://images.igdb.com/bg.jpg",
      genres: ["Action", "Adventure"],
      themes: [{ id: 1, name: "Horror" }],
      websites: [{ url: "https://example.com", category: 1 }],
      ageRatings: [{ category: 1, rating: 5 }],
      developers: [{ id: 10, name: "Dev Co" }],
      similarGames: [{ id: 99, name: "Other Game" }],
      type: 0,
    });

    expect(parsed.summary).toBe("A great game");
    expect(parsed.year).toBe(2020);
    expect(parsed.month).toBe(3);
    expect(parsed.day).toBe(15);
    expect(parsed.criticratings).toBe(8.5);
    expect(parsed.userratings).toBe(7.2);
    expect(parsed.externalCoverUrl).toBe("https://images.igdb.com/cover.jpg");
    expect(parsed.genres).toEqual(["Action", "Adventure"]);
    expect(parsed.themes).toEqual(["Horror"]);
    expect(parsed.websites).toEqual(["https://example.com"]);
    expect(parsed.similarGames).toEqual([99]);
    expect(parsed.rawDevelopers).toEqual([{ id: 10, name: "Dev Co", logo: null, description: "" }]);
  });

  test("returns null for invalid payload", () => {
    expect(parseIgdbGamePayload(null)).toBeNull();
    expect(parseIgdbGamePayload("bad")).toBeNull();
  });
});

describe("merge helpers", () => {
  test("mergeStringArray appends only new strings", () => {
    const { value, changed } = mergeStringArray(["a"], ["a", "b"]);
    expect(changed).toBe(true);
    expect(value).toEqual(["a", "b"]);
  });

  test("mergeAgeRatings appends by category:rating key", () => {
    const { value, changed } = mergeAgeRatings(
      [{ category: 1, rating: 5 }],
      [{ category: 1, rating: 5 }, { category: 2, rating: 3 }]
    );
    expect(changed).toBe(true);
    expect(value).toEqual([
      { category: 1, rating: 5 },
      { category: 2, rating: 3 },
    ]);
  });

  test("mergeSimilarGameIds appends only new ids", () => {
    const { value, changed } = mergeSimilarGameIds([1], [1, 2, 3]);
    expect(changed).toBe(true);
    expect(value).toEqual([1, 2, 3]);
  });

  test("idsToAdd returns remote ids not in local", () => {
    expect(idsToAdd([1, 2], [2, 3, 4])).toEqual([3, 4]);
  });

  test("devPubItemsToAdd filters existing dev/pub ids", () => {
    const items = devPubItemsToAdd([10], [
      { id: 10, name: "Existing" },
      { id: 20, name: "New" },
    ]);
    expect(items).toEqual([{ id: 20, name: "New" }]);
  });

  test("franchiseCollectionItemsToAdd filters existing ids", () => {
    const items = franchiseCollectionItemsToAdd([5], [
      { id: 5, name: "Franchise A" },
      { id: 6, name: "Franchise B" },
    ]);
    expect(items).toEqual([{ id: 6, name: "Franchise B" }]);
  });
});

describe("mergeIgdbGameMetadata", () => {
  test("fills only missing local fields from IGDB payload", () => {
    const local = {
      id: 123,
      title: "Local Title",
      summary: "Existing summary",
      year: 2019,
      criticratings: 7.5,
      websites: ["https://existing.com"],
    };
    const igdbPayload = {
      name: "IGDB Title",
      summary: "IGDB summary",
      releaseDateFull: { year: 2020, month: 6, day: 1, timestamp: 1590969600 },
      criticRating: 90,
      userRating: 80,
      cover: "https://cover.jpg",
      websites: [{ url: "https://existing.com" }, { url: "https://new.com" }],
      keywords: ["rpg", "fantasy"],
      genres: ["Action"],
    };

    const { game, changed } = mergeIgdbGameMetadata(local, igdbPayload);

    expect(changed).toBe(true);
    expect(game.title).toBe("Local Title");
    expect(game.summary).toBe("Existing summary");
    expect(game.year).toBe(2019);
    expect(game.month).toBe(6);
    expect(game.day).toBe(1);
    expect(game.criticratings).toBe(7.5);
    expect(game.userratings).toBe(8);
    expect(game.externalCoverUrl).toBe("https://cover.jpg");
    expect(game.websites).toEqual(["https://existing.com", "https://new.com"]);
    expect(game.keywords).toEqual(["rpg", "fantasy"]);
  });

  test("returns unchanged when payload is invalid", () => {
    const local = { id: 1, title: "Game" };
    const { game, changed } = mergeIgdbGameMetadata(local, null);
    expect(changed).toBe(false);
    expect(game).toEqual(local);
  });
});
