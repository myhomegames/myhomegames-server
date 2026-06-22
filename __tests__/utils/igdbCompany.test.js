const {
  mapIgdbCompanyToInfo,
  mergeIgdbCompanyInfo,
  pickCompanyByTitle,
} = require("../../utils/igdbCompany");

describe("mapIgdbCompanyToInfo", () => {
  test("maps IGDB company fields to stored info", () => {
    const info = mapIgdbCompanyToInfo({
      id: 1,
      status: { name: "Renamed" },
      changed_company_id: { id: 2, name: "3D Realms" },
      country: 840,
      change_date: 820454400,
      change_date_format: 2,
      start_date: 315532800,
      start_date_format: 2,
    });

    expect(info).toEqual({
      status: "Renamed",
      updatedTo: { id: 2, name: "3D Realms" },
      country: "United States of America",
      changedOn: "1996",
      started: "1980",
    });
  });

  test("maps company type histories and parent company", () => {
    const info = mapIgdbCompanyToInfo({
      id: 10,
      start_date: 315532800,
      start_date_format: 2,
      parent: { id: 99, name: "Mattel" },
      company_type_histories: [
        {
          company_type: { name: "Known as" },
          parent_company: { id: 11, name: "Capcom USA" },
        },
        {
          company_type: { name: "Legal name" },
          parent_company: { id: 12, name: "Capcom U.S.A., Inc." },
        },
        {
          company_type: { name: "Formerly" },
          parent_company: { id: 13, name: "Mattel Media" },
        },
        {
          company_type: { name: "Parent company" },
          parent_company: { id: 99, name: "Mattel" },
        },
      ],
    });

    expect(info).toEqual({
      started: "1980",
      knownAs: "Capcom USA",
      legalName: "Capcom U.S.A., Inc.",
      formerly: "Mattel Media",
      parentCompany: { id: 99, name: "Mattel" },
    });
  });

  test("returns null when company has no display fields", () => {
    expect(mapIgdbCompanyToInfo({ id: 1 })).toBeNull();
    expect(mapIgdbCompanyToInfo(null)).toBeNull();
  });
});

describe("mergeIgdbCompanyInfo", () => {
  test("fills only missing local fields from remote", () => {
    const local = {
      status: "Active",
      country: "Japan",
    };
    const remote = {
      status: "Defunct",
      country: "United States of America",
      changedOn: "2020",
      started: "1980",
      knownAs: "Capcom USA",
      legalName: "Capcom U.S.A., Inc.",
      formerly: "Mattel Media",
      parentCompany: { id: 99, name: "Mattel" },
      updatedTo: { id: 99, name: "New Co" },
    };

    const { info, changed } = mergeIgdbCompanyInfo(local, remote);

    expect(changed).toBe(true);
    expect(info).toEqual({
      status: "Active",
      country: "Japan",
      changedOn: "2020",
      started: "1980",
      knownAs: "Capcom USA",
      legalName: "Capcom U.S.A., Inc.",
      formerly: "Mattel Media",
      parentCompany: { id: 99, name: "Mattel" },
      updatedTo: { id: 99, name: "New Co" },
    });
  });

  test("does not overwrite existing parentCompany fields", () => {
    const local = {
      parentCompany: { id: 1, name: "Keep Parent" },
    };
    const remote = {
      parentCompany: { id: 2, name: "Replace Parent" },
      legalName: "Legal Co",
    };

    const { info, changed } = mergeIgdbCompanyInfo(local, remote);

    expect(changed).toBe(true);
    expect(info).toEqual({
      parentCompany: { id: 1, name: "Keep Parent" },
      legalName: "Legal Co",
    });
  });

  test("does not overwrite existing nested updatedTo fields", () => {
    const local = {
      updatedTo: { id: 1, name: "Keep Me" },
    };
    const remote = {
      updatedTo: { id: 2, name: "Replace Me" },
      status: "Merge",
    };

    const { info, changed } = mergeIgdbCompanyInfo(local, remote);

    expect(changed).toBe(true);
    expect(info).toEqual({
      updatedTo: { id: 1, name: "Keep Me" },
      status: "Merge",
    });
  });

  test("returns unchanged when remote is empty", () => {
    const local = { status: "Active" };
    const { info, changed } = mergeIgdbCompanyInfo(local, null);

    expect(changed).toBe(false);
    expect(info).toEqual({ status: "Active" });
  });
});

describe("pickCompanyByTitle", () => {
  test("matches company by exact normalized title", () => {
    const companies = [
      { id: 1, name: "Nintendo" },
      { id: 2, name: "Ubisoft Entertainment" },
    ];
    expect(pickCompanyByTitle(companies, " Ubisoft Entertainment ")).toEqual(companies[1]);
    expect(pickCompanyByTitle(companies, "Sony")).toBeNull();
  });
});
