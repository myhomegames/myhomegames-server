"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { requestMoonlightWebJson } = require("./moonlightWebCredentials");
const { MHG_SUNSHINE_APP_PREFIX } = require("./sunshineApps");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";
const CONTAINER_CONFIG_PATH = "/moonlight-web/server/config.json";

/** Lower quality + WebRTC video element for Tizen / smart TV browsers.
 *  Do NOT use websocket+canvas: Tizen often paints one frame then freezes while audio plays.
 *  forceVideoElementRenderer only works with WebRTC (videotrack), per Moonlight pipeline.js.
 */
const MOONLIGHT_TV_STREAM_SETTINGS = {
  bitrate: 5000,
  fps: 30,
  videoSize: "720p",
  videoCodec: "h264",
  dataTransport: "webrtc",
  canvasRenderer: false,
  forceVideoElementRenderer: true,
  hdr: false,
  enterFullscreenOnStreamStart: true,
};

const MOONLIGHT_TV_SETTINGS_JSON = JSON.stringify(MOONLIGHT_TV_STREAM_SETTINGS);

/** Cache-bust nested Moonlight ES modules (Tizen keeps bare import URLs forever). */
const MOONLIGHT_MODULE_CACHE_BUST = "mhg=33";
const MOONLIGHT_MODULE_ALIAS = "mhg33";
/** Physical entry script — Tizen ignores ?query on modules and often caches stream.html body. */
const MOONLIGHT_STREAM_ENTRY = `stream.${MOONLIGHT_MODULE_ALIAS}.js`;
/**
 * HTML under a versioned folder so Tizen fetches a fresh document, while the
 * pathname still ends with `stream.html` (required by released MHG web).
 */
const MOONLIGHT_STREAM_HTML_PATH = `${MOONLIGHT_MODULE_ALIAS}/stream.html`;
/** Absolute boot module loaded before the app — patches Stream even if entry wrap fails. */
const MOONLIGHT_BOOT_ENTRY = `mhg-boot.${MOONLIGHT_MODULE_ALIAS}.js`;

/** TV detect snippet shared by static pipeline patches. */
const MOONLIGHT_IS_TV_JS = `(typeof window !== "undefined" && (window.__MHG_TV__ === true
            || (typeof location !== "undefined" && new URLSearchParams(location.search).get("mhgProfile") === "tv")
            || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase())))`;

const MOONLIGHT_CREATE_PIPELINES_STOCK = `    createPipelines() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // Print supported pipes
            const pipesInfo = yield gatherPipeInfo();
            this.logger.debug(\`Supported Pipes: {\`);`;

const MOONLIGHT_CREATE_PIPELINES_PATCHED = `    createPipelines() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            let pipesInfo;
            try {
                if (${MOONLIGHT_IS_TV_JS}) {
                    pipesInfo = new Map();
                }
                else {
                    pipesInfo = yield Promise.race([
                        gatherPipeInfo(),
                        new Promise((resolve) => window.setTimeout(() => resolve(new Map()), 2000)),
                    ]);
                }
            }
            catch (_mhgPipeErr) {
                pipesInfo = new Map();
            }
            this.logger.debug(\`Supported Pipes: {\`);`;

const MOONLIGHT_GATHER_PIPE_INFO_STOCK = `export function gatherPipeInfo() {
    if (PIPE_INFO) {
        return PIPE_INFO;
    }
    else {
        PIPE_INFO = gatherPipeInfoInternal();
        return PIPE_INFO;
    }
}`;

const MOONLIGHT_GATHER_PIPE_INFO_PATCHED = `export function gatherPipeInfo() {
    // MHG: on smart TV, Worker/WASM getInfo probes hang forever after "Creating Client Peer".
    // WebRTC + forceVideoElementRenderer does not need the probe map.
    // Always replace PIPE_INFO on TV so a previously hung Promise cannot stick.
    try {
        if (${MOONLIGHT_IS_TV_JS}) {
            PIPE_INFO = Promise.resolve(new Map());
            return PIPE_INFO;
        }
    }
    catch (_mhgGatherErr) { }
    if (PIPE_INFO) {
        return PIPE_INFO;
    }
    else {
        PIPE_INFO = gatherPipeInfoInternal();
        return PIPE_INFO;
    }
}`;

const MOONLIGHT_BUILD_VIDEO_PIPELINE_STOCK = `export function buildVideoPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const pipesInfo = yield gatherPipeInfo();`;

const MOONLIGHT_BUILD_VIDEO_PIPELINE_PATCHED = `export function buildVideoPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        // MHG: forceVideoElementRenderer / TV must run BEFORE Supported Video Renderers getInfo
        // (stock Moonlight probes every renderer first — those getInfo calls hang forever on Tizen).
        try {
            if (settings.forceVideoElementRenderer || ${MOONLIGHT_IS_TV_JS}) {
                if (type != "videotrack") {
                    logger === null || logger === void 0 ? void 0 : logger.debug("The option Force Video Element Renderer is currently only supported with WebRTC", { type: "fatalDescription" });
                    return { videoRenderer: null, supportedCodecs: null, error: true };
                }
                if (!hasAnyCodec(settings.supportedVideoCodecs)) {
                    settings.supportedVideoCodecs.H264 = true;
                }
                return { videoRenderer: new VideoElementRenderer(), supportedCodecs: settings.supportedVideoCodecs, error: false };
            }
        }
        catch (_mhgVidFastErr) { }
        let pipesInfo;
        try {
            pipesInfo = yield gatherPipeInfo();
        } catch (_e) {
            pipesInfo = new Map();
        }`;

const MOONLIGHT_BUILD_VIDEO_PIPELINE_LEGACY = `export function buildVideoPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        // MHG: TV video-element path must not await Worker probes.
        let pipesInfo;
        try {
            const isTv = ${MOONLIGHT_IS_TV_JS};
            pipesInfo = isTv ? new Map() : yield gatherPipeInfo();
        } catch (_e) {
            pipesInfo = new Map();
        }`;

const MOONLIGHT_BUILD_AUDIO_PIPELINE_STOCK = `export function buildAudioPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        const pipesInfo = yield gatherPipeInfo();`;

const MOONLIGHT_BUILD_AUDIO_PIPELINE_PATCHED = `export function buildAudioPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        // MHG: on TV skip audio player getInfo probes and use AudioElementPlayer for audiotrack.
        try {
            if (${MOONLIGHT_IS_TV_JS}) {
                if (type == "audiotrack") {
                    return { audioPlayer: new AudioElementPlayer(), error: false };
                }
            }
        }
        catch (_mhgAudFastErr) { }
        let pipesInfo;
        try {
            pipesInfo = yield gatherPipeInfo();
        } catch (_e) {
            pipesInfo = new Map();
        }`;

const MOONLIGHT_BUILD_AUDIO_PIPELINE_LEGACY = `export function buildAudioPipeline(type, settings, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        // MHG: TV audiotrack path must not await Worker probes.
        let pipesInfo;
        try {
            const isTv = ${MOONLIGHT_IS_TV_JS};
            pipesInfo = isTv ? new Map() : yield gatherPipeInfo();
        } catch (_e) {
            pipesInfo = new Map();
        }`;

const MOONLIGHT_DEBUG_LOG_STOCK = `    debugLog(line) {
        this.debugDetail += \`\${line}\\n\`;
        this.debugDetailDisplay.innerText = this.debugDetail;
        console.info(\`[Stream]: \${line}\`);
    }`;

const MOONLIGHT_DEBUG_LOG_PATCHED = `    debugLog(line) {
        this.debugDetail += \`\${line}\\n\`;
        this.debugDetailDisplay.innerText = this.debugDetail;
        // MHG: keep latest lines visible on TV (panel had max-height but no scroll/auto-stick).
        try {
            this.debugDetailDisplay.scrollTop = this.debugDetailDisplay.scrollHeight;
        }
        catch (_mhgScrollErr) { }
        console.info(\`[Stream]: \${line}\`);
    }`;

const MOONLIGHT_DEBUG_CSS_STOCK = `.modal-video-connect .modal-video-connect-debug {
    max-width: 75vw;
    max-height: 40vh;
}`;

const MOONLIGHT_DEBUG_CSS_PATCHED = `.modal-video-connect .modal-video-connect-debug {
    max-width: 75vw;
    max-height: 55vh;
    overflow-x: auto;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
}`;

const MOONLIGHT_WEBRTC_INIT_PEER_STOCK = `            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`Creating Client Peer\`);
            if (this.peer) {
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.debug(\`Cannot create Peer because a Peer already exists\`);
                return;
            }
            // Configure web rtc
            // TODO: use this for signaling instead and extend the protocol so that the client also requests a control channel with name: "control", protocol:"moonlight-control-v1": https://www.ietf.org/archive/id/draft-ietf-wish-whep-02.html
            this.peer = new RTCPeerConnection(configuration);`;

const MOONLIGHT_WEBRTC_INIT_PEER_PATCHED = MOONLIGHT_WEBRTC_INIT_PEER_STOCK;

/** Stock initPeer tail awaits SDP and can block tryWebRTCTransport for minutes on Tizen. */
const MOONLIGHT_WEBRTC_AFTER_PEER_STOCK = `            this.peer.addEventListener("datachannel", this.onDataChannel.bind(this));
            this.initChannels();
            // Maybe we already received data
            if (this.remoteDescription) {
                yield this.handleRemoteDescription(this.remoteDescription);
            }
            yield this.tryDequeueIceCandidates();
        });
    }`;

const MOONLIGHT_WEBRTC_AFTER_PEER_PATCHED = `            this.peer.addEventListener("datachannel", this.onDataChannel.bind(this));
            this.initChannels();
            const peerSelf = this;
            const finishSdp = () => __awaiter(peerSelf, void 0, void 0, function* () {
                try {
                    if (peerSelf.remoteDescription) {
                        yield peerSelf.handleRemoteDescription(peerSelf.remoteDescription);
                    }
                    yield peerSelf.tryDequeueIceCandidates();
                }
                catch (_sdpErr) { }
            });
            try {
                if (${MOONLIGHT_IS_TV_JS}) {
                    window.setTimeout(() => { void finishSdp(); }, 0);
                }
                else {
                    yield finishSdp();
                }
            }
            catch (_mhgDeferErr) {
                yield finishSdp();
            }
        });
    }`;

/** Stock setupHostVideo — getCapabilities can hang forever on Tizen after peer create. */
const MOONLIGHT_SETUP_HOST_VIDEO_STOCK = `    setupHostVideo(_setup) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: check transport type
            var _a;
            let capabilities;
            if ("getCapabilities" in RTCRtpReceiver && (capabilities = RTCRtpReceiver.getCapabilities("video"))) {`;

