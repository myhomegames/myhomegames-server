const {
  readPackageVersion,
  buildServerInfo,
} = require("../utils/compatibility");

describe("compatibility utils", () => {
  test("readPackageVersion reads server package.json", () => {
    const version = readPackageVersion(__dirname + "/..");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("buildServerInfo includes package version", () => {
    const info = buildServerInfo(__dirname + "/..");
    expect(info).toMatchObject({
      name: "myhomegames-server",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(info).not.toHaveProperty("apiCompatibility");
  });
});
