"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ensureMoonlightWebBinary,
  findMoonlightWebExecutable,
  resolveMoonlightWebInstallDir,
} = require("./moonlightWebBinary");
const {
  probeMoonlightWebReachable,
  readStreamingSettings,
  defaultManagedMoonlightWebUrl,
  syncMoonlightWebUrlFromApiBase,
  shouldSyncMoonlightWebUrlFromApiBase,
} = require("./streaming");
const { ensureMoonlightWebAdminCredentials, resolveMoonlightWebApiCookie } = require("./moonlightWebCredentials");
const { ensureMoonlightWebSunshinePairing } = require("./moonlightWebPairing");
const { listMoonlightHosts, hostLooksPaired } = require("./moonlightWebPairing");
const {
  ensureMoonlightWebDefaultUser,
  ensureMoonlightEnterFullscreenDefault,
  repairMoonlightWebV3Config,
} = require("./moonlightWebEmbed");
const { ensureMoonlightCloudflareTurnIce } = require("./moonlightWebTurn");
const { moonlightWebPublicUrlFromApiBase } = require("./tunnelHostname");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";

/** @type {import('child_process').ChildProcess | null} */
let managedChild = null;
/** @type {string | null} */
let managedExecutable = null;
/** @type {'native' | null} */
let managedKind = null;
let manageLifecycle = false;

function isMoonlightWebEnabled(env = process.env) {
  return env.MOONLIGHT_WEB_ENABLED !== "false";
}

function resolveMoonlightWebPort(env = process.env) {
  const port = Number(env.MOONLIGHT_WEB_PORT || 8080);
  return Number.isFinite(port) && port > 0 ? port : 8080;
}

function resolveLanIpHint() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function stopDockerMoonlightContainer() {
  try {
    execFileSync("docker", ["rm", "-f", DOCKER_CONTAINER_NAME], {
      stdio: "pipe",
      timeout: 30_000,
    });
    console.log("Removed the leftover Moonlight Web Docker container.");
  } catch {
    // Docker is absent, or the container was never created.
  }
}

function killManagedChild() {
  if (!managedChild || managedChild.killed) return;
  try {
    if (process.platform === "win32") {
      if (managedChild.pid) {
        const child = spawn(
          "taskkill",
          ["/PID", String(managedChild.pid), "/T", "/F"],
          { stdio: "ignore", detached: true, windowsHide: true },
        );
        child.unref();
      }
    } else if (managedChild.pid) {
      try {
        process.kill(-managedChild.pid, "SIGTERM");
      } catch {
        managedChild.kill("SIGTERM");
      }
    }
  } catch {
    // ignore
  }
  managedChild = null;
}

function moonlightPackageRoot(installDir) {
  const executable = managedExecutable || findMoonlightWebExecutable(installDir);
  return executable ? path.dirname(executable) : null;
}

async function restartManagedNativeMoonlight(port, env, url) {
  const executable = managedExecutable;
  if (!executable || !managedChild) {
    console.warn("Moonlight Web config changed. Restart the web-server process to apply it.");
    return false;
  }
  killManagedChild();
  startNativeMoonlightWeb(executable, port, env);
  const ready = await waitForMoonlightWeb(url, 120_000);
  if (!ready) {
    console.warn("Moonlight Web did not become ready after restart.");
  }
  return ready;
}

function startNativeMoonlightWeb(executable, port, env = process.env, version = null) {
  const cwd = path.dirname(executable);
  try {
    if (repairMoonlightWebV3Config(cwd, version)) {
      console.log("Repaired Moonlight Web config.json for v3.");
    }
  } catch (error) {
    console.warn(`Could not repair Moonlight Web config: ${error.message || error}`);
  }
  const childEnv = { ...process.env, ...env };
  if (!childEnv.BIND_ADDRESS) {
    childEnv.BIND_ADDRESS = `0.0.0.0:${port}`;
  }
  if (!childEnv.WEB_SERVER_BIND_ADDRESS) {
    childEnv.WEB_SERVER_BIND_ADDRESS = childEnv.BIND_ADDRESS;
  }

  const child = spawn(executable, [], {
    cwd: fs.existsSync(cwd) ? cwd : undefined,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: childEnv,
  });

  const logStream = (chunk) => {
    const line = String(chunk || "").trim();
    if (line) console.error(`Moonlight Web: ${line}`);
  };
  child.stdout?.on("data", logStream);
  child.stderr?.on("data", logStream);
  child.on("error", (error) => {
    console.error("Moonlight Web process error:", error.message || error);
  });
  child.on("exit", (code) => {
    if (code) console.error(`Moonlight Web exited (${code}).`);
  });
  if (process.platform !== "win32") child.unref();

  managedChild = child;
  managedExecutable = executable;
  managedKind = "native";
  return child;
}