const MOONLIGHT_SETUP_HOST_VIDEO_PATCHED = `    setupHostVideo(_setup) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: check transport type
            var _a;
            // MHG: RTCRtpReceiver.getCapabilities("video") hangs on some Tizen builds (blocks createPipelines).
            try {
                if (${MOONLIGHT_IS_TV_JS}) {
                    const codecs = emptyVideoCodecs();
                    codecs.H264 = true;
                    return codecs;
                }
            }
            catch (_mhgCapErr) { }
            let capabilities;
            if ("getCapabilities" in RTCRtpReceiver && (capabilities = RTCRtpReceiver.getCapabilities("video"))) {`;

/** Skip setupHostVideo await on TV inside createVideoRenderer (same hang, called before buildVideoPipeline). */
const MOONLIGHT_CREATE_VIDEO_SETUP_STOCK = `            const transportCodecSupport = yield this.transport.setupHostVideo({
                type: ["videotrack", "data"]
            });
            this.debugLog(\`Transport supports these video codecs: \${JSON.stringify(transportCodecSupport)}\`);`;

const MOONLIGHT_CREATE_VIDEO_SETUP_PATCHED = `            let transportCodecSupport;
            if (${MOONLIGHT_IS_TV_JS}) {
                transportCodecSupport = emptyVideoCodecs();
                transportCodecSupport.H264 = true;
            }
            else {
                transportCodecSupport = yield this.transport.setupHostVideo({
                    type: ["videotrack", "data"]
                });
            }
            this.debugLog(\`Transport supports these video codecs: \${JSON.stringify(transportCodecSupport)}\`);`;

/** Stock: video track only marks videoReady — modal stays until ConnectionComplete WS (often missing on TV). */
const MOONLIGHT_VIDEO_TRACK_READY_STOCK = `                video.addTrackListener((track) => {
                    this.markVideoReady();
                    videoRenderer.setTrack(track);
                });`;

const MOONLIGHT_VIDEO_TRACK_READY_PATCHED = `                video.addTrackListener((track) => {
                    this.markVideoReady();
                    videoRenderer.setTrack(track);
                    try {
                        if (${MOONLIGHT_IS_TV_JS}) {
                            this.markConnectionComplete();
                            try {
                                videoRenderer.onUserInteraction && videoRenderer.onUserInteraction();
                            }
                            catch (_playErr) { }
                        }
                    }
                    catch (_mhgReadyErr) { }
                });`;

/** ConnectionComplete calls input.onStreamStart → getGamepads throws on Tizen permissions policy. */
const MOONLIGHT_CONN_COMPLETE_INPUT_STOCK = `                this.input.onStreamStart(capabilities, [width, height]);
                this.stats.setVideoInfo(format !== null && format !== void 0 ? format : "Unknown", width, height, fps);`;

const MOONLIGHT_CONN_COMPLETE_INPUT_PATCHED = `                try {
                    this.input.onStreamStart(capabilities, [width, height]);
                }
                catch (_mhgStartErr) { }
                this.stats.setVideoInfo(format !== null && format !== void 0 ? format : "Unknown", width, height, fps);`;

const MOONLIGHT_REGISTER_GAMEPADS_STOCK = `    registerBufferedControllers() {
        const gamepads = navigator.getGamepads();`;

const MOONLIGHT_REGISTER_GAMEPADS_PATCHED = `    registerBufferedControllers() {
        let gamepads = [];
        try {
            gamepads = navigator.getGamepads() || [];
        }
        catch (_mhgGpErr) {
            // MHG: Tizen Permissions-Policy blocks gamepad — skip controller probe.
            return;
        }`;

const MOONLIGHT_TRY_WEBRTC_STOCK = `            const transport = new WebRTCTransport(this.logger);
            transport.onsendmessage = (message) => this.sendWsMessage({ WebRtc: message });
            transport.initPeer({
                iceServers: this.iceServers
            });
            this.setTransport(transport);
            const videoCodecSupport = yield this.createPipelines();`;

const MOONLIGHT_TRY_WEBRTC_PATCHED = `            const transport = new WebRTCTransport(this.logger);
            transport.onsendmessage = (message) => this.sendWsMessage({ WebRtc: message });
            transport.initPeer({
                iceServers: this.iceServers
            });
            try {
                this.setTransport(transport);
            }
            catch (_mhgSetErr) {
                this.transport = transport;
            }
            const videoCodecSupport = yield this.createPipelines();`;

const MOONLIGHT_CREATE_WORKER_STOCK = `export function createPipelineWorker() {
    if (!("Worker" in globalObject())) {
        return null;
    }
    return new Worker(new URL("worker.js", import.meta.url), { type: "module" });
}`;

const MOONLIGHT_CREATE_WORKER_PATCHED = `export function createPipelineWorker() {
    // MHG: never spawn pipeline Workers on Tizen — new Worker(module) can hang the page.
    try {
        if (${MOONLIGHT_IS_TV_JS})
            return null;
    }
    catch (_mhgWorkerErr) { }
    if (!("Worker" in globalObject())) {
        return null;
    }
    return new Worker(new URL("worker.js?${MOONLIGHT_MODULE_CACHE_BUST}", import.meta.url), { type: "module" });
}`;

const MOONLIGHT_WORKER_GETINFO_STOCK = `            const info = yield new Promise((resolve, reject) => {
                worker.onmessage = (event) => {
                    const message = event.data;
                    if ("checkSupport" in message) {
                        resolve(message.checkSupport);
                    }
                    else if ("log" in message) {
                        throw message.log;
                    }
                    else {
                        throw "Failed to get info about worker pipeline because it returned a wrong message";
                    }
                };
                worker.onerror = reject;
            });
            return info;`;

const MOONLIGHT_WORKER_GETINFO_PATCHED = `            const info = yield new Promise((resolve, reject) => {
                const timer = window.setTimeout(() => {
                    try {
                        worker.terminate();
                    }
                    catch (_termErr) { }
                    resolve({ environmentSupported: false });
                }, 2500);
                worker.onmessage = (event) => {
                    window.clearTimeout(timer);
                    const message = event.data;
                    if ("checkSupport" in message) {
                        resolve(message.checkSupport);
                    }
                    else if ("log" in message) {
                        throw message.log;
                    }
                    else {
                        throw "Failed to get info about worker pipeline because it returned a wrong message";
                    }
                };
                worker.onerror = (err) => {
                    window.clearTimeout(timer);
                    reject(err);
                };
            });
            return info;`;

/** Previous TV profile that froze video on Tizen (canvas + websocket). */
const MOONLIGHT_TV_SETTINGS_JSON_LEGACY = JSON.stringify({
  bitrate: 5000,
  fps: 30,
  videoSize: "720p",
  videoCodec: "h264",
  dataTransport: "websocket",
  canvasRenderer: true,
  forceVideoElementRenderer: false,
  hdr: false,
  enterFullscreenOnStreamStart: true,
});

const MOONLIGHT_SETTINGS_LOAD_STOCK = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
        Object.assign(this.inputConfig, {`;

const MOONLIGHT_TV_PROFILE_IIFE = `        // MHG: smart TV / mhgProfile=tv - lower quality + WebRTC video element for Tizen
        (() => {
            try {
                const profile = new URLSearchParams(window.location.search).get("mhgProfile");
                const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
                const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
                if (!isTv)
                    return;
                window.__MHG_TV__ = true;
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});
                try {
                    localStorage.setItem("mlSettings", JSON.stringify(settings));
                }
                catch (_e) { }
            }
            catch (_e) { }
        })();`;

const MOONLIGHT_TV_PROFILE_IIFE_LEGACY = `        // MHG: smart TV / mhgProfile=tv - lower quality + websocket for weak browsers
        (() => {
            try {
                const profile = new URLSearchParams(window.location.search).get("mhgProfile");
                const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
                const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
                if (!isTv)
                    return;
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON_LEGACY});
                try {
                    localStorage.setItem("mlSettings", JSON.stringify(settings));
                }
                catch (_e) { }
            }
            catch (_e) { }
        })();`;

/** Em-dash comment variant applied by an earlier patch revision. */
const MOONLIGHT_TV_PROFILE_IIFE_LEGACY_EMDASH = MOONLIGHT_TV_PROFILE_IIFE_LEGACY.replace(
  "mhgProfile=tv - lower quality",
  "mhgProfile=tv \u2014 lower quality",
);

const MOONLIGHT_SETTINGS_LOAD_TV_PATCHED = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
${MOONLIGHT_TV_PROFILE_IIFE}
        Object.assign(this.inputConfig, {`;

