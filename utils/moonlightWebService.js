"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ensureMoonlightWebBinary,
  findMoonlightWebExecutable,
  resolveMoonlightWebInstallDir,
  readInstallManifest,
} = require("./moonlightWebBinary");
const {
  probeMoonlightWebReachable,
  readStreamingSettings,
  defaultManagedMoonlightWebUrl,
} = require("./streaming");
const { ensureMoonlightWebAdminCredentials } = require("./moonlightWebCredentials");
const { ensureMoonlightWebSunshinePairing } = require("./moonlightWebPairing");
const { ensureMoonlightWebDefaultUser } = require("./moonlightWebEmbed");

const DOCKER_CONTAINER_NAME = "myhomegames-moonlight-web";

/** @type {import('child_process').ChildProcess | null} */
let managedChild = null;
/** @type {string | null} */
let managedExecutable = null;
/** @type {'native' | 'docker' | null} */
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

function dockerContainerRunning(name) {
  try {
    return (
      execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

function dockerContainerExists(name) {
  try {
    execFileSync("docker", ["inspect", name], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function dockerContainerImage(name) {
  try {
    return execFileSync("docker", ["inspect", "-f", "{{.Config.Image}}", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

function startDockerMoonlightWeb({ image, installDir, port, env = process.env }) {
  const dataDir = path.join(installDir, "docker-data");
  fs.mkdirSync(dataDir, { recursive: true });

  if (dockerContainerExists(DOCKER_CONTAINER_NAME)) {
    const currentImage = dockerContainerImage(DOCKER_CONTAINER_NAME);
    if (currentImage && currentImage !== image) {
      try {
        execFileSync("docker", ["rm", "-f", DOCKER_CONTAINER_NAME], { stdio: "pipe", timeout: 30_000 });
      } catch {
        // ignore
      }
    }
  }

  if (dockerContainerRunning(DOCKER_CONTAINER_NAME)) {
    managedKind = "docker";
    managedExecutable = null;
    managedChild = null;
    return { mode: "already-running" };
  }

  if (dockerContainerExists(DOCKER_CONTAINER_NAME)) {
    try {
      execFileSync("docker", ["start", DOCKER_CONTAINER_NAME], { stdio: "pipe", timeout: 60_000 });
      managedKind = "docker";
      managedExecutable = null;
      managedChild = null;
      return { mode: "started-existing" };
    } catch {
      try {
        execFileSync("docker", ["rm", "-f", DOCKER_CONTAINER_NAME], { stdio: "pipe", timeout: 30_000 });
      } catch {
        // ignore
      }
    }
  }

  const lanIp = env.WEBRTC_NAT_1TO1_HOST?.trim() || resolveLanIpHint();
  const udpRange = env.MOONLIGHT_WEB_UDP_RANGE?.trim() || "40000-40100";
  const args = [
    "run",
    "-d",
    "--name",
    DOCKER_CONTAINER_NAME,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    `${port}:8080`,
    "-p",
    `${udpRange}:${udpRange}/udp`,
    "-e",
    `WEBRTC_NAT_1TO1_HOST=${lanIp}`,
    "-v",
    `${dataDir}:/data`,
    image,
  ];

  execFileSync("docker", args, { stdio: "pipe", timeout: 120_000 });
  managedKind = "docker";
  managedExecutable = null;
  managedChild = null;
  return { mode: "created" };
}

function startNativeMoonlightWeb(executable, port, env = process.env) {
  const cwd = path.dirname(executable);
  const childEnv = { ...process.env, ...env };
  if (!childEnv.WEB_SERVER_BIND_ADDRESS) {
    childEnv.WEB_SERVER_BIND_ADDRESS = `0.0.0.0:${port}`;
  }

  const child = spawn(executable, [], {
    cwd: fs.existsSync(cwd) ? cwd : undefined,
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
    env: childEnv,
  });

  child.on("error", (error) => {
    console.error("Moonlight Web process error:", error.message || error);
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
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

/**
 * Persist URL + enable remote streaming so the user does not need settings UI.
 */
function persistManagedStreamingSettings({ readSettings, writeSettings, url }) {
  if (typeof readSettings !== "function" || typeof writeSettings !== "function" || !url) {
    return;
  }
  try {
    const settings = readSettings() || {};
    const next = {
      ...settings,
      moonlightWebUrl: String(settings.moonlightWebUrl || "").trim() || url,
      remoteStreamingEnabled: true,
    };
    const changed =
      next.moonlightWebUrl !== settings.moonlightWebUrl ||
      next.remoteStreamingEnabled !== settings.remoteStreamingEnabled;
    if (!changed) return;
    writeSettings(next);
    console.log(`Remote streaming configured automatically (${next.moonlightWebUrl})`);
  } catch (error) {
    console.warn(`Could not persist Moonlight Web settings: ${error.message || error}`);
  }
}

async function bootstrapMoonlightWebAdminAndPair(url, { kind = null, env = process.env } = {}) {
  try {
    const auth = await ensureMoonlightWebAdminCredentials(url, env);
    const effectiveKind = kind || managedKind;
    try {
      const defaultUser = await ensureMoonlightWebDefaultUser({
        baseUrl: url,
        cookie: auth.cookie,
        username: auth.username,
        kind: effectiveKind,
        env,
      });
      if (defaultUser.restarted) {
        const ready = await waitForMoonlightWeb(url, 120_000);
        if (!ready) {
          console.warn("Moonlight Web did not become ready after default_user_id restart.");
        }
        // Re-login after restart so pairing uses a fresh session cookie.
        const refreshed = await ensureMoonlightWebAdminCredentials(url, env);
        auth.cookie = refreshed.cookie;
      }
    } catch (error) {
      console.warn(`Could not configure Moonlight Web default user: ${error.message || error}`);
    }
    try {
      await ensureMoonlightWebSunshinePairing({
        baseUrl: url,
        cookie: auth.cookie,
        kind: effectiveKind,
        env,
        lanIp: resolveLanIpHint(),
      });
    } catch (error) {
      console.warn(`Could not auto-pair Moonlight Web with Sunshine: ${error.message || error}`);
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

  const settings = typeof readSettings === "function" ? readSettings() : {};
  const streaming = readStreamingSettings(settings);
  const port = resolveMoonlightWebPort(env);
  const managedUrl = defaultManagedMoonlightWebUrl(port);
  const probeUrl = streaming.moonlightWebUrl || managedUrl;

  if (await probeMoonlightWebReachable(probeUrl)) {
    manageLifecycle = true;
    managedKind = readInstallManifest(resolveMoonlightWebInstallDir(metadataPath))?.kind || null;
    console.log("Moonlight Web is already reachable.");
    persistManagedStreamingSettings({ readSettings, writeSettings, url: probeUrl });
    await bootstrapMoonlightWebAdminAndPair(probeUrl, { kind: managedKind, env });
    return { started: false, reason: "already-running", url: probeUrl };
  }

  const installed = await ensureMoonlightWebBinary({ metadataPath, env });
  manageLifecycle = true;

  console.log(`Starting Moonlight Web (${installed.version || "unknown"}, ${installed.kind})...`);

  if (installed.kind === "docker") {
    startDockerMoonlightWeb({
      image: installed.image,
      installDir: installed.installDir,
      port,
      env,
    });
  } else {
    startNativeMoonlightWeb(installed.executable, port, env);
  }

  const ready = await waitForMoonlightWeb(managedUrl);
  persistManagedStreamingSettings({ readSettings, writeSettings, url: managedUrl });

  if (ready) {
    await bootstrapMoonlightWebAdminAndPair(managedUrl, { kind: installed.kind, env });
    console.log(`Moonlight Web is ready at ${managedUrl}`);
    return { started: true, url: managedUrl, kind: installed.kind, ready: true };
  }

  console.warn(
    `Moonlight Web was started but is not responding yet at ${managedUrl}. ` +
      "If using Docker, confirm Docker Desktop is running.",
  );
  return { started: true, url: managedUrl, kind: installed.kind, ready: false };
}

function stopManagedMoonlightWeb() {
  if (!manageLifecycle && !managedChild) {
    managedChild = null;
    managedExecutable = null;
    managedKind = null;
    return;
  }

  console.log("Stopping Moonlight Web...");

  if (managedKind === "docker" || dockerContainerExists(DOCKER_CONTAINER_NAME)) {
    try {
      execFileSync("docker", ["stop", DOCKER_CONTAINER_NAME], { stdio: "pipe", timeout: 60_000 });
    } catch {
      // ignore
    }
  }

  if (managedChild && !managedChild.killed) {
    try {
      if (process.platform === "win32") {
        if (managedChild.pid) {
          execFileSync("taskkill", ["/PID", String(managedChild.pid), "/T", "/F"], { stdio: "ignore" });
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
  }

  if (managedExecutable) {
    try {
      execFileSync("pkill", ["-TERM", "-f", managedExecutable], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }

  managedChild = null;
  managedExecutable = null;
  managedKind = null;
  manageLifecycle = false;
}

module.exports = {
  DOCKER_CONTAINER_NAME,
  isMoonlightWebEnabled,
  resolveMoonlightWebPort,
  ensureMoonlightWebRunning,
  stopManagedMoonlightWeb,
  findMoonlightWebExecutable,
};
