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
        const makeRes = () => ({
          statusCode: 200,
          on: jest.fn(),
        });

        bulkMetadataReloadLogMiddleware(makeReq(0), makeRes(), next);
        bulkMetadataReloadLogMiddleware(makeReq(0), makeRes(), next);
        bulkMetadataReloadLogMiddleware(makeReq(1), makeRes(), next);
        bulkMetadataReloadLogMiddleware(makeReq(2), makeRes(), next);

        expect(next).toHaveBeenCalledTimes(4);
        expect(logs.some((line) => line.includes("[bulk-metadata-reload] started"))).toBe(true);
        expect(logs.some((line) => line.includes("developers 1/2"))).toBe(true);
        expect(logs.some((line) => line.includes("[bulk-metadata-reload] completed"))).toBe(true);
        expect(logs.filter((line) => line.includes("developers 0/2")).length).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });

    it("logs failed bulk requests when response status is 4xx or 5xx", () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args);

      try {
        const next = jest.fn();
        const req = {
          method: "POST",
          originalUrl: "/developers/58892/merge-company-profile",
          headers: {
            "x-mhg-bulk-metadata-step": "64",
            "x-mhg-bulk-metadata-total": "7440",
            "x-mhg-bulk-metadata-phase": "developers",
            "x-mhg-bulk-metadata-percent": "1",
          },
        };
        const res = {
          statusCode: 404,
          on: jest.fn((event, handler) => {
            if (event === "finish") handler();
          }),
        };

        bulkMetadataReloadLogMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(warnings.some((args) => args[0] === "[bulk-metadata-reload] request failed")).toBe(true);
        expect(warnings.some((args) => args[1]?.url?.includes("58892"))).toBe(true);
        expect(warnings.some((args) => args[1]?.phase === "developers")).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});
