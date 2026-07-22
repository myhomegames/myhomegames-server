"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { requestJson } = require("./moonlightWebCredentials");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";
const CONTAINER_CONFIG_PATH = "/moonlight-web/server/config.json";

/** Lower quality + websocket transport for Tizen / smart TV browsers. */
const MOONLIGHT_TV_STREAM_SETTINGS = {
  bitrate: 5000,
  fps: 30,
  videoSize: "720p",
  videoCodec: "h264",
  dataTransport: "websocket",
  canvasRenderer: true,
  forceVideoElementRenderer: false,
  hdr: false,
  enterFullscreenOnStreamStart: true,
};

const MOONLIGHT_TV_SETTINGS_JSON = JSON.stringify(MOONLIGHT_TV_STREAM_SETTINGS);

const MOONLIGHT_SETTINGS_LOAD_STOCK = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
        Object.assign(this.inputConfig, {`;

const MOONLIGHT_SETTINGS_LOAD_TV_PATCHED = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
        // MHG: smart TV / mhgProfile=tv - lower quality + websocket for weak browsers
        (() => {
            try {
                const profile = new URLSearchParams(window.location.search).get("mhgProfile");
                const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
                const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
                if (!isTv)
                    return;
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});
                try {
                    localStorage.setItem("mlSettings", JSON.stringify(settings));
                }
                catch (_e) { }
            }
            catch (_e) { }
        })();
        Object.assign(this.inputConfig, {`;

function shouldUseMoonlightTvProfile(search = "", userAgent = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (params.get("mhgProfile") === "tv") return true;
  return /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(
    String(userAgent || "").toLowerCase(),
  );
}

function listMoonlightUsers(baseUrl, cookie) {
  return requestJson({
    urlString: `${baseUrl}/api/users`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  }).then((response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`GET /api/users failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
    }
    const parsed = JSON.parse(response.body || "{}");
    return Array.isArray(parsed.users) ? parsed.users : [];
  });
}

function readDockerMoonlightConfig() {
  const raw = execFileSync("docker", ["exec", DOCKER_CONTAINER_NAME, "cat", CONTAINER_CONFIG_PATH], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return JSON.parse(raw);
}

function writeDockerMoonlightConfig(config) {
  const tmp = path.join(os.tmpdir(), `mhg-moonlight-config-${process.pid}.json`);
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    execFileSync("docker", ["cp", tmp, `${DOCKER_CONTAINER_NAME}:${CONTAINER_CONFIG_PATH}`], {
      stdio: "pipe",
      timeout: 30_000,
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function restartDockerMoonlight() {
  execFileSync("docker", ["restart", DOCKER_CONTAINER_NAME], {
    stdio: "pipe",
    timeout: 120_000,
  });
}

/**
 * Configure Moonlight Web so unauthenticated browsers use the admin user
 * (skips the login modal in the embed iframe).
 */
async function ensureMoonlightWebDefaultUser({
  baseUrl,
  cookie,
  username,
  kind = null,
  env = process.env,
} = {}) {
  if (env.MOONLIGHT_WEB_SKIP_DEFAULT_USER === "true") {
    return { applied: false, reason: "skipped" };
  }

  const users = await listMoonlightUsers(baseUrl, cookie);
  const preferredName = String(username || "").trim();
  const admin =
    users.find((user) => preferredName && user.name === preferredName) ||
    users.find((user) => user.role === "Admin") ||
    users[0];
  if (!admin?.id) {
    throw new Error("Moonlight Web admin user id not found");
  }

  if (kind !== "docker") {
    console.warn(
      "Moonlight Web default_user_id auto-config is currently supported for Docker installs only.",
    );
    return { applied: false, reason: "unsupported-kind", userId: admin.id };
  }

  let config;
  try {
    config = readDockerMoonlightConfig();
  } catch (error) {
    throw new Error(`Could not read Moonlight Web config: ${error.message || error}`);
  }

  const current = config?.web_server?.default_user_id;
  if (Number(current) === Number(admin.id)) {
    return { applied: false, reason: "already-configured", userId: admin.id };
  }

  config.web_server = {
    ...(config.web_server || {}),
    default_user_id: Number(admin.id),
  };
  writeDockerMoonlightConfig(config);
  console.log(`Moonlight Web default_user_id set to ${admin.id} (skip login in embed).`);
  restartDockerMoonlight();
  return { applied: true, userId: admin.id, restarted: true };
}

async function listMoonlightApps(baseUrl, cookie, hostId) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/apps?host_id=${encodeURIComponent(hostId)}`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 60_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/apps failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return Array.isArray(parsed.apps) ? parsed.apps : [];
}

function pickDesktopApp(apps) {
  if (!Array.isArray(apps) || apps.length === 0) return null;
  const byName = apps.find((app) => String(app.title || "").toLowerCase() === "desktop");
  if (byName) return byName;
  const byId = apps.find((app) => Number(app.app_id) === 0);
  if (byId) return byId;
  return apps[0];
}

/**
 * Build a Moonlight Web URL that opens the Sunshine Desktop stream directly.
 */
async function resolveMoonlightDesktopStreamUrl({
  baseUrl,
  cookie,
  hostId,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");
  if (hostId == null) throw new Error("Moonlight host_id is required");

  const apps = await listMoonlightApps(normalized, cookie, hostId);
  const desktop = pickDesktopApp(apps);
  if (!desktop || desktop.app_id == null) {
    throw new Error("Moonlight Web Desktop app not found on Sunshine host");
  }

  const url = new URL(`${normalized}/stream.html`);
  url.searchParams.set("hostId", String(hostId));
  url.searchParams.set("appId", String(desktop.app_id));
  return {
    url: url.toString(),
    hostId: Number(hostId),
    appId: Number(desktop.app_id),
    appTitle: desktop.title || "Desktop",
  };
}

/**
 * Attach mhgStop / mhgReturn so Moonlight Exit can stop the home game and leave Moonlight.
 * Prefer a public HTTPS API base (per-user tunnel), never localhost.
 * @param {string} streamUrl
 * @param {{ apiBase?: string, gameId?: string|number, executableName?: string, hostId?: number|null, returnUrl?: string }} [opts]
 */
function attachMoonlightStopHook(streamUrl, { apiBase, gameId, executableName, hostId, returnUrl } = {}) {
  const stream = String(streamUrl || "").trim();
  const api = String(apiBase || "").trim().replace(/\/$/, "");
  if (!stream || !api || gameId == null || gameId === "") return stream;
  try {
    const apiUrl = new URL(/^https?:\/\//i.test(api) ? api : `https://${api}`);
    if (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") {
      return stream;
    }
    const stop = new URL("/streaming/stop", apiUrl);
    stop.searchParams.set("gameId", String(gameId));
    if (executableName) stop.searchParams.set("executableName", String(executableName));
    if (hostId != null && Number.isFinite(Number(hostId))) {
      stop.searchParams.set("hostId", String(hostId));
    }
    const out = new URL(stream);
    out.searchParams.set("mhgStop", stop.toString());
    const ret = String(returnUrl || "").trim();
    if (ret && /^https?:\/\//i.test(ret)) {
      out.searchParams.set("mhgReturn", ret);
    }
    return out.toString();
  } catch {
    return stream;
  }
}

/** Shared Exit-button body used when patching Moonlight stream.js (must stay unique). */
const MOONLIGHT_EXIT_HANDLER_PATCHED = `this.exitStreamButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            try {
                const params = new URLSearchParams(window.location.search);
                const mhgStop = params.get("mhgStop");
                if (mhgStop) {
                    try {
                        yield fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                    catch (_postErr) {
                        yield fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                }
            }
            catch (e) {
                console.warn("mhgStop failed", e);
            }
            const stream = this.app.getStream();
            if (stream) {
                const success = yield stream.stop();
                if (!success) {
                    console.debug("Failed to close stream correctly");
                }
            }
            try {
                const msg = { type: "mhg-moonlight-exit" };
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage(msg, "*");
                }
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(msg, "*");
                }
            }
            catch (_msgErr) { }
            try {
                window.close();
            }
            catch (_closeErr) { }
            const mhgReturn = new URLSearchParams(window.location.search).get("mhgReturn");
            if (mhgReturn) {
                try {
                    window.location.replace(mhgReturn);
                    return;
                }
                catch (_retErr) { }
            }
            if (window.matchMedia('(display-mode: standalone)').matches) {
                history.back();
            }
        }));`;

const MOONLIGHT_EXIT_HANDLER_STOCK = `this.exitStreamButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            const stream = this.app.getStream();
            if (stream) {
                const success = yield stream.stop();
                if (!success) {
                    console.debug("Failed to close stream correctly");
                }
            }
            if (window.matchMedia('(display-mode: standalone)').matches) {
                history.back();
            }
            else {
                window.close();
            }
        }));`;

/** Previous MHG patch: stop worked, but mobile stayed on Moonlight (history.back / failed close). */
const MOONLIGHT_EXIT_HANDLER_LEGACY_MHG = `this.exitStreamButton.addEventListener("click", () => __awaiter(this, void 0, void 0, function* () {
            try {
                const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
                if (mhgStop) {
                    try {
                        yield fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                    catch (_postErr) {
                        yield fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                }
            }
            catch (e) {
                console.warn("mhgStop failed", e);
            }
            const stream = this.app.getStream();
            if (stream) {
                const success = yield stream.stop();
                if (!success) {
                    console.debug("Failed to close stream correctly");
                }
            }
            if (window.matchMedia('(display-mode: standalone)').matches) {
                history.back();
            }
            else {
                window.close();
            }
        }));`;

async function listMoonlightRoles(baseUrl, cookie) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/roles`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/roles failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return Array.isArray(parsed.roles) ? parsed.roles : [];
}

async function getMoonlightRole(baseUrl, cookie, roleId) {
  const qs = roleId != null ? `?id=${encodeURIComponent(roleId)}` : "";
  const response = await requestJson({
    urlString: `${baseUrl}/api/role${qs}`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/role failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return parsed.role || parsed;
}

/**
 * Force Moonlight Web to enable enterFullscreenOnStreamStart.
 * Role defaults alone are not enough: browser localStorage can override them, and
 * the shipped stream.js does not accept a query-param override. We also patch the
 * static JS inside the Docker container so auto-fullscreen is always armed.
 *
 * IMPORTANT: replacements must be unique and must not insert `yield` into non-generator
 * callbacks (that SyntaxError blank-screens the whole stream page).
 */
function patchMoonlightStaticFullscreenAssets() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mhg-ml-fs-"));
  const replacements = [
    {
      file: "default_settings.js",
      containerPath: "/moonlight-web/static/default_settings.js",
      replace: [
        ['"enterFullscreenOnStreamStart": false', '"enterFullscreenOnStreamStart": true'],
        ["enterFullscreenOnStreamStart: false", "enterFullscreenOnStreamStart: true"],
      ],
    },
    {
      file: "stream.js",
      containerPath: "/moonlight-web/static/stream.js",
      replace: [
        [
          "this.autoEnterFullscreenOnStart = settings.enterFullscreenOnStreamStart;",
          "this.autoEnterFullscreenOnStart = true;",
        ],
        [
          "this.autoEnterFullscreenOnStart=settings.enterFullscreenOnStreamStart;",
          "this.autoEnterFullscreenOnStart=true;",
        ],
        // Smart TV / mhgProfile=tv: cap quality and prefer websocket over flaky WebRTC.
        [MOONLIGHT_SETTINGS_LOAD_STOCK, MOONLIGHT_SETTINGS_LOAD_TV_PATCHED],
        // Unique block after connection modal.
        // Skip AutoFullscreenModal (OK/Cancel): browsers still need a user gesture, so
        // arm fullscreen on the next tap instead of showing a confirm dialog.
        // Also drop pendingAutoFullscreenPrompt from the guard (Moonlight sets it AFTER
        // showModal, so a fast connection can skip arming forever).
        [
          `void showModal(connectionInfo).then(() => __awaiter(this, void 0, void 0, function* () {
                this.stream.removeInfoListener(connectionInfoListener);
                if (this.autoEnterFullscreenOnStart && this.pendingAutoFullscreenPrompt && !this.fullscreenPromptShown && !this.isFullscreen()) {
                    this.fullscreenPromptShown = true;
                    this.pendingAutoFullscreenPrompt = false;
                    this.armFullscreenOnNextInteraction();
                }
            }));`,
          `void showModal(connectionInfo).then(() => __awaiter(this, void 0, void 0, function* () {
                this.stream.removeInfoListener(connectionInfoListener);
                if (this.autoEnterFullscreenOnStart && !this.fullscreenPromptShown && !this.isFullscreen()) {
                    this.fullscreenPromptShown = true;
                    this.pendingAutoFullscreenPrompt = false;
                    this.armFullscreenOnNextInteraction();
                }
            }));`,
        ],
        // Migrate previous MHG patch that showed the confirm modal.
        [
          `void showModal(connectionInfo).then(() => __awaiter(this, void 0, void 0, function* () {
                this.stream.removeInfoListener(connectionInfoListener);
                if (this.autoEnterFullscreenOnStart && !this.fullscreenPromptShown && !this.isFullscreen()) {
                    this.fullscreenPromptShown = true;
                    this.pendingAutoFullscreenPrompt = false;
                    yield this.promptAutoFullscreen();
                    if (!this.isFullscreen()) {
                        this.armFullscreenOnNextInteraction();
                    }
                }
            }));`,
          `void showModal(connectionInfo).then(() => __awaiter(this, void 0, void 0, function* () {
                this.stream.removeInfoListener(connectionInfoListener);
                if (this.autoEnterFullscreenOnStart && !this.fullscreenPromptShown && !this.isFullscreen()) {
                    this.fullscreenPromptShown = true;
                    this.pendingAutoFullscreenPrompt = false;
                    this.armFullscreenOnNextInteraction();
                }
            }));`,
        ],
        // On Exit: stop home game (mhgStop), notify MHG tab (postMessage), close popup,
        // else navigate to mhgReturn (mobile often ignores window.close / history.back stays in Moonlight).
        [MOONLIGHT_EXIT_HANDLER_STOCK, MOONLIGHT_EXIT_HANDLER_PATCHED],
        [MOONLIGHT_EXIT_HANDLER_LEGACY_MHG, MOONLIGHT_EXIT_HANDLER_PATCHED],
        // Migrate earlier POST-only mhgStop hook to POST+GET fallback (partial older patches).
        [
          `const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
                if (mhgStop) {
                    yield fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" });
                }`,
          `const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
                if (mhgStop) {
                    try {
                        yield fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                    catch (_postErr) {
                        yield fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" });
                    }
                }`,
        ],
        // Browser/system Back (and tab close): same stop as Exit + notify MHG tab.
        // Migrate previous MHG pagehide hook (no postMessage) first, then patch stock startApp().
        [
          `startApp();
// MHG: stop home game when leaving via browser Back / tab close (not only Exit).
(() => {
    const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
    if (!mhgStop)
        return;
    let sent = false;
    const send = () => {
        if (sent)
            return;
        sent = true;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                navigator.sendBeacon(mhgStop);
            }
        }
        catch (_beaconErr) { }
        try {
            fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => {
                fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => { });
            });
        }
        catch (_fetchErr) { }
    };
    window.addEventListener("pagehide", send);
    window.addEventListener("popstate", send);
})();`,
          `startApp();
// MHG: stop home game when leaving via browser Back / tab close (not only Exit).
(() => {
    const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
    if (!mhgStop)
        return;
    let sent = false;
    const send = () => {
        if (sent)
            return;
        sent = true;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                navigator.sendBeacon(mhgStop);
            }
        }
        catch (_beaconErr) { }
        try {
            fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => {
                fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => { });
            });
        }
        catch (_fetchErr) { }
        try {
            const msg = { type: "mhg-moonlight-exit" };
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage(msg, "*");
            }
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(msg, "*");
            }
        }
        catch (_msgErr) { }
    };
    window.addEventListener("pagehide", send);
    window.addEventListener("popstate", send);
})();`,
        ],
        [
          `startApp();`,
          `startApp();