async function waitForMoonlightWeb(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probeMoonlightWebReachable(url)) return true;
    if (managedChild && managedChild.exitCode != null) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Persist URL + enable remote streaming so the user does not need settings UI.
 */
function persistManagedStreamingSettings({
  readSettings,
  writeSettings,
  url,
  forceUrl = false,
  hostId = null,
  env = process.env,
}) {
  if (typeof readSettings !== "function" || typeof writeSettings !== "function" || !url) {
    return;
  }
  if (shouldSyncMoonlightWebUrlFromApiBase(env)) {
    syncMoonlightWebUrlFromApiBase({
      readSettings,
      writeSettings,
      apiBase: env.API_BASE,
      env,
      hostId,
    });
    return;
  }
  try {
    const settings = readSettings() || {};
    const current = String(settings.moonlightWebUrl || "").trim();
    const nextUrl = forceUrl
      ? url
      : current || url;
    const next = {
      ...settings,
      moonlightWebUrl: nextUrl,
      remoteStreamingEnabled: true,
    };
    if (hostId != null && Number.isFinite(Number(hostId))) {
      next.moonlightDesktopHostId = Number(hostId);
      // Application stream id is resolved per launch — do not cache Desktop app id.
      next.moonlightDesktopAppId = null;
    }
    const changed =
      next.moonlightWebUrl !== settings.moonlightWebUrl ||
      next.remoteStreamingEnabled !== settings.remoteStreamingEnabled ||
      next.moonlightDesktopHostId !== settings.moonlightDesktopHostId ||
      next.moonlightDesktopAppId !== settings.moonlightDesktopAppId;
    if (!changed) return;
    writeSettings(next);
    console.log(`Remote streaming configured automatically (${next.moonlightWebUrl})`);
  } catch (error) {
    console.warn(`Could not persist Moonlight Web settings: ${error.message || error}`);
  }
}

async function bootstrapMoonlightWebAdminAndPair(
  url,
  {
    kind = null,
    env = process.env,
    installDir = null,
    packageRoot = null,
    port = null,
    readSettings = null,
    writeSettings = null,
  } = {},
) {
  try {
    const auth = await ensureMoonlightWebAdminCredentials(url, env);
    const effectiveKind = kind || managedKind;
    let defaultUserId = null;
    try {
      const defaultUser = await ensureMoonlightWebDefaultUser({
        baseUrl: url,
        cookie: auth.cookie,
        username: auth.username,
        packageRoot,
        env,
      });
      defaultUserId = defaultUser.userId || null;
      if (defaultUser.restarted) {
        await restartManagedNativeMoonlight(port, env, url);
      }
    } catch (error) {
      console.warn(`Could not configure Moonlight Web default user: ${error.message || error}`);
    }

    let apiCookie = resolveMoonlightWebApiCookie({
      kind: effectiveKind,
      defaultUserId,
      sessionCookie: auth.cookie,
    });

    try {
      await ensureMoonlightEnterFullscreenDefault({
        baseUrl: url,
        cookie: apiCookie,
        staticDir: packageRoot ? path.join(packageRoot, "static") : null,
      });
    } catch (error) {
      console.warn(
        `Could not configure Moonlight Web fullscreen default: ${error.message || error}`,
      );
    }
    try {
      const httpPort = Number(env.HTTP_PORT || 4000) || 4000;
      const turn = await ensureMoonlightCloudflareTurnIce({
        installDir,
        packageRoot,
        httpPort,
        env,
      });
      if (turn.restarted) {
        await restartManagedNativeMoonlight(port, env, url);
        apiCookie = resolveMoonlightWebApiCookie({
          kind: effectiveKind,
          defaultUserId,
          sessionCookie: "",
        });
      }
    } catch (error) {
      console.warn(`Could not configure Cloudflare TURN for Moonlight Web: ${error.message || error}`);
    }
    try {
      await ensureMoonlightWebSunshinePairing({
        baseUrl: url,
        cookie: apiCookie,
        kind: effectiveKind,
        env,
        lanIp: resolveLanIpHint(),
      });
    } catch (error) {
      console.warn(`Could not auto-pair Moonlight Web with Sunshine: ${error.message || error}`);
    }
    try {
      const settings = typeof readSettings === "function" ? readSettings() || {} : {};
      const streaming = readStreamingSettings(settings);
      const hosts = await listMoonlightHosts(url, apiCookie);
      const host =
        hosts.find((item) => hostLooksPaired(item)) ||
        hosts[0] ||
        null;
      const publicFromTunnel = moonlightWebPublicUrlFromApiBase(env.API_BASE || "");
      persistManagedStreamingSettings({
        readSettings,
        writeSettings,
        url: publicFromTunnel || url,
        forceUrl: Boolean(publicFromTunnel),
        hostId: host?.host_id ?? streaming.moonlightDesktopHostId ?? null,
      });
      if (host?.host_id != null) {
        console.log(`Moonlight host ready (host ${host.host_id}); application streams are registered per game.`);
      }
    } catch (error) {
      console.warn(`Could not cache Moonlight host id: ${error.message || error}`);
    }
  } catch (error) {
    console.warn(`Could not bootstrap Moonlight Web admin: ${error.message || error}`);
  }
}

