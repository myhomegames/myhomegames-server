const {
  readBulkMetadataProgress,
  bulkMetadataReloadLogMiddleware,
  resetBulkMetadataReloadLogState,
} = require("../../utils/bulkMetadataReloadLog");

describe("bulkMetadataReloadLog", () => {
  beforeEach(() => {
    resetBulkMetadataReloadLogState();
  });

  describe("readBulkMetadataProgress", () => {
    it("returns null when bulk headers are missing", () => {
      expect(readBulkMetadataProgress({ headers: {} })).toBeNull();
    });

    it("parses valid bulk metadata headers", () => {
      expect(
        readBulkMetadataProgress({
          headers: {
            "x-mhg-bulk-metadata-step": "12",
            "x-mhg-bulk-metadata-total": "150",
            "x-mhg-bulk-metadata-phase": "games",
            "x-mhg-bulk-metadata-percent": "8",
          },
        }),
      ).toEqual({
        step: 12,
        total: 150,
        phase: "games",
        percent: 8,
      });
    });

    it("rejects invalid step/total pairs", () => {
      expect(
        readBulkMetadataProgress({
          headers: {
            "x-mhg-bulk-metadata-step": "200",
            "x-mhg-bulk-metadata-total": "150",
            "x-mhg-bulk-metadata-phase": "games",
          },
        }),
      ).toBeNull();
    });
  });

  describe("bulkMetadataReloadLogMiddleware", () => {
    it("logs progress once per step/phase and completion", () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const next = jest.fn();
        const makeReq = (step) => ({
          method: "POST",
          originalUrl: "/developers/dev-1/reload",
          headers: {
            "x-mhg-bulk-metadata-step": String(step),
            "x-mhg-bulk-metadata-total": "2",
            "x-mhg-bulk-metadata-phase": step === 2 ? "cache" : "developers",
            "x-mhg-bulk-metadata-percent": String(Math.round((step / 2) * 100)),
          },
        });

        bulkMetadataReloadLogMiddleware(makeReq(0), {}, next);
        bulkMetadataReloadLogMiddleware(makeReq(0), {}, next);
        bulkMetadataReloadLogMiddleware(makeReq(1), {}, next);
        bulkMetadataReloadLogMiddleware(makeReq(2), {}, next);

        expect(next).toHaveBeenCalledTimes(4);
        expect(logs.some((line) => line.includes("[bulk-metadata-reload] started"))).toBe(true);
        expect(logs.some((line) => line.includes("developers 1/2"))).toBe(true);
        expect(logs.some((line) => line.includes("[bulk-metadata-reload] completed"))).toBe(true);
        expect(logs.filter((line) => line.includes("developers 0/2")).length).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });
  });
});
