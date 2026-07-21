const { pickDesktopApp } = require("../../utils/moonlightWebEmbed");

describe("moonlightWebEmbed", () => {
  it("prefers Desktop app by title then app_id 0", () => {
    expect(
      pickDesktopApp([
        { app_id: 3, title: "Steam" },
        { app_id: 1, title: "Desktop" },
      ]),
    ).toEqual({ app_id: 1, title: "Desktop" });
    expect(pickDesktopApp([{ app_id: 0, title: "Desktop" }])).toEqual({
      app_id: 0,
      title: "Desktop",
    });
    expect(pickDesktopApp([{ app_id: 9, title: "Other" }])).toEqual({
      app_id: 9,
      title: "Other",
    });
    expect(pickDesktopApp([])).toBeNull();
  });
});
