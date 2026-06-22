const {
  mapIgdbCompanyToInfo,
  pickRenamedPredecessorCompany,
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
      formerly: { id: 13, name: "Mattel Media" },
      parentCompany: { id: 99, name: "Mattel" },
    });
  });

  test("maps formerly from company_type_histories.company when parent_company is absent", () => {
    const info = mapIgdbCompanyToInfo({
      id: 10,
      company_type_histories: [
        {
          company_type: { name: "Formerly" },
          company: { id: 13, name: "Mattel Media" },
        },
      ],
    });

    expect(info).toEqual({
      formerly: { id: 13, name: "Mattel Media" },
    });
  });

  test("maps formerly when parent_company is the current company", () => {
    const info = mapIgdbCompanyToInfo({
      id: 10,
      company_type_histories: [
        {
          company_type: { name: "Formerly" },
          company: { id: 13, name: "Mattel Media" },
          parent_company: { id: 10, name: "Capcom U.S.A." },
        },
      ],
    });

    expect(info).toEqual({
      formerly: { id: 13, name: "Mattel Media" },
    });
  });

  test("keeps only the first formerly entry from company_type_histories", () => {
    const info = mapIgdbCompanyToInfo({
      id: 10,
      company_type_histories: [
        {
          company_type: { name: "Formerly" },
          parent_company: { id: 13, name: "Mattel Media" },
        },
        {
          company_type: { name: "Formerly" },
          parent_company: { id: 14, name: "Old Name" },
        },
      ],
    });

    expect(info).toEqual({
      formerly: { id: 13, name: "Mattel Media" },
    });
  });

  test("returns null when company has no display fields", () => {
    expect(mapIgdbCompanyToInfo({ id: 1 })).toBeNull();
    expect(mapIgdbCompanyToInfo(null)).toBeNull();
  });

  test("maps company size and legal name from description for Capcom-like companies", () => {
    const info = mapIgdbCompanyToInfo({
      id: 37,
      name: "Capcom",
      status: { name: "active" },
      country: 392,
      start_date: 296870400,
      start_date_format: 0,
      company_size: { id: 7, name: "1001-5000 employees" },
      description:
        "Capcom Co., Ltd. is a Japanese video game company. It has created a number of critically acclaimed franchises.",
    });

    expect(info).toEqual({
      status: "active",
      country: "Japan",
      started: "1979-05-30",
      companySize: "1001-5000 employees",
      companySizeId: 7,
      legalName: "Capcom Co., Ltd.",
    });
  });
});

describe("pickRenamedPredecessorCompany", () => {
  test("returns only the most recent renamed predecessor with id", () => {
    const company = pickRenamedPredecessorCompany([
      { id: 20, name: "The Learning Company", status: { name: "Merge" }, change_date: 900000000 },
      { id: 13, name: "Mattel Media", status: { name: "Renamed" }, change_date: 800000000 },
      { id: 14, name: "Older Name", status: { name: "Renamed" }, change_date: 700000000 },
    ]);

    expect(company).toEqual({ id: 13, name: "Mattel Media" });
  });

  test("returns merged predecessors such as Flagship for Capcom", () => {
    const company = pickRenamedPredecessorCompany([
      { id: 41283, name: "Flagship", status: { name: "merged" }, change_date: 1180656000 },
    ]);

    expect(company).toEqual({ id: 41283, name: "Flagship" });
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
      companySize: "51-200 employees",
      formerly: { id: 13, name: "Mattel Media" },
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
      companySize: "51-200 employees",
      formerly: { id: 13, name: "Mattel Media" },
      parentCompany: { id: 99, name: "Mattel" },
      updatedTo: { id: 99, name: "New Co" },
    });
  });

  test("does not overwrite existing formerly fields", () => {
    const local = {
      formerly: { id: 1, name: "Keep Formerly" },
    };
    const remote = {
      formerly: { id: 2, name: "Replace Formerly" },
      legalName: "Legal Co",
    };

    const { info, changed } = mergeIgdbCompanyInfo(local, remote);

    expect(changed).toBe(true);
    expect(info).toEqual({
      formerly: { id: 1, name: "Keep Formerly" },
      legalName: "Legal Co",
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
