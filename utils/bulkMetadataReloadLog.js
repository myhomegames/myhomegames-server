/** @typedef {{ step: number, total: number, phase: string, percent: number }} BulkMetadataProgress */

let lastLoggedKey = null;
let bulkRunActive = false;

/**
 * @param {import('express').Request} req
 * @returns {BulkMetadataProgress | null}
 */
function readBulkMetadataProgress(req) {
  const stepRaw = req.headers["x-mhg-bulk-metadata-step"];
  const totalRaw = req.headers["x-mhg-bulk-metadata-total"];
  const phase = req.headers["x-mhg-bulk-metadata-phase"];
  const percentRaw = req.headers["x-mhg-bulk-metadata-percent"];

  if (stepRaw == null || totalRaw == null || typeof phase !== "string" || !phase.trim()) {
    return null;
  }

  const step = Number.parseInt(String(stepRaw), 10);
  const total = Number.parseInt(String(totalRaw), 10);
  const percent = Number.parseInt(String(percentRaw ?? ""), 10);

  if (!Number.isFinite(step) || !Number.isFinite(total) || total <= 0 || step < 0 || step > total) {
    return null;
  }

  return {
    step,
    total,
    phase: phase.trim(),
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : Math.round((step / total) * 100),
  };
}

/**
 * Express middleware: logs bulk "Aggiorna tutti i metadati" progress from client headers.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function bulkMetadataReloadLogMiddleware(req, res, next) {
  const progress = readBulkMetadataProgress(req);
  const hasBulkHeaders =
    req.headers["x-mhg-bulk-metadata-step"] != null ||
    req.headers["x-mhg-bulk-metadata-total"] != null ||
    req.headers["x-mhg-bulk-metadata-phase"] != null;

  if (hasBulkHeaders && !progress) {
    console.warn("[bulk-metadata-reload] invalid bulk headers", {
      method: req.method,
      url: req.originalUrl || req.url,
      step: req.headers["x-mhg-bulk-metadata-step"],
      total: req.headers["x-mhg-bulk-metadata-total"],
      phase: req.headers["x-mhg-bulk-metadata-phase"],
      percent: req.headers["x-mhg-bulk-metadata-percent"],
    });
  }

  if (!progress) {
    next();
    return;
  }

  if (typeof res.on === "function") {
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        console.warn("[bulk-metadata-reload] request failed", {
          status: res.statusCode,
          method: req.method,
          url: req.originalUrl || req.url,
          phase: progress.phase,
          step: progress.step,
          total: progress.total,
          percent: progress.percent,
        });
      }
    });
  }

  const key = `${progress.step}/${progress.total}/${progress.phase}`;
  if (key !== lastLoggedKey) {
    if (!bulkRunActive && progress.step === 0) {
      console.log(
        `[bulk-metadata-reload] started (${progress.total} steps) — ${req.method} ${req.originalUrl || req.url}`,
      );
      bulkRunActive = true;
    }

    console.log(
      `[bulk-metadata-reload] ${progress.phase} ${progress.step}/${progress.total} (${progress.percent}%) — ${req.method} ${req.originalUrl || req.url}`,
    );
    lastLoggedKey = key;

    if (progress.step >= progress.total) {
      console.log("[bulk-metadata-reload] completed");
      bulkRunActive = false;
      lastLoggedKey = null;
    }
  }

  next();
}

/** Reset dedupe state (tests). */
function resetBulkMetadataReloadLogState() {
  lastLoggedKey = null;
  bulkRunActive = false;
}

module.exports = {
  bulkMetadataReloadLogMiddleware,
  readBulkMetadataProgress,
  resetBulkMetadataReloadLogState,
};