async function ensureMoonlightWebRunning({
  metadataPath,
  readSettings,
  writeSettings,
  env = process.env,
} = {}) {
  if (!isMoonlightWebEnabled(env)) {
    return { started: false, reason: "disabled" };
  }

  syncMoonlightWebUrlFromApiBase({ readSettings, writeSettings, env });
  const settings = typeof readSettings === "function" ? readSettings() : {};
  const streaming = readStreamingSettings(settings);
  const port = resolveMoonlightWebPort(env);
  const managedUrl = defaultManagedMoonlightWebUrl(port);
  const publicFromTunnel = moonlightWebPublicUrlFromApiBase(env.API_BASE || "");
  const preferredUrl = publicFromTunnel || streaming.moonlightWebUrl || managedUrl;
  const installDir = resolveMoonlightWebInstallDir(metadataPath);
  stopDockerMoonlightContainer();

  if (await probeMoonlightWebReachable(preferredUrl) || await probeMoonlightWebReachable(managedUrl)) {
    manageLifecycle = true;
    managedExecutable = managedExecutable || findMoonlightWebExecutable(installDir);
    managedKind = managedExecutable ? "native" : null;
    console.log("Moonlight Web is already reachable.");
    const persistUrl = publicFromTunnel || streaming.moonlightWebUrl || managedUrl;
    persistManagedStreamingSettings({
      readSettings,
      writeSettings,
      url: persistUrl,
      forceUrl: Boolean(publicFromTunnel),
    });
    await bootstrapMoonlightWebAdminAndPair(managedUrl, {
      kind: "native",
      env,
      installDir,
      packageRoot: moonlightPackageRoot(installDir),
      port,
      readSettings,
      writeSettings,
    });
    return { started: false, reason: "already-running", url: persistUrl };
  }

  const installed = await ensureMoonlightWebBinary({ metadataPath, env });
  if (!installed.executable) {
    throw new Error(`Moonlight Web package in ${installed.installDir} has no web-server executable`);
  }
  manageLifecycle = true;

  console.log(`Starting Moonlight Web (${installed.version || "unknown"})...`);
  startNativeMoonlightWeb(installed.executable, port, env, installed.version);

  const ready = await waitForMoonlightWeb(managedUrl);
  const persistUrl = publicFromTunnel || managedUrl;
  persistManagedStreamingSettings({
    readSettings,
    writeSettings,
    url: persistUrl,
    forceUrl: Boolean(publicFromTunnel),
  });

  if (ready) {
    await bootstrapMoonlightWebAdminAndPair(managedUrl, {
      kind: "native",
      env,
      installDir: installed.installDir,
      packageRoot: path.dirname(installed.executable),
      port,
      readSettings,
      writeSettings,
    });
    console.log(`Moonlight Web is ready at ${managedUrl}`);
    return { started: true, url: persistUrl, kind: "native", ready: true };
  }

  console.warn(`Moonlight Web was started but is not responding yet at ${managedUrl}.`);
  return { started: true, url: persistUrl, kind: "native", ready: false };
}

function stopManagedMoonlightWeb() {
  if (!manageLifecycle && !managedChild) {
    managedChild = null;
    managedExecutable = null;
    managedKind = null;
    return;
  }

  console.log("Stopping Moonlight Web...");
  killManagedChild();
  managedExecutable = null;
  managedKind = null;
  manageLifecycle = false;
}

module.exports = {
  DOCKER_CONTAINER_NAME,
  isMoonlightWebEnabled,
  resolveMoonlightWebPort,
  resolveLanIpHint,
  ensureMoonlightWebRunning,
  stopManagedMoonlightWeb,
  findMoonlightWebExecutable,
};
