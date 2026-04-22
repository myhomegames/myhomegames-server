const { coerceToGameTypeId } = require("../../utils/igdbGameType");

describe("coerceToGameTypeId", () => {
  test("returns null for null and undefined", () => {
    expect(coerceToGameTypeId(null)).toBeNull();
    expect(coerceToGameTypeId(undefined)).toBeNull();
  });

  test("returns number for finite numeric id", () => {
    expect(coerceToGameTypeId(0)).toBe(0);
    expect(coerceToGameTypeId(14)).toBe(14);
  });

  test("accepts legacy { id } shape", () => {
    expect(coerceToGameTypeId({ id: 3 })).toBe(3);
    expect(coerceToGameTypeId({ id: 7, name: "Season" })).toBe(7);
  });

  test("returns null for invalid input", () => {
    expect(coerceToGameTypeId("1")).toBeNull();
    expect(coerceToGameTypeId({})).toBeNull();
    expect(coerceToGameTypeId({ id: "x" })).toBeNull();
  });
});
