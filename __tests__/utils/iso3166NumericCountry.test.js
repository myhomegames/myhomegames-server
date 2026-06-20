const { countryNameFromIso3166Numeric } = require("../../utils/iso3166NumericCountry");

describe("countryNameFromIso3166Numeric", () => {
  test("resolves United States numeric code", () => {
    expect(countryNameFromIso3166Numeric(840)).toBe("United States of America");
  });

  test("returns null for invalid code", () => {
    expect(countryNameFromIso3166Numeric(null)).toBeNull();
    expect(countryNameFromIso3166Numeric(999999)).toBeNull();
  });
});
