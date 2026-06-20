const { mapIgdbCompanyToInfo } = require("../../utils/igdbCompany");

describe("mapIgdbCompanyToInfo", () => {
  test("maps IGDB company fields to stored info", () => {
    const info = mapIgdbCompanyToInfo({
      id: 1,
      status: { name: "Renamed" },
      changed_company_id: { id: 2, name: "3D Realms" },
      country: 840,
      change_date: 820454400,
      change_date_format: 2,
    });

    expect(info).toEqual({
      status: "Renamed",
      updatedTo: { id: 2, name: "3D Realms" },
      country: "United States of America",
      changedOn: "1996",
    });
  });

  test("returns null when company has no display fields", () => {
    expect(mapIgdbCompanyToInfo({ id: 1 })).toBeNull();
    expect(mapIgdbCompanyToInfo(null)).toBeNull();
  });
});