// MHG: stop home game when leaving via browser Back / tab close (not only Exit).
(() => {
    const mhgStop = new URLSearchParams(window.location.search).get("mhgStop");
    if (!mhgStop)
        return;
    let sent = false;
    const send = () => {
        if (sent)
            return;
        sent = true;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                navigator.sendBeacon(mhgStop);
            }
        }
        catch (_beaconErr) { }
        try {
            fetch(mhgStop, { method: "POST", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => {
                fetch(mhgStop, { method: "GET", mode: "cors", keepalive: true, credentials: "omit" }).catch(() => { });
            });
        }
        catch (_fetchErr) { }
        try {
            const msg = { type: "mhg-moonlight-exit" };
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage(msg, "*");
            }
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(msg, "*");
            }
        }
        catch (_msgErr) { }
    };
    window.addEventListener("pagehide", send);
    window.addEventListener("popstate", send);
})();`,
        ],
      ],
    },
  ];

  let applied = 0;
  try {
    for (const entry of replacements) {
      const hostPath = path.join(tmpDir, entry.file);
      try {
        execFileSync("docker", ["cp", `${DOCKER_CONTAINER_NAME}:${entry.containerPath}`, hostPath], {
          stdio: "pipe",
          timeout: 30_000,
        });
      } catch {
        continue;
      }
      let body = fs.readFileSync(hostPath, "utf8");
      let changed = false;
      for (const [from, to] of entry.replace) {
        if (body.includes(to)) continue;
        if (!body.includes(from)) continue;
        body = body.replace(from, to);
        changed = true;
      }
      if (!changed) continue;
      fs.writeFileSync(hostPath, body, "utf8");
      execFileSync("docker", ["cp", hostPath, `${DOCKER_CONTAINER_NAME}:${entry.containerPath}`], {
        stdio: "pipe",
        timeout: 30_000,
      });
      applied += 1;
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return { applied };
}

async function ensureMoonlightEnterFullscreenDefault({ baseUrl, cookie, kind = null } = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");

  const result = {
    rolePatched: false,
    staticPatched: 0,
    roleId: null,
  };

  if (kind === "docker" || kind == null) {
    try {
      const staticResult = patchMoonlightStaticFullscreenAssets();
      result.staticPatched = staticResult.applied;
      if (staticResult.applied > 0) {
        console.log(
          `Moonlight Web static assets patched for fullscreen (${staticResult.applied} replacement(s)).`,
        );
      }
    } catch (error) {
      console.warn(
        `Could not patch Moonlight Web static fullscreen assets: ${error.message || error}`,
      );
    }
  }

  let role = null;
  try {
    role = await getMoonlightRole(normalized, cookie);
  } catch {
    const roles = await listMoonlightRoles(normalized, cookie);
    role = roles.find((item) => item?.ty === "Admin" || item?.type === "Admin") || roles[0] || null;
    if (role?.id != null) {
      role = await getMoonlightRole(normalized, cookie, role.id);
    }
  }
  if (!role?.id) {
    if (result.staticPatched > 0) return { applied: true, ...result };
    throw new Error("Moonlight role not found for fullscreen default");
  }
  result.roleId = role.id;

  const currentDefaults =
    role.default_settings && typeof role.default_settings === "object"
      ? role.default_settings
      : {};
  if (currentDefaults.enterFullscreenOnStreamStart !== true) {
    const roleType = role.ty || role.type;
    if (!roleType) {
      throw new Error("Moonlight role type missing for fullscreen default");
    }
    const nextDefaults = {
      ...currentDefaults,
      enterFullscreenOnStreamStart: true,
    };
    const response = await requestJson({
      urlString: `${normalized}/api/role`,
      method: "PATCH",
      body: { id: role.id, ty: roleType, default_settings: nextDefaults },
      headers: cookie ? { Cookie: cookie } : {},
      timeoutMs: 30_000,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `PATCH /api/role failed (${response.statusCode}): ${response.body.slice(0, 200)}`,
      );
    }
    result.rolePatched = true;
    console.log("Moonlight Web role default: enterFullscreenOnStreamStart=true");
  }

  return {
    applied: result.rolePatched || result.staticPatched > 0,
    ...result,
  };
}

module.exports = {
  ensureMoonlightWebDefaultUser,
  ensureMoonlightEnterFullscreenDefault,
  resolveMoonlightDesktopStreamUrl,
  attachMoonlightStopHook,
  listMoonlightApps,
  pickDesktopApp,
  listMoonlightUsers,
  readDockerMoonlightConfig,
  writeDockerMoonlightConfig,
  restartDockerMoonlight,
  patchMoonlightStaticFullscreenAssets,
  shouldUseMoonlightTvProfile,
  MOONLIGHT_TV_STREAM_SETTINGS,
};