const MOONLIGHT_SETTINGS_LOAD_TV_LEGACY = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
${MOONLIGHT_TV_PROFILE_IIFE_LEGACY}
        Object.assign(this.inputConfig, {`;

const MOONLIGHT_SETTINGS_LOAD_TV_LEGACY_EMDASH = `        const settings = getLocalStreamSettings(bootstrapRole.default_settings);
${MOONLIGHT_TV_PROFILE_IIFE_LEGACY_EMDASH}
        Object.assign(this.inputConfig, {`;

/** Remote / gamepad must unmute WebRTC <audio> and can request fullscreen (mouse/touch only in stock). */
const MOONLIGHT_KEYDOWN_STOCK = `    onKeyDown(event) {
        this.onUserInteraction();
        console.debug(event);`;

const MOONLIGHT_KEYDOWN_PATCHED = `    onKeyDown(event) {
        this.consumeAutoFullscreenInteraction();
        this.onUserInteraction();
        console.debug(event);`;

const MOONLIGHT_GAMEPAD_CONNECT_LOOP_STOCK = `        // Connect all gamepads
        for (const gamepad of navigator.getGamepads()) {
            if (gamepad != null) {
                this.onGamepadAdd(gamepad);
            }
        }`;

const MOONLIGHT_GAMEPAD_CONNECT_LOOP_PATCHED = `        // Connect all gamepads
        // MHG: getGamepads throws under Tizen Permissions-Policy.
        try {
            for (const gamepad of (navigator.getGamepads() || [])) {
                if (gamepad != null) {
                    this.onGamepadAdd(gamepad);
                }
            }
        }
        catch (_mhgGpInitErr) { }`;

const MOONLIGHT_GAMEPAD_UPDATE_STOCK = `    onGamepadUpdate() {
        this.stream.getInput().onGamepadUpdate();
        window.requestAnimationFrame(this.onGamepadUpdate.bind(this));
    }`;

const MOONLIGHT_GAMEPAD_UPDATE_PATCHED = `    onGamepadUpdate() {
        try {
            const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
            for (const pad of pads) {
                if (!pad)
                    continue;
                if (pad.buttons && pad.buttons.some((b) => b && b.pressed)) {
                    this.consumeAutoFullscreenInteraction();
                    this.onUserInteraction();
                    break;
                }
            }
        }
        catch (_gpErr) { }
        this.stream.getInput().onGamepadUpdate();
        window.requestAnimationFrame(this.onGamepadUpdate.bind(this));
    }`;

const MOONLIGHT_AUDIO_MUTED_STOCK = `        this.audioElement.autoplay = true;
        this.audioElement.muted = true;
        this.audioElement.srcObject = this.stream;`;

const MOONLIGHT_AUDIO_MUTED_PATCHED = `        this.audioElement.autoplay = true;
        // MHG: Tizen WebRTC audio stays silent until unmute; start unmuted on smart TVs.
        this.audioElement.muted = !(typeof window !== "undefined" && window.__MHG_TV__);
        this.audioElement.srcObject = this.stream;`;

const MOONLIGHT_AUDIO_INTERACT_STOCK = `    onUserInteraction() {
        this.audioElement.muted = false;
    }`;

const MOONLIGHT_AUDIO_INTERACT_PATCHED = `    onUserInteraction() {
        this.audioElement.muted = false;
        try {
            this.audioElement.play();
        }
        catch (_playErr) { }
    }`;

function shouldUseMoonlightTvProfile(search = "", userAgent = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (params.get("mhgProfile") === "tv") return true;
  return /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(
    String(userAgent || "").toLowerCase(),
  );
}

function listMoonlightUsers(baseUrl, cookie) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  return requestMoonlightWebJson({
    baseUrl: normalized,
    urlString: `${normalized}/api/users`,
    method: "GET",
    cookie,
    timeoutMs: 30_000,
  }).then((response) => {
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
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  const response = await requestMoonlightWebJson({
    baseUrl: normalized,
    urlString: `${normalized}/api/apps?host_id=${encodeURIComponent(hostId)}`,
    method: "GET",
    cookie,
    timeoutMs: 60_000,
  });  const parsed = JSON.parse(response.body || "{}");
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

function isDesktopMoonlightApp(app) {
  const title = String(app?.title || "").trim().toLowerCase();
  return title === "desktop" || Number(app?.app_id) === 0;
}

/** Pick a non-Desktop Moonlight app (MyHomeGames registers one Sunshine app per launch). */
function pickMoonlightApp(apps, { appTitle, appId } = {}) {
  if (!Array.isArray(apps) || apps.length === 0) return null;
  if (appId != null && Number.isFinite(Number(appId))) {
    const byId = apps.find(
      (app) => Number(app.app_id) === Number(appId) && !isDesktopMoonlightApp(app),
    );
    if (byId) return byId;
  }
  if (appTitle) {
    const want = String(appTitle).trim();
    const byTitle = apps.find(
      (app) => String(app.title || "").trim() === want && !isDesktopMoonlightApp(app),
    );
    if (byTitle) return byTitle;
  }
  return (
    apps.find(
      (app) =>
        String(app.title || "").startsWith(MHG_SUNSHINE_APP_PREFIX) &&
        !isDesktopMoonlightApp(app),
    ) || null
  );
}

function buildMoonlightAppStreamUrl(baseUrl, hostId, appId) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  // Versioned folder busts Tizen HTML cache; pathname still ends with stream.html
  // so released MHG web accepts it (stream.mhg26.html was rejected).
  const url = new URL(`${normalized}/${MOONLIGHT_STREAM_HTML_PATH}`);
  url.searchParams.set("hostId", String(hostId));
  url.searchParams.set("appId", String(appId));
  return url.toString();
}

/**
 * Point any Moonlight stream URL at the versioned HTML entry (cache bust, web-safe path).
 */
function rewriteMoonlightStreamHtmlPath(streamUrl) {
  const raw = String(streamUrl || "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (
      /\/stream(?:\.mhg\d+)?\.html$/i.test(url.pathname) ||
      /\/mhg\d+\/stream\.html$/i.test(url.pathname) ||
      url.pathname === "/" ||
      url.pathname === ""
    ) {
      url.pathname = `/${MOONLIGHT_STREAM_HTML_PATH}`;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Build a Moonlight Web URL that opens a Sunshine application stream directly.
 */
async function resolveMoonlightAppStreamUrl({
  baseUrl,
  cookie,
  hostId,
  appTitle,
  appId,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required");
  if (hostId == null) throw new Error("Moonlight host_id is required");

  const apps = await listMoonlightApps(normalized, cookie, hostId);
  const app = pickMoonlightApp(apps, { appTitle, appId });
  if (!app || app.app_id == null) {
    throw new Error(
      appTitle
        ? `Moonlight Web app not found on Sunshine host: ${appTitle}`
        : "Moonlight Web application stream not found on Sunshine host",
    );
  }

  return {
    url: buildMoonlightAppStreamUrl(normalized, hostId, app.app_id),
    hostId: Number(hostId),
    appId: Number(app.app_id),
    appTitle: app.title || appTitle || "Game",
  };
}

/** @deprecated Desktop streaming was removed — use resolveMoonlightAppStreamUrl */
async function resolveMoonlightDesktopStreamUrl() {
  throw new Error("Desktop streaming is no longer supported; use resolveMoonlightAppStreamUrl");
}

/** Alias kept for callers/tests. */
const buildMoonlightDesktopStreamUrl = buildMoonlightAppStreamUrl;

/**
 * Attach mhgStop / mhgReturn so Moonlight Exit can stop the home game and leave Moonlight.
 * Prefer a public HTTPS API base (per-user tunnel), never localhost.
 * @param {string} streamUrl
 * @param {{ apiBase?: string, gameId?: string|number, executableName?: string, hostId?: number|null, returnUrl?: string }} [opts]
 */
function attachMoonlightStopHook(streamUrl, { apiBase, gameId, executableName, hostId, returnUrl } = {}) {
  const stream = rewriteMoonlightStreamHtmlPath(String(streamUrl || "").trim());
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

/**
 * Leave hook injected after startApp(): pagehide/popstate + TV remote Back.
 * On Tizen, do NOT click Moonlight Exit / window.close / location.replace — that
 * exits the whole WebApp. Back must only stop Sunshine and history.back() one step.
 */
const MOONLIGHT_LEAVE_HOOK = `// MHG: stop home game when leaving via browser/TV Back / tab close (not only Exit).
(() => {
    const params = new URLSearchParams(window.location.search);
    const mhgStop = params.get("mhgStop");
    if (!mhgStop)
        return;
    let sent = false;
    const send = () => {
        if (sent)
            return;
        sent = true;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                navigator.sendBeacon(mhgStop, new Blob([], { type: "text/plain" }));
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
    const isTvBack = (e) => {
        const code = e.keyCode || e.which || 0;
        return (code === 10009 || code === 461 || e.key === "BrowserBack" || e.key === "GoBack" || e.key === "XF86Back");
    };
    window.addEventListener("pagehide", send);
    window.addEventListener("popstate", send);
    window.addEventListener("keydown", (e) => {
        if (!isTvBack(e))
            return;
        // Swallow Tizen default (exits the app at root) and avoid Exit/window.close.
        e.preventDefault();
        e.stopPropagation();
        send();
        try {
            history.back();
        }
        catch (_histErr) { }
    }, true);
})();`;

/** Previous leave hook that clicked Exit / used mhgReturn — closes the Tizen app. */
const MOONLIGHT_LEAVE_HOOK_LEGACY_EXIT_CLICK = `// MHG: stop home game when leaving via browser/TV Back / tab close (not only Exit).
(() => {
    const params = new URLSearchParams(window.location.search);
    const mhgStop = params.get("mhgStop");
    const mhgReturn = params.get("mhgReturn");
    if (!mhgStop && !mhgReturn)
        return;
    let sent = false;
    const send = () => {
        if (sent || !mhgStop)
            return;
        sent = true;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                navigator.sendBeacon(mhgStop, new Blob([], { type: "text/plain" }));
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
    const isTvBack = (e) => {
        const code = e.keyCode || e.which || 0;
        return (code === 10009 || code === 461 || e.key === "BrowserBack" || e.key === "GoBack" || e.key === "XF86Back");
    };
    const clickExitIfPossible = () => {
        const nodes = Array.from(document.querySelectorAll("button, [role='button'], a"));
        const exitBtn = nodes.find((el) => {
            const label = ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")).trim().toLowerCase();
            return /\\bexit\\b|\\bquit\\b|esci|chiudi/.test(label);
        });
        if (exitBtn) {
            exitBtn.click();
            return true;
        }
        return false;
    };
    window.addEventListener("pagehide", send);
    window.addEventListener("popstate", send);
    window.addEventListener("keydown", (e) => {
        if (!isTvBack(e))
            return;
        e.preventDefault();
        e.stopPropagation();
        if (clickExitIfPossible())
            return;
        send();
        if (mhgReturn) {
            try {
                window.location.replace(mhgReturn);
                return;
            }
            catch (_retErr) { }
        }
        try {
            history.back();
        }
        catch (_histErr) { }
    }, true);
})();`;

async function listMoonlightRoles(baseUrl, cookie) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  const response = await requestMoonlightWebJson({
    baseUrl: normalized,
    urlString: `${normalized}/api/roles`,
    method: "GET",
    cookie,
    timeoutMs: 30_000,
  });
  const parsed = JSON.parse(response.body || "{}");
  return Array.isArray(parsed.roles) ? parsed.roles : [];
}

async function getMoonlightRole(baseUrl, cookie, roleId) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  const qs = roleId != null ? `?id=${encodeURIComponent(roleId)}` : "";
  const response = await requestMoonlightWebJson({
    baseUrl: normalized,
    urlString: `${normalized}/api/role${qs}`,
    method: "GET",
    cookie,
    timeoutMs: 30_000,
  });  const parsed = JSON.parse(response.body || "{}");
  return parsed.role || parsed;
}

const MOONLIGHT_FOCUS_INPUT_STOCK = `    focusInput() {
        if (this.stream.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input");
            inputElement.focus();
        }
    }`;

/** First TV patch: only skipped focusInput while connecting modal was open. */
const MOONLIGHT_FOCUS_INPUT_PATCHED_LEGACY_MODAL_ONLY = `    focusInput() {
        // MHG: while the connecting modal is open, keep D-pad focus on Show logs / Close (Tizen).
        if (typeof document !== "undefined" && document.querySelector(".modal-video-connect"))
            return;
        if (this.stream.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input");
            inputElement.focus();
        }
    }`;

/** Sidebar-aware focusInput before chromeNav sticky flag. */
const MOONLIGHT_FOCUS_INPUT_PATCHED_LEGACY_SIDEBAR = `    focusInput() {
        // MHG: keep D-pad on connecting modal / sidebar chrome (Tizen).
        if (typeof document !== "undefined") {
            if (document.querySelector(".modal-video-connect"))
                return;
            const ae = document.activeElement;
            if (ae && (ae.id === "sidebar-button" || ae.closest("#sidebar-root") || ae.classList.contains("mhg-tv-focus")))
                return;
            if (document.querySelector("#sidebar-root.sidebar-show"))
                return;
        }
        if (this.stream.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input");
            inputElement.focus();
        }
    }`;

const MOONLIGHT_FOCUS_INPUT_PATCHED = `    focusInput() {
        // MHG: keep D-pad on connecting modal / sidebar chrome (Tizen).
        if (typeof document !== "undefined") {
            if (window.__MHG_TV_CHROME_NAV__)
                return;
            if (document.querySelector(".modal-video-connect"))
                return;
            const ae = document.activeElement;
            if (ae && (ae.id === "sidebar-button" || ae.closest("#sidebar-root") || ae.classList.contains("mhg-tv-focus")))
                return;
            if (document.querySelector("#sidebar-root.sidebar-show"))
                return;
        }
        if (this.stream.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input");
            inputElement.focus();
        }
    }`;

/**
 * Smart TV D-pad: connecting modal + sidebar arrow + sidebar actions (incl. Mouse/Touch selects).
 * Stock Moonlight keeps focus on #input and eats arrow keys for the stream.
 */
const MOONLIGHT_TV_MODAL_FOCUS_HOOK = `// MHG: D-pad focus for Moonlight chrome (modal + sidebar + selects) on smart TV.
(() => {
    try {
        const params = new URLSearchParams(window.location.search);
        const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
        const isTv = params.get("mhgProfile") === "tv" || window.__MHG_TV__ === true
            || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
        if (!isTv)
            return;
        if (window.__MHG_TV_FOCUS_HOOK__)
            return;
        window.__MHG_TV_FOCUS_HOOK__ = true;
        let chromeNav = false;
        const setChromeNav = (on) => {
            chromeNav = !!on;
            window.__MHG_TV_CHROME_NAV__ = chromeNav;
        };
        const style = document.createElement("style");
        style.setAttribute("data-mhg", "tv-modal-focus");
        style.textContent = ".modal-video-connect button,#sidebar-button,.sidebar-stream button,.sidebar-stream-buttons button,"
            + "#sidebar-parent select,#sidebar-parent .select-polyfill-display{"
            + "outline:3px solid transparent;outline-offset:4px;}"
            + ".modal-video-connect button:focus,.modal-video-connect button.mhg-tv-focus,"
            + "#sidebar-button:focus,#sidebar-button.mhg-tv-focus,"
            + ".sidebar-stream button:focus,.sidebar-stream button.mhg-tv-focus,"
            + ".sidebar-stream-buttons button:focus,.sidebar-stream-buttons button.mhg-tv-focus,"
            + "#sidebar-parent select:focus,#sidebar-parent select.mhg-tv-focus,"
            + "#sidebar-parent .select-polyfill-display:focus,#sidebar-parent .select-polyfill-display.mhg-tv-focus{"
            + "outline-color:#4ea1ff;}";
        document.head.appendChild(style);
        const clearFocusClass = () => {
            document.querySelectorAll(".mhg-tv-focus").forEach((el) => el.classList.remove("mhg-tv-focus"));
        };
        const focusEl = (el) => {
            if (!el)
                return;
            setChromeNav(true);
            clearFocusClass();
            el.classList.add("mhg-tv-focus");
            el.tabIndex = 0;
            try {
                el.focus({ preventScroll: true });
            }
            catch (_e) {
                try {
                    el.focus();
                }
                catch (_e2) { }
            }
        };
        const sidebarVisible = () => {
            const sidebarRoot = document.getElementById("sidebar-root");
            return !!(sidebarRoot && sidebarRoot.style.visibility !== "hidden");
        };
        const sidebarOpen = () => {
            const sidebarRoot = document.getElementById("sidebar-root");
            return !!(sidebarRoot && sidebarRoot.classList.contains("sidebar-show"));
        };
        const collectChrome = () => {
            const list = [];
            const sidebarBtn = document.getElementById("sidebar-button");
            const sidebarRoot = document.getElementById("sidebar-root");
            if (sidebarBtn && sidebarVisible())
                list.push(sidebarBtn);
            if (sidebarOpen() && sidebarRoot) {
                sidebarRoot.querySelectorAll(
                    "#sidebar-parent button, .sidebar-stream-buttons button, #sidebar-parent select, #sidebar-parent .select-polyfill-display"
                ).forEach((el) => {
                    if (el !== sidebarBtn && !list.includes(el))
                        list.push(el);
                });
            }
            const modal = document.querySelector(".modal-video-connect");
            if (modal) {
                modal.querySelectorAll("button").forEach((b) => {
                    if (!list.includes(b))
                        list.push(b);
                });
            }
            return list;
        };
        const chromeActive = () => {
            if (chromeNav)
                return true;
            if (document.querySelector(".modal-video-connect"))
                return true;
            if (sidebarOpen())
                return true;
            const ae = document.activeElement;
            if (ae && (ae.id === "sidebar-button" || ae.classList.contains("mhg-tv-focus") || ae.closest("#sidebar-root")))
                return true;
            return false;
        };
        const cycleSelect = (select, delta) => {
            if (!select || select.tagName !== "SELECT")
                return false;
            const options = Array.from(select.options).filter((o) => !o.disabled);
            if (!options.length)
                return false;
            let i = options.findIndex((o) => o === select.selectedOptions[0] || o.value === select.value);
            if (i < 0)
                i = 0;
            i = Math.max(0, Math.min(options.length - 1, i + delta));
            select.value = options[i].value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        };
        const activateEl = (el) => {
            if (!el)
                return;
            if (el.tagName === "SELECT") {
                try {
                    el.click();
                }
                catch (_e) { }
                // Native picker / focus — keep chrome nav.
                focusEl(el);
                return;
            }
            if (el.classList && el.classList.contains("select-polyfill-display")) {
                el.click();
                focusEl(el);
                return;
            }
            el.click();
        };
        const syncChrome = () => {
            const items = collectChrome();
            items.forEach((el) => {
                el.tabIndex = 0;
            });
            if (!items.length)
                return;
            const modal = document.querySelector(".modal-video-connect");
            // Modal closed and sidebar collapsed: release chrome nav so stream #input works again.
            if (!modal && !sidebarOpen()) {
                if (chromeNav) {
                    setChromeNav(false);
                    clearFocusClass();
                }
                return;
            }
            if (!items.some((el) => el === document.activeElement || el.classList.contains("mhg-tv-focus"))) {
                const modalFirst = modal && modal.querySelector("button");
                focusEl(modalFirst || items[0]);
            }
        };
        window.addEventListener("keydown", (e) => {
            const code = e.keyCode || e.which || 0;
            if (code === 10009 || code === 461 || e.key === "BrowserBack" || e.key === "GoBack" || e.key === "XF86Back") {
                // Back while chrome-only (collapsed): release focus to stream.
                if (chromeNav && !sidebarOpen() && !document.querySelector(".modal-video-connect")) {
                    setChromeNav(false);
                    clearFocusClass();
                    const input = document.getElementById("input");
                    if (input) {
                        try {
                            input.focus({ preventScroll: true });
                        }
                        catch (_f) {
                            try {
                                input.focus();
                            }
                            catch (_f2) { }
                        }
                    }
                }
                return;
            }
            const left = code === 37 || code === 4 || e.key === "ArrowLeft";
            const right = code === 39 || code === 5 || e.key === "ArrowRight";
            const up = code === 38 || code === 29460 || e.key === "ArrowUp";
            const down = code === 40 || code === 29461 || e.key === "ArrowDown";
            const ok = code === 13 || code === 29443 || e.key === "Enter" || e.key === " ";
            if (!chromeActive()) {
                const sidebarBtn = document.getElementById("sidebar-button");
                if (sidebarBtn && sidebarVisible() && left) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    focusEl(sidebarBtn);
                }
                return;
            }
            const items = collectChrome();
            if (!items.length)
                return;
            let idx = items.findIndex((el) => el === document.activeElement || el.classList.contains("mhg-tv-focus"));
            if (idx < 0)
                idx = 0;
            const cur = items[idx];
            // On a <select>, Left/Right cycle values; Up/Down move chrome focus.
            if (cur && cur.tagName === "SELECT" && (left || right)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                cycleSelect(cur, left ? -1 : 1);
                focusEl(cur);
                return;
            }
            if (left || up) {
                e.preventDefault();
                e.stopImmediatePropagation();
                focusEl(items[Math.max(0, idx - 1)]);
            }
            else if (right || down) {
                e.preventDefault();
                e.stopImmediatePropagation();
                focusEl(items[Math.min(items.length - 1, idx + 1)]);
            }
            else if (ok) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const target = items[idx];
                const wasOpen = sidebarOpen();
                activateEl(target);
                window.setTimeout(() => {
                    const next = collectChrome();
                    if (target && target.id === "sidebar-button") {
                        if (!wasOpen && sidebarOpen() && next.length > 1)
                            focusEl(next[1]);
                        else
                            focusEl(document.getElementById("sidebar-button") || next[0]);
                    }
                    else {
                        syncChrome();
                    }
                }, 50);
            }
        }, true);
        const mo = new MutationObserver(() => syncChrome());
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        window.setInterval(syncChrome, 800);
        syncChrome();
    }
    catch (_mhgTvFocusErr) { }
})();`;

/** TV focus hook that covered modal + sidebar buttons but not Mouse/Touch selects. */
const MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_SIDEBAR_BTNS = `// MHG: D-pad focus for Moonlight chrome (modal + sidebar) on smart TV.
(() => {
    try {
        const params = new URLSearchParams(window.location.search);
        const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
        const isTv = params.get("mhgProfile") === "tv" || window.__MHG_TV__ === true
            || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
        if (!isTv)
            return;
        const style = document.createElement("style");
        style.setAttribute("data-mhg", "tv-modal-focus");
        style.textContent = ".modal-video-connect button,#sidebar-button,.sidebar-stream button,.sidebar-stream-buttons button{"
            + "outline:3px solid transparent;outline-offset:4px;}"
            + ".modal-video-connect button:focus,.modal-video-connect button.mhg-tv-focus,"
            + "#sidebar-button:focus,#sidebar-button.mhg-tv-focus,"
            + ".sidebar-stream button:focus,.sidebar-stream button.mhg-tv-focus,"
            + ".sidebar-stream-buttons button:focus,.sidebar-stream-buttons button.mhg-tv-focus{"
            + "outline-color:#4ea1ff;}";
        document.head.appendChild(style);
        const clearFocusClass = () => {
            document.querySelectorAll(".mhg-tv-focus").forEach((el) => el.classList.remove("mhg-tv-focus"));
        };
        const focusBtn = (btn) => {
            if (!btn)
                return;
            clearFocusClass();
            btn.classList.add("mhg-tv-focus");
            btn.tabIndex = 0;
            try {
                btn.focus({ preventScroll: true });
            }
            catch (_e) {
                try {
                    btn.focus();
                }
                catch (_e2) { }
            }
        };
        const collectChromeButtons = () => {
            const list = [];
            const sidebarBtn = document.getElementById("sidebar-button");
            const sidebarRoot = document.getElementById("sidebar-root");
            const sidebarOpen = !!(sidebarRoot && sidebarRoot.classList.contains("sidebar-show"));
            // Left-edge arrow first (spatial: left of the connecting modal).
            if (sidebarBtn && sidebarRoot && sidebarRoot.style.visibility !== "hidden")
                list.push(sidebarBtn);
            if (sidebarOpen && sidebarRoot) {
                sidebarRoot.querySelectorAll("#sidebar-parent button, .sidebar-stream-buttons button").forEach((b) => {
                    if (b !== sidebarBtn && !list.includes(b))
                        list.push(b);
                });
            }
            const modal = document.querySelector(".modal-video-connect");
            if (modal) {
                modal.querySelectorAll("button").forEach((b) => {
                    if (!list.includes(b))
                        list.push(b);
                });
            }
            return list;
        };
        const chromeActive = () => {
            if (document.querySelector(".modal-video-connect"))
                return true;
            if (document.querySelector("#sidebar-root.sidebar-show"))
                return true;
            const ae = document.activeElement;
            if (ae && (ae.id === "sidebar-button" || ae.classList.contains("mhg-tv-focus") || ae.closest("#sidebar-root")))
                return true;
            return false;
        };
        const syncChrome = () => {
            const buttons = collectChromeButtons();
            buttons.forEach((b) => {
                b.tabIndex = 0;
            });
            if (!buttons.length)
                return;
            // While connecting, always keep a chrome target focused (incl. sidebar arrow).
            if (!document.querySelector(".modal-video-connect") && !document.querySelector("#sidebar-root.sidebar-show"))
                return;
            if (!buttons.some((b) => b === document.activeElement || b.classList.contains("mhg-tv-focus")))
                focusBtn(buttons[0]);
        };
        window.addEventListener("keydown", (e) => {
            const code = e.keyCode || e.which || 0;
            if (code === 10009 || code === 461 || e.key === "BrowserBack" || e.key === "GoBack" || e.key === "XF86Back")
                return;
            const left = code === 37 || code === 4 || e.key === "ArrowLeft";
            const right = code === 39 || code === 5 || e.key === "ArrowRight";
            const up = code === 38 || code === 29460 || e.key === "ArrowUp";
            const down = code === 40 || code === 29461 || e.key === "ArrowDown";
            const ok = code === 13 || code === 29443 || e.key === "Enter" || e.key === " ";
            // From stream input: Left jumps to the Moonlight sidebar arrow.
            if (!chromeActive()) {
                const sidebarBtn = document.getElementById("sidebar-button");
                const sidebarRoot = document.getElementById("sidebar-root");
                if (sidebarBtn && sidebarRoot && sidebarRoot.style.visibility !== "hidden" && left) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusBtn(sidebarBtn);
                }
                return;
            }
            const buttons = collectChromeButtons();
            if (!buttons.length)
                return;
            let idx = buttons.findIndex((b) => b === document.activeElement || b.classList.contains("mhg-tv-focus"));
            if (idx < 0)
                idx = 0;
            if (left || up) {
                e.preventDefault();
                e.stopPropagation();
                focusBtn(buttons[Math.max(0, idx - 1)]);
            }
            else if (right || down) {
                e.preventDefault();
                e.stopPropagation();
                focusBtn(buttons[Math.min(buttons.length - 1, idx + 1)]);
            }
            else if (ok) {
                e.preventDefault();
                e.stopPropagation();
                const target = buttons[idx];
                target.click();
                // After opening the sidebar, move focus onto its first action button.
                window.setTimeout(() => {
                    const next = collectChromeButtons();
                    if (target.id === "sidebar-button" && next.length > 1)
                        focusBtn(next[1]);
                    else
                        syncChrome();
                }, 50);
            }
        }, true);
        const mo = new MutationObserver(() => syncChrome());
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        window.setInterval(syncChrome, 800);
        syncChrome();
    }
    catch (_mhgTvFocusErr) { }
})();`;

/** Previous TV focus hook that only covered the connecting modal buttons. */
const MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_MODAL_ONLY = `// MHG: D-pad focus for Moonlight connecting modal (Show logs / Close) on smart TV.
(() => {
    try {
        const params = new URLSearchParams(window.location.search);
        const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "").toLowerCase();
        const isTv = params.get("mhgProfile") === "tv" || window.__MHG_TV__ === true
            || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
        if (!isTv)
            return;
        const style = document.createElement("style");
        style.setAttribute("data-mhg", "tv-modal-focus");
        style.textContent = ".modal-video-connect button{outline:3px solid transparent;outline-offset:4px;}"
            + ".modal-video-connect button:focus,.modal-video-connect button.mhg-tv-focus{"
            + "outline-color:#4ea1ff;}";
        document.head.appendChild(style);
        const buttonsIn = (root) => Array.from(root.querySelectorAll("button"));
        const focusBtn = (btn) => {
            const root = btn.closest(".modal-video-connect");
            if (!root)
                return;
            buttonsIn(root).forEach((b) => b.classList.remove("mhg-tv-focus"));
            btn.classList.add("mhg-tv-focus");
            try {
                btn.focus({ preventScroll: true });
            }
            catch (_e) {
                try {
                    btn.focus();
                }
                catch (_e2) { }
            }
        };
        const syncModal = () => {
            const modal = document.querySelector(".modal-video-connect");
            if (!modal)
                return;
            const buttons = buttonsIn(modal);
            buttons.forEach((b) => {
                b.tabIndex = 0;
            });
            if (!buttons.length)
                return;
            if (!buttons.some((b) => b === document.activeElement || b.classList.contains("mhg-tv-focus")))
                focusBtn(buttons[0]);
        };
        window.addEventListener("keydown", (e) => {
            const modal = document.querySelector(".modal-video-connect");
            if (!modal || !document.body.contains(modal))
                return;
            // Let Back be handled by the leave hook.
            const code = e.keyCode || e.which || 0;
            if (code === 10009 || code === 461 || e.key === "BrowserBack" || e.key === "GoBack" || e.key === "XF86Back")
                return;
            const buttons = buttonsIn(modal);
            if (!buttons.length)
                return;
            let idx = buttons.findIndex((b) => b === document.activeElement || b.classList.contains("mhg-tv-focus"));
            if (idx < 0)
                idx = 0;
            const left = code === 37 || code === 4 || e.key === "ArrowLeft";
            const right = code === 39 || code === 5 || e.key === "ArrowRight";
            const up = code === 38 || code === 29460 || e.key === "ArrowUp";
            const down = code === 40 || code === 29461 || e.key === "ArrowDown";
            const ok = code === 13 || code === 29443 || e.key === "Enter" || e.key === " ";
            if (left || up) {
                e.preventDefault();
                e.stopPropagation();
                focusBtn(buttons[Math.max(0, idx - 1)]);
            }
            else if (right || down) {
                e.preventDefault();
                e.stopPropagation();
                focusBtn(buttons[Math.min(buttons.length - 1, idx + 1)]);
            }
            else if (ok) {
                e.preventDefault();
                e.stopPropagation();
                buttons[idx].click();
            }
        }, true);
        const mo = new MutationObserver(() => syncModal());
        mo.observe(document.documentElement, { childList: true, subtree: true });
        window.setInterval(syncModal, 800);
        syncModal();
    }
    catch (_mhgTvFocusErr) { }
})();`;

/**
 * Collapse duplicate MHG TV D-pad focus IIFEs in stream.js (stacked by older patch runs).
 */
function dedupeMoonlightTvFocusHooks(body) {
  const chromeMarker = "// MHG: D-pad focus for Moonlight chrome";
  const modalMarker = "// MHG: D-pad focus for Moonlight connecting modal";
  const extractEnd = (src, from) => {
    const catchIdx = src.indexOf("catch (_mhgTvFocusErr)", from);
    if (catchIdx < 0) return -1;
    const end = src.indexOf("})();", catchIdx);
    return end < 0 ? -1 : end + "})();".length;
  };
  const findStarts = (src, marker) => {
    const out = [];
    let idx = 0;
    while (true) {
      const i = src.indexOf(marker, idx);
      if (i < 0) break;
      out.push(i);
      idx = i + 1;
    }
    return out;
  };

  let next = body;
  const chromeStarts = findStarts(next, chromeMarker);
  if (chromeStarts.length > 1) {
    const keepStart = chromeStarts[0];
    const keepEnd = extractEnd(next, keepStart);
    if (keepEnd > keepStart) {
      const keep = next.slice(keepStart, keepEnd);
      for (let s = chromeStarts.length - 1; s >= 0; s -= 1) {
        const a = chromeStarts[s];
        const b = extractEnd(next, a);
        if (b > a) next = next.slice(0, a) + next.slice(b);
      }
      const leaveIdx = next.indexOf("// MHG: stop home game when leaving");
      const leaveEnd = leaveIdx >= 0 ? next.indexOf("})();\n", leaveIdx) : -1;
      if (leaveEnd >= 0) {
        const insertAt = leaveEnd + "})();\n".length;
        next = `${next.slice(0, insertAt)}${keep}\n${next.slice(insertAt)}`;
      } else {
        next = `${keep}\n${next}`;
      }
    }
  }

  // Drop any leftover modal-only hooks (superseded by the chrome hook).
  while (next.includes(modalMarker)) {
    const a = next.indexOf(modalMarker);
    const b = extractEnd(next, a);
    if (b <= a) break;
    next = next.slice(0, a) + next.slice(b);
  }

  next = next
    .replace(/\n\/\/ MHG: removed duplicate tv-focus \(sidebar-btns\)\.\n/g, "\n")
    .replace(/\n\/\/ MHG: removed duplicate tv-focus \(modal-only\)\.\n/g, "\n");

  return next;
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
/** Retarget physical/query module aliases to the current bust token. */
function normalizeMoonlightModuleImports(source, alias) {
  let out = String(source || "")
    .replace(/\.mhg\d+\.js/g, `.${alias}.js`)
    .replace(/\/([a-zA-Z0-9_/-]+)\.js\?mhg=[^"'\s]+/g, `/$1.${alias}.js`);
  // Cross-imports between physical alias siblings (see aliasCopies).
  const siblingImports = [
    ["./index.js", `./index.${alias}.js`],
    ["./pipeline/index.js", `./pipeline/index.${alias}.js`],
    ["./pipeline/worker_pipe.js", `./pipeline/worker_pipe.${alias}.js`],
    ["./transport/webrtc.js", `./transport/webrtc.${alias}.js`],
    ["./video/pipeline.js", `./video/pipeline.${alias}.js`],
    ["./audio/pipeline.js", `./audio/pipeline.${alias}.js`],
    ["../pipeline/index.js", `../pipeline/index.${alias}.js`],
    ["../pipeline/worker_pipe.js", `../pipeline/worker_pipe.${alias}.js`],
    ["../video/pipeline.js", `../video/pipeline.${alias}.js`],
    ["../audio/pipeline.js", `../audio/pipeline.${alias}.js`],
  ];
  for (const [from, to] of siblingImports) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
    }
  }
  return out;
}

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
        // Smart TV / mhgProfile=tv: WebRTC + HTML video element (not canvas/websocket).
        [MOONLIGHT_SETTINGS_LOAD_STOCK, MOONLIGHT_SETTINGS_LOAD_TV_PATCHED],
        // Migrate previous freeze-prone TV profiles already patched into stream.js.
        [MOONLIGHT_SETTINGS_LOAD_TV_LEGACY, MOONLIGHT_SETTINGS_LOAD_TV_PATCHED],
        [MOONLIGHT_SETTINGS_LOAD_TV_LEGACY_EMDASH, MOONLIGHT_SETTINGS_LOAD_TV_PATCHED],
        // Bust nested Stream module so Tizen reloads pipeline gatherPipeInfo patch.
        [
          'import { Stream } from "./stream/index.js";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          `import { Stream } from "./stream/index.js?${MOONLIGHT_MODULE_CACHE_BUST}";`,
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=22";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.mhg25.js";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.mhg23.js";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=21";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=20";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=19";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=18";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { Stream } from "./stream/index.js?mhg=17";',
          `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        // Ensure TV flag is set (needed for unmuted WebRTC audio bootstrap).
        [
          `                if (!isTv)
                    return;
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});`,
          `                if (!isTv)
                    return;
                window.__MHG_TV__ = true;
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});`,
        ],
        // TV remote: key / gamepad must unmute audio and request fullscreen (stock = mouse/touch only).
        [MOONLIGHT_KEYDOWN_STOCK, MOONLIGHT_KEYDOWN_PATCHED],
        [MOONLIGHT_GAMEPAD_UPDATE_STOCK, MOONLIGHT_GAMEPAD_UPDATE_PATCHED],
        [MOONLIGHT_GAMEPAD_CONNECT_LOOP_STOCK, MOONLIGHT_GAMEPAD_CONNECT_LOOP_PATCHED],
        // Keep D-pad on Show logs / Close / sidebar arrow while connecting (don't steal focus to #input).
        [MOONLIGHT_FOCUS_INPUT_STOCK, MOONLIGHT_FOCUS_INPUT_PATCHED],
        [MOONLIGHT_FOCUS_INPUT_PATCHED_LEGACY_MODAL_ONLY, MOONLIGHT_FOCUS_INPUT_PATCHED],
        [MOONLIGHT_FOCUS_INPUT_PATCHED_LEGACY_SIDEBAR, MOONLIGHT_FOCUS_INPUT_PATCHED],
        // Connecting modal logs: auto-scroll to latest line (TV cannot scroll the clipped panel).
        [MOONLIGHT_DEBUG_LOG_STOCK, MOONLIGHT_DEBUG_LOG_PATCHED],
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
${MOONLIGHT_LEAVE_HOOK}
${MOONLIGHT_TV_MODAL_FOCUS_HOOK}`,
        ],
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
          `startApp();
${MOONLIGHT_LEAVE_HOOK}
${MOONLIGHT_TV_MODAL_FOCUS_HOOK}`,
        ],
        [
          `startApp();
${MOONLIGHT_LEAVE_HOOK}`,
          `startApp();
${MOONLIGHT_LEAVE_HOOK}
${MOONLIGHT_TV_MODAL_FOCUS_HOOK}`,
        ],
        [
          `startApp();`,
          `startApp();
${MOONLIGHT_LEAVE_HOOK}
${MOONLIGHT_TV_MODAL_FOCUS_HOOK}`,
        ],
        // Migrate TV focus hook that only covered Show logs / Close (no sidebar arrow).
        [MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_MODAL_ONLY, MOONLIGHT_TV_MODAL_FOCUS_HOOK],
        // Migrate modal+sidebar-buttons hook → include Mouse/Touch selects + sticky → focus.
        [MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_SIDEBAR_BTNS, MOONLIGHT_TV_MODAL_FOCUS_HOOK],
        // Strip leftover duplicate hooks when the new one is already present (includes(to) would skip above).
        [
          MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_MODAL_ONLY,
          "// MHG: removed duplicate tv-focus (modal-only).\n",
        ],
        [
          MOONLIGHT_TV_MODAL_FOCUS_HOOK_LEGACY_SIDEBAR_BTNS,
          "// MHG: removed duplicate tv-focus (sidebar-btns).\n",
        ],
        // Migrate TV Back hook that clicked Exit / mhgReturn (exits Tizen app).
        [MOONLIGHT_LEAVE_HOOK_LEGACY_EXIT_CLICK, MOONLIGHT_LEAVE_HOOK],
      ],
    },
    {
      file: "audio_element.js",
      containerPath: "/moonlight-web/static/stream/audio/audio_element.js",
      replace: [
        [MOONLIGHT_AUDIO_MUTED_STOCK, MOONLIGHT_AUDIO_MUTED_PATCHED],
        [MOONLIGHT_AUDIO_INTERACT_STOCK, MOONLIGHT_AUDIO_INTERACT_PATCHED],
      ],
    },
    {
      file: "input.js",
      containerPath: "/moonlight-web/static/stream/input.js",
      replace: [
        [MOONLIGHT_REGISTER_GAMEPADS_STOCK, MOONLIGHT_REGISTER_GAMEPADS_PATCHED],
      ],
    },
    {
      file: "standard.css",
      containerPath: "/moonlight-web/static/styles/standard.css",
      replace: [[MOONLIGHT_DEBUG_CSS_STOCK, MOONLIGHT_DEBUG_CSS_PATCHED]],
    },
    {
      file: "moonlight.css",
      containerPath: "/moonlight-web/static/styles/moonlight.css",
      replace: [[MOONLIGHT_DEBUG_CSS_STOCK, MOONLIGHT_DEBUG_CSS_PATCHED]],
    },
    {
      file: "pipeline_index.js",
      containerPath: "/moonlight-web/static/stream/pipeline/index.js",
      replace: [
        [MOONLIGHT_GATHER_PIPE_INFO_STOCK, MOONLIGHT_GATHER_PIPE_INFO_PATCHED],
        // Migrate soft TV skip (could keep a hung PIPE_INFO) → always replace on TV.
        [
          `            if (!PIPE_INFO)
                PIPE_INFO = Promise.resolve(new Map());
            return PIPE_INFO;`,
          `            PIPE_INFO = Promise.resolve(new Map());
            return PIPE_INFO;`,
        ],
      ],
    },
    {
      file: "worker_pipe.js",
      containerPath: "/moonlight-web/static/stream/pipeline/worker_pipe.js",
      replace: [
        [MOONLIGHT_CREATE_WORKER_STOCK, MOONLIGHT_CREATE_WORKER_PATCHED],
        [MOONLIGHT_WORKER_GETINFO_STOCK, MOONLIGHT_WORKER_GETINFO_PATCHED],
        [
          "return new Worker(new URL(\"worker.js?mhg=18\", import.meta.url), { type: \"module\" });",
          `return new Worker(new URL("worker.js?${MOONLIGHT_MODULE_CACHE_BUST}", import.meta.url), { type: "module" });`,
        ],
        [
          "return new Worker(new URL(\"worker.js?mhg=19\", import.meta.url), { type: \"module\" });",
          `return new Worker(new URL("worker.js?${MOONLIGHT_MODULE_CACHE_BUST}", import.meta.url), { type: "module" });`,
        ],
      ],
    },
    {
      file: "webrtc.js",
      containerPath: "/moonlight-web/static/stream/transport/webrtc.js",
      replace: [
        [MOONLIGHT_WEBRTC_INIT_PEER_STOCK, MOONLIGHT_WEBRTC_INIT_PEER_PATCHED],
        // Migrate empty-ICE / STUN-only TV peers back to full ICE (TURN required via CF).
        [
          `            // MHG: on TV use empty ICE (LAN) — STUN/TURN setup can stall after peer create.
            let peerConfig = configuration || {};
            try {
                if (${MOONLIGHT_IS_TV_JS}) {
                    const raw = Array.isArray(peerConfig.iceServers) ? peerConfig.iceServers : [];
                    const filtered = [];
                    for (const server of raw) {
                        const urls = [].concat((server && server.urls) || []).map(String).filter((u) => u && !/^turns?:/i.test(u));
                        if (!urls.length)
                            continue;
                        filtered.push(Object.assign({}, server, { urls: urls.length === 1 ? urls[0] : urls }));
                    }
                    peerConfig = Object.assign({}, peerConfig, { iceServers: [] });
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`MHG TV: RTCPeerConnection with empty iceServers (LAN)\`);
                }
            }
            catch (_mhgIceErr) { }
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`MHG: calling RTCPeerConnection\`);
            this.peer = new RTCPeerConnection(peerConfig);
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`Client Peer created\`);`,
          MOONLIGHT_WEBRTC_INIT_PEER_STOCK,
        ],
        [
          `            // MHG: Cloudflare TURN in RTCPeerConnection can hang Tizen before createPipelines runs.
            let peerConfig = configuration || {};
            try {
                if (${MOONLIGHT_IS_TV_JS}) {
                    const raw = Array.isArray(peerConfig.iceServers) ? peerConfig.iceServers : [];
                    const filtered = [];
                    for (const server of raw) {
                        const urls = [].concat((server && server.urls) || []).map(String).filter((u) => u && !/^turns?:/i.test(u));
                        if (!urls.length)
                            continue;
                        filtered.push(Object.assign({}, server, { urls: urls.length === 1 ? urls[0] : urls }));
                    }
                    peerConfig = Object.assign({}, peerConfig, { iceServers: [] });
                    (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`MHG TV: RTCPeerConnection with empty iceServers (LAN)\`);
                }
            }
            catch (_mhgIceErr) { }
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`MHG: calling RTCPeerConnection\`);
            this.peer = new RTCPeerConnection(peerConfig);
            (_a = this.logger) === null || _a === void 0 ? void 0 : _a.debug(\`Client Peer created\`);`,
          MOONLIGHT_WEBRTC_INIT_PEER_STOCK,
        ],
        [MOONLIGHT_WEBRTC_AFTER_PEER_STOCK, MOONLIGHT_WEBRTC_AFTER_PEER_PATCHED],
        [MOONLIGHT_SETUP_HOST_VIDEO_STOCK, MOONLIGHT_SETUP_HOST_VIDEO_PATCHED],
      ],
    },
    {
      file: "stream_index.js",
      containerPath: "/moonlight-web/static/stream/index.js",
      replace: [
        [MOONLIGHT_CREATE_PIPELINES_STOCK, MOONLIGHT_CREATE_PIPELINES_PATCHED],
        [MOONLIGHT_TRY_WEBRTC_STOCK, MOONLIGHT_TRY_WEBRTC_PATCHED],
        [MOONLIGHT_CREATE_VIDEO_SETUP_STOCK, MOONLIGHT_CREATE_VIDEO_SETUP_PATCHED],
        [MOONLIGHT_VIDEO_TRACK_READY_STOCK, MOONLIGHT_VIDEO_TRACK_READY_PATCHED],
        [MOONLIGHT_CONN_COMPLETE_INPUT_STOCK, MOONLIGHT_CONN_COMPLETE_INPUT_PATCHED],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          `import { gatherPipeInfo } from "./pipeline/index.js?${MOONLIGHT_MODULE_CACHE_BUST}";`,
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=22";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=21";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=20";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=19";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=18";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.js?mhg=17";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { gatherPipeInfo } from "./pipeline/index.mhg23.js";',
          `import { gatherPipeInfo } from "./pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildVideoPipeline } from "./video/pipeline.js";',
          `import { buildVideoPipeline } from "./video/pipeline.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildVideoPipeline } from "./video/pipeline.mhg23.js";',
          `import { buildVideoPipeline } from "./video/pipeline.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildAudioPipeline } from "./audio/pipeline.js";',
          `import { buildAudioPipeline } from "./audio/pipeline.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildAudioPipeline } from "./audio/pipeline.mhg23.js";',
          `import { buildAudioPipeline } from "./audio/pipeline.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          `import { WebRTCTransport } from "./transport/webrtc.js?${MOONLIGHT_MODULE_CACHE_BUST}";`,
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.mhg23.js";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js?mhg=22";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js?mhg=21";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js?mhg=20";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js?mhg=19";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { WebRTCTransport } from "./transport/webrtc.js?mhg=18";',
          `import { WebRTCTransport } from "./transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
      ],
    },
    {
      file: "video_pipeline.js",
      containerPath: "/moonlight-web/static/stream/video/pipeline.js",
      replace: [
        [MOONLIGHT_BUILD_VIDEO_PIPELINE_STOCK, MOONLIGHT_BUILD_VIDEO_PIPELINE_PATCHED],
        [MOONLIGHT_BUILD_VIDEO_PIPELINE_LEGACY, MOONLIGHT_BUILD_VIDEO_PIPELINE_PATCHED],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=23";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=22";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=21";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=20";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=19";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=18";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          `import { workerPipe } from "../pipeline/worker_pipe.js?${MOONLIGHT_MODULE_CACHE_BUST}";`,
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=33";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=23";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=22";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=21";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=20";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=19";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { workerPipe } from "../pipeline/worker_pipe.js?mhg=18";',
          `import { workerPipe } from "../pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
      ],
    },
    {
      file: "audio_pipeline.js",
      containerPath: "/moonlight-web/static/stream/audio/pipeline.js",
      replace: [
        [MOONLIGHT_BUILD_AUDIO_PIPELINE_STOCK, MOONLIGHT_BUILD_AUDIO_PIPELINE_PATCHED],
        [MOONLIGHT_BUILD_AUDIO_PIPELINE_LEGACY, MOONLIGHT_BUILD_AUDIO_PIPELINE_PATCHED],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=23";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=22";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=21";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=20";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=19";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
        [
          'import { buildPipeline, gatherPipeInfo } from "../pipeline/index.js?mhg=18";',
          `import { buildPipeline, gatherPipeInfo } from "../pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
        ],
      ],
    },
    {
      file: "stream.html",
      containerPath: "/moonlight-web/static/stream.html",
      replace: [
        // Bust Tizen's aggressive cache: physical entry filename (query strings are ignored).
        [
          '<script type="module" src="stream.js" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=24" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=23" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=22" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=21" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.mhg25.js" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.mhg24.js" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          `<script type="module" src="stream.js?${MOONLIGHT_MODULE_CACHE_BUST}" defer></script>`,
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=20" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=19" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=18" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=17" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=16" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=15" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=14" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=13" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=12" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=11" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=6" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=5" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=4" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        [
          '<script type="module" src="stream.js?mhg=3" defer></script>',
          `<script type="module" src="${MOONLIGHT_STREAM_ENTRY}" defer></script>`,
        ],
        // Seed TV-friendly settings before modules load (overrides stale localStorage).
        [
          `    <script>
        try {
            const raw = localStorage.getItem("mlSettings");
            const parsed = raw ? JSON.parse(raw) : null;
            const language = parsed && (parsed.language === "zh-CN" || parsed.language === "zh" || parsed.language === "zh_CN")
                ? "zh-CN"
                : "en";
            document.documentElement.lang = language;
            document.documentElement.translate = false;
            document.documentElement.classList.add("notranslate");
        } catch (_err) { }
    </script>`,
          `    <script>
        try {
            const raw = localStorage.getItem("mlSettings");
            const parsed = raw ? JSON.parse(raw) : null;
            const language = parsed && (parsed.language === "zh-CN" || parsed.language === "zh" || parsed.language === "zh_CN")
                ? "zh-CN"
                : "en";
            document.documentElement.lang = language;
            document.documentElement.translate = false;
            document.documentElement.classList.add("notranslate");
        } catch (_err) { }
        // MHG: smart TV - WebRTC video element + unmute/fullscreen helpers for the remote
        try {
            const profile = new URLSearchParams(location.search).get("mhgProfile");
            const ua = String(navigator.userAgent || "").toLowerCase();
            const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
            if (isTv) {
                window.__MHG_TV__ = true;
                const raw = localStorage.getItem("mlSettings");
                const settings = raw ? JSON.parse(raw) : {};
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});
                localStorage.setItem("mlSettings", JSON.stringify(settings));
            }
        } catch (_tvErr) { }
    </script>`,
        ],
        // Migrate earlier TV seed (mhg=3) that lacked __MHG_TV__.
        [
          `        // MHG: smart TV — prefer WebRTC + HTML video (canvas freezes on first frame on Tizen)
        try {
            const profile = new URLSearchParams(location.search).get("mhgProfile");
            const ua = String(navigator.userAgent || "").toLowerCase();
            const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
            if (isTv) {
                const raw = localStorage.getItem("mlSettings");
                const settings = raw ? JSON.parse(raw) : {};
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});
                localStorage.setItem("mlSettings", JSON.stringify(settings));
            }
        } catch (_tvErr) { }`,
          `        // MHG: smart TV - WebRTC video element + unmute/fullscreen helpers for the remote
        try {
            const profile = new URLSearchParams(location.search).get("mhgProfile");
            const ua = String(navigator.userAgent || "").toLowerCase();
            const isTv = profile === "tv" || /tizen|webos|web0s|smart-tv|smarttv|viera|bravia|hbbtv|vidaa|netcast/.test(ua);
            if (isTv) {
                window.__MHG_TV__ = true;
                const raw = localStorage.getItem("mlSettings");
                const settings = raw ? JSON.parse(raw) : {};
                Object.assign(settings, ${MOONLIGHT_TV_SETTINGS_JSON});
                localStorage.setItem("mlSettings", JSON.stringify(settings));
            }
        } catch (_tvErr) { }`,
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
        // Never re-inject the TV focus IIFE after startApp/leave when one already exists —
        // a newer hook string would otherwise stack duplicates (double D-pad handlers).
        if (
          entry.file === "stream.js" &&
          from.includes("startApp();") &&
          to.includes("__MHG_TV_FOCUS_HOOK__") &&
          body.includes("__MHG_TV_FOCUS_HOOK__")
        ) {
          continue;
        }
        body = body.replace(from, to);
        changed = true;
      }
      if (entry.file === "stream.js") {
        const deduped = dedupeMoonlightTvFocusHooks(body);
        if (deduped !== body) {
          body = deduped;
          changed = true;
        }
      }
      if (!changed) continue;
      body = normalizeMoonlightModuleImports(body, MOONLIGHT_MODULE_ALIAS);
      fs.writeFileSync(hostPath, body, "utf8");
      execFileSync("docker", ["cp", hostPath, `${DOCKER_CONTAINER_NAME}:${entry.containerPath}`], {
        stdio: "pipe",
        timeout: 30_000,
      });
      applied += 1;
    }

    // Physical path aliases: Tizen often ignores ?mhg= on nested ES imports and keeps
    // stale stream/index.js / webrtc.js forever. New filenames force a fresh module graph.
    const aliasCopies = [
      {
        src: "/moonlight-web/static/stream.js",
        dest: `/moonlight-web/static/${MOONLIGHT_STREAM_ENTRY}`,
      },
      {
        src: "/moonlight-web/static/stream/index.js",
        dest: `/moonlight-web/static/stream/index.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
      {
        src: "/moonlight-web/static/stream/transport/webrtc.js",
        dest: `/moonlight-web/static/stream/transport/webrtc.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
      {
        src: "/moonlight-web/static/stream/pipeline/index.js",
        dest: `/moonlight-web/static/stream/pipeline/index.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
      {
        src: "/moonlight-web/static/stream/video/pipeline.js",
        dest: `/moonlight-web/static/stream/video/pipeline.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
      {
        src: "/moonlight-web/static/stream/audio/pipeline.js",
        dest: `/moonlight-web/static/stream/audio/pipeline.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
      {
        src: "/moonlight-web/static/stream/pipeline/worker_pipe.js",
        dest: `/moonlight-web/static/stream/pipeline/worker_pipe.${MOONLIGHT_MODULE_ALIAS}.js`,
      },
    ];
    for (const { src, dest } of aliasCopies) {
      const hostSrc = path.join(tmpDir, `alias-src-${path.basename(src)}`);
      try {
        execFileSync("docker", ["cp", `${DOCKER_CONTAINER_NAME}:${src}`, hostSrc], {
          stdio: "pipe",
          timeout: 30_000,
        });
        let aliasBody = normalizeMoonlightModuleImports(fs.readFileSync(hostSrc, "utf8"), MOONLIGHT_MODULE_ALIAS);
        fs.writeFileSync(hostSrc, aliasBody, "utf8");
        execFileSync("docker", ["cp", hostSrc, `${DOCKER_CONTAINER_NAME}:${dest}`], {
          stdio: "pipe",
          timeout: 30_000,
        });
        // Keep canonical sources in sync when they are nested modules.
        if (src !== "/moonlight-web/static/stream.js") {
          execFileSync("docker", ["cp", hostSrc, `${DOCKER_CONTAINER_NAME}:${src}`], {
            stdio: "pipe",
            timeout: 30_000,
          });
        }
        applied += 1;
      } catch {
        // ignore missing source
      }
    }

    // Publish boot module + versioned HTML. Boot replaces createPipelines on TV before the app runs.
    try {
      const bootSource = `// MHG boot ${MOONLIGHT_MODULE_ALIAS} — absolute /${MOONLIGHT_BOOT_ENTRY}
import { Stream } from "/stream/index.${MOONLIGHT_MODULE_ALIAS}.js";

try {
  window.__MHG_BOOT__ = "${MOONLIGHT_MODULE_ALIAS}";
  const isTv = ${MOONLIGHT_IS_TV_JS};
  if (isTv && Stream && Stream.prototype) {
    Stream.prototype.createPipelines = function () {
      const self = this;
      return (async function () {
        const [supportedVideoCodecs] = await Promise.all([
          self.createVideoRenderer(),
          self.createAudioPlayer(),
        ]);
        try { self.stats && self.stats.setVideoPipeline && self.stats.setVideoPipeline("tv-boot", self.videoRenderer); } catch (_sv) {}
        try { self.stats && self.stats.setAudioPipeline && self.stats.setAudioPipeline("tv-boot", self.audioPlayer); } catch (_sa) {}
        return supportedVideoCodecs;
      })();
    };
    if (!Stream.prototype.__MHG_TV_PATCHED__) {
      Stream.prototype.__MHG_TV_PATCHED__ = true;
      Stream.prototype.setTransport = function (transport) {
        try {
          if (this.transport && this.transport !== transport && typeof this.transport.close === "function") {
            try { this.transport.close(); } catch (_c) {}
          }
        } catch (_old) {}
        this.transport = transport;
        try {
          if (this.stats && typeof this.stats.setTransport === "function") {
            this.stats.setTransport(transport);
          }
        } catch (_stErr) {}
      };
      const _origStart = Stream.prototype.startStream;
      if (typeof _origStart === "function") {
        Stream.prototype.startStream = function () {
          const self = this;
          const ret = _origStart.apply(this, arguments);
          try {
            if (self.transport && self.input && typeof self.input.setTransport === "function") {
              window.setTimeout(function () {
                try { self.input.setTransport(self.transport); } catch (_inErr) {}
              }, 0);
            }
          } catch (_w) {}
          return ret;
        };
      }
    }
  }
} catch (err) {
  console.warn("MHG boot failed", err);
}
`;
      const bootHost = path.join(tmpDir, MOONLIGHT_BOOT_ENTRY);
      fs.writeFileSync(bootHost, bootSource, "utf8");
      execFileSync("docker", ["cp", bootHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/${MOONLIGHT_BOOT_ENTRY}`], {
        stdio: "pipe",
        timeout: 30_000,
      });

      const htmlHost = path.join(tmpDir, "stream-html-publish.html");
      execFileSync("docker", ["cp", `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/stream.html`, htmlHost], {
        stdio: "pipe",
        timeout: 30_000,
      });
      let htmlBody = fs.readFileSync(htmlHost, "utf8");
      // Remove prior MHG script tags / markers, then inject boot + entry once.
      htmlBody = htmlBody
        .replace(/<!-- mhg-entry=mhg\d+ -->\s*/g, "")
        .replace(/<\s*base\s[^>]*>\s*/gi, "")
        .replace(/<script type="module" src="[^"]*(?:mhg-boot|\/?stream)[^"]*"[^>]*>\s*<\/script>\s*/g, "");

      // Root-absolute asset URLs — /mhgN/stream.html must not resolve styles under /mhgN/.
      htmlBody = htmlBody
        .replace(/(href|src)="(?:\.\.\/)?styles\//g, '$1="/styles/')
        .replace(/(href|src)="(?:\.\.\/)?resources\//g, '$1="/resources/');

      const scriptBlock = `    <!-- mhg-entry=${MOONLIGHT_MODULE_ALIAS} -->
    <script type="module" src="/${MOONLIGHT_BOOT_ENTRY}"></script>
    <script type="module" src="/${MOONLIGHT_STREAM_ENTRY}"></script>
`;
      // <base> FIRST in <head> so every relative URL is root-absolute (Tizen-safe with /styles too).
      htmlBody = htmlBody.replace(/<\s*head([^>]*)>/i, `<head$1>\n    <base href="/" />`);
      if (htmlBody.includes('src="/styles/index.js"')) {
        htmlBody = htmlBody.replace(
          '<script type="module" src="/styles/index.js"></script>',
          `<script type="module" src="/styles/index.js"></script>\n${scriptBlock}`,
        );
      } else if (htmlBody.includes('src="styles/index.js"')) {
        htmlBody = htmlBody.replace(
          '<script type="module" src="styles/index.js"></script>',
          `<script type="module" src="/styles/index.js"></script>\n${scriptBlock}`,
        );
      } else {
        htmlBody = htmlBody.replace("</head>", `${scriptBlock}</head>`);
      }

      // Patch styles/index.js so setStyle always uses /styles/*.css (ignores broken baseURI).
      try {
        const stylesHost = path.join(tmpDir, "styles-index.js");
        execFileSync("docker", ["cp", `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/styles/index.js`, stylesHost], {
          stdio: "pipe",
          timeout: 15_000,
        });
        let stylesBody = fs.readFileSync(stylesHost, "utf8");
        if (!stylesBody.includes("MHG: root-absolute styles")) {
          stylesBody = stylesBody.replace(
            "const path = `styles/${style}.css`;\n    const absolute = toAbsolute(path);",
            "// MHG: root-absolute styles (page may live under /mhgN/stream.html)\n" +
              "    const path = `/styles/${style}.css`;\n" +
              "    const absolute = new URL(path, window.location.origin).href;",
          );
          fs.writeFileSync(stylesHost, stylesBody, "utf8");
          execFileSync("docker", ["cp", stylesHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/styles/index.js`], {
            stdio: "pipe",
            timeout: 15_000,
          });
        }
      } catch {
        // ignore
      }

      fs.writeFileSync(htmlHost, htmlBody, "utf8");
      execFileSync("docker", ["cp", htmlHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/stream.html`], {
        stdio: "pipe",
        timeout: 30_000,
      });
      execFileSync("docker", ["exec", DOCKER_CONTAINER_NAME, "mkdir", "-p", `/moonlight-web/static/${MOONLIGHT_MODULE_ALIAS}`], {
        stdio: "pipe",
        timeout: 15_000,
      });
      execFileSync(
        "docker",
        ["cp", htmlHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/${MOONLIGHT_STREAM_HTML_PATH}`],
        { stdio: "pipe", timeout: 30_000 },
      );
      applied += 1;
    } catch {
      // ignore
    }

    // Ensure stream entry imports current index alias (no interleaved wrap — boot handles TV).
    try {
      const streamHost = path.join(tmpDir, "stream-entry-publish.js");
      execFileSync("docker", ["cp", `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/stream.js`, streamHost], {
        stdio: "pipe",
        timeout: 30_000,
      });
      let streamBody = normalizeMoonlightModuleImports(fs.readFileSync(streamHost, "utf8"), MOONLIGHT_MODULE_ALIAS);
      // Strip previous MHG boots / wraps that interleaved imports (breaks some Tizen parsers).
      streamBody = streamBody.replace(/^\/\/ MHG entry[\s\S]*?(?=var __awaiter|import )/m, "");
      streamBody = streamBody.replace(/\n\/\/ MHG: runtime TV guard[\s\S]*?catch \(_mhgWrapErr\) \{[^}]*\}\n/g, "\n");
      streamBody = streamBody.replace(
        /import \{ Stream \} from "\.\/stream\/index[^"]+";/,
        `import { Stream } from "./stream/index.${MOONLIGHT_MODULE_ALIAS}.js";`,
      );
      if (!streamBody.startsWith(`// MHG entry ${MOONLIGHT_MODULE_ALIAS}`)) {
        streamBody = `// MHG entry ${MOONLIGHT_MODULE_ALIAS}\n` + streamBody;
      }
      fs.writeFileSync(streamHost, streamBody, "utf8");
      execFileSync("docker", ["cp", streamHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/stream.js`], {
        stdio: "pipe",
        timeout: 30_000,
      });
      execFileSync(
        "docker",
        ["cp", streamHost, `${DOCKER_CONTAINER_NAME}:/moonlight-web/static/${MOONLIGHT_STREAM_ENTRY}`],
        { stdio: "pipe", timeout: 30_000 },
      );
      applied += 1;
    } catch {
      // ignore
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
    const response = await requestMoonlightWebJson({
      baseUrl: normalized,
      urlString: `${normalized}/api/role`,
      method: "PATCH",
      body: { id: role.id, ty: roleType, default_settings: nextDefaults },
      cookie,
      timeoutMs: 30_000,
    });    result.rolePatched = true;
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
  resolveMoonlightAppStreamUrl,
  resolveMoonlightDesktopStreamUrl,
  buildMoonlightAppStreamUrl,
  buildMoonlightDesktopStreamUrl,
  rewriteMoonlightStreamHtmlPath,
  attachMoonlightStopHook,
  listMoonlightApps,
  pickMoonlightApp,
  pickDesktopApp,
  isDesktopMoonlightApp,
  listMoonlightUsers,
  readDockerMoonlightConfig,
  writeDockerMoonlightConfig,
  restartDockerMoonlight,
  patchMoonlightStaticFullscreenAssets,
  shouldUseMoonlightTvProfile,
  MOONLIGHT_TV_STREAM_SETTINGS,
  MOONLIGHT_STREAM_HTML_PATH,
  MOONLIGHT_STREAM_ENTRY,
  MOONLIGHT_MODULE_ALIAS,
};
