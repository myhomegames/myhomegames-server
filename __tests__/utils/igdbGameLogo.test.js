"use strict";

const {
  pickBestLogoArtwork,
  logoUrlFromArtworks,
  buildIgdbImageUrl,
} = require("../../utils/igdbGameLogo");

describe("igdbGameLogo", () => {
  test("prefers color over white/black", () => {
    const best = pickBestLogoArtwork([
      { image_id: "white", artwork_type: 5, alpha_channel: true, width: 800, height: 200 },
      { image_id: "color", artwork_type: 7, alpha_channel: false, width: 400, height: 100 },
      { image_id: "black", artwork_type: 6, alpha_channel: true, width: 900, height: 300 },
    ]);
    expect(best.image_id).toBe("color");
  });

  test("prefers alpha within same type", () => {
    const best = pickBestLogoArtwork([
      { image_id: "opaque", artwork_type: 5, alpha_channel: false, width: 1000, height: 200 },
      { image_id: "transparent", artwork_type: 5, alpha_channel: true, width: 500, height: 100 },
    ]);
    expect(best.image_id).toBe("transparent");
  });

  test("logoUrlFromArtworks uses png when alpha", () => {
    expect(
      logoUrlFromArtworks([{ image_id: "abc", artwork_type: 7, alpha_channel: true }]),
    ).toBe("https://images.igdb.com/igdb/image/upload/t_1080p/abc.png");
  });

  test("logoUrlFromArtworks ignores non-logo artworks", () => {
    expect(logoUrlFromArtworks([{ image_id: "bg", artwork_type: 1 }])).toBeNull();
  });

  test("buildIgdbImageUrl defaults to jpg", () => {
    expect(buildIgdbImageUrl("xyz")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_1080p/xyz.jpg",
    );
  });
});
