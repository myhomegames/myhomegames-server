"use strict";

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const DOCKER_DESKTOP_APP = "/Applications/Docker.app";

function commandExists(command) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [command], {
      stdio: "pipe",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBrewBinary() {
  const candidates = [
    process.env.HOMEBREW_PREFIX ? path.join(process.env.HOMEBREW_PREFIX, "bin", "brew") : null,
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (commandExists("brew")) return "brew";
  return null;
}

function runCommand(command, args, { timeoutMs = 120_000, env = process.env, inherit = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...env },
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].map((chunk) => chunk?.trim()).filter(Boolean).join(" — ");
    throw new Error(detail || `${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
  return (result.stdout || "").trim();
}

function isDockerDaemonReady() {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

function isColimaInstalled() {
  return commandExists("colima") || fs.existsSync("/opt/homebrew/bin/colima") || fs.existsSync("/usr/local/bin/colima");
}

function resolveColimaBinary() {
  if (fs.existsSync("/opt/homebrew/bin/colima")) return "/opt/homebrew/bin/colima";
  if (fs.existsSync("/usr/local/bin/colima")) return "/usr/local/bin/colima";
  if (commandExists("colima")) return "colima";
  return null;
}

async function waitForDockerDaemon(timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isDockerDaemonReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, { headers: { "User-Agent": "myhomegames-server" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close(() => {
          fs.unlink(destPath, () => {});
          downloadToFile(response.headers.location, destPath).then(resolve).catch(reject);
        });
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        file.close(() => {
          fs.unlink(destPath, () => {});
          reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        });
        return;
      }
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve(destPath)));
    });
    request.on("error", (error) => {
      file.close(() => {
        fs.unlink(destPath, () => {});
        reject(error);
      });
    });
    request.setTimeout(300_000, () => request.destroy(new Error(`Timed out downloading ${url}`)));
  });
}

function tryStartExistingDockerDesktop() {
  if (process.platform !== "darwin") return false;
  if (!fs.existsSync(DOCKER_DESKTOP_APP)) return false;
  console.log("Starting existing Docker Desktop...");
  try {
    execFileSync("open", ["-a", "Docker"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryStartExistingColima() {
  const colima = resolveColimaBinary();
  if (!colima) return false;
  console.log("Starting existing Colima...");
  try {
    runCommand(colima, ["start"], { timeoutMs: 300_000, inherit: true });
    return true;
  } catch (error) {
    console.warn(`Could not start Colima: ${error.message || error}`);
    return false;
  }
}

function installHomebrewIfNeeded() {
  let brew = resolveBrewBinary();
  if (brew) return brew;

  console.log("Homebrew not found. Installing Homebrew (non-interactive)...");
  // Official non-interactive install. May still fail if macOS requires an admin password.
  runCommand(
    "/bin/bash",
    ["-c", 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'],
    { timeoutMs: 600_000, inherit: true, env: { NONINTERACTIVE: "1" } },
  );

  brew = resolveBrewBinary();
  if (!brew) {
    // Apple Silicon default path may not be on PATH for this process yet.
    const candidate = "/opt/homebrew/bin/brew";
    if (fs.existsSync(candidate)) return candidate;
    throw new Error("Homebrew installation finished but brew binary was not found");
  }
  return brew;
}

function installColimaWithBrew(brew) {
  console.log("Installing Colima + Docker CLI via Homebrew...");
  runCommand(brew, ["install", "colima", "docker"], { timeoutMs: 600_000, inherit: true });
}

async function installDockerDesktopDmg(metadataPath) {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://desktop.docker.com/mac/main/${arch}/Docker.dmg`;
  const downloadsDir = path.join(
    metadataPath || path.join(os.homedir(), "Library", "Application Support", "MyHomeGames"),
    "docker-runtime",
    "downloads",
  );
  fs.mkdirSync(downloadsDir, { recursive: true });
  const dmgPath = path.join(downloadsDir, "Docker.dmg");

  console.log(`Downloading Docker Desktop (${arch})...`);
  await downloadToFile(url, dmgPath);

  const mountPoint = path.join(downloadsDir, "dmg-mount");
  if (fs.existsSync(mountPoint)) fs.rmSync(mountPoint, { recursive: true, force: true });
  fs.mkdirSync(mountPoint, { recursive: true });

  try {
    runCommand(
      "/bin/sh",
      ["-c", 'yes | PAGER=cat hdiutil "$@"', "hdiutil", "attach", dmgPath, "-mountpoint", mountPoint, "-nobrowse", "-noautoopen"],
      { timeoutMs: 120_000 },
    );
    const appSource = path.join(mountPoint, "Docker.app");
    if (!fs.existsSync(appSource)) {
      throw new Error("Docker.app not found in Docker.dmg");
    }
    if (fs.existsSync(DOCKER_DESKTOP_APP)) {
      fs.rmSync(DOCKER_DESKTOP_APP, { recursive: true, force: true });
    }
    console.log("Installing Docker.app to /Applications...");
    runCommand("ditto", [appSource, DOCKER_DESKTOP_APP], { timeoutMs: 180_000 });
  } finally {
    try {
      runCommand("hdiutil", ["detach", mountPoint], { timeoutMs: 60_000 });
    } catch {
      // ignore
    }
  }

  execFileSync("open", ["-a", "Docker"], { stdio: "ignore" });
}

async function ensureDarwinDocker({ metadataPath, env = process.env } = {}) {
  if (tryStartExistingDockerDesktop() || tryStartExistingColima()) {
    if (await waitForDockerDaemon(120_000)) {
      return { provider: "started-existing" };
    }
  }

  // Prefer Colima (no GUI license prompts); fall back to Docker Desktop DMG.
  try {
    const brew = installHomebrewIfNeeded();
    if (!isColimaInstalled() || !commandExists("docker")) {
      installColimaWithBrew(brew);
    }
    const colima = resolveColimaBinary();
    if (!colima) throw new Error("colima binary not found after install");
    console.log("Starting Colima (first start may download a Linux VM)...");
    const cpus = String(env.COLIMA_CPU || "2");
    const memory = String(env.COLIMA_MEMORY || "4");
    runCommand(colima, ["start", "--cpu", cpus, "--memory", memory], {
      timeoutMs: 600_000,
      inherit: true,
    });
    if (await waitForDockerDaemon(180_000)) {
      return { provider: "colima" };
    }
  } catch (error) {
    console.warn(`Colima auto-install failed: ${error.message || error}`);
    console.log("Falling back to Docker Desktop...");
  }

  await installDockerDesktopDmg(metadataPath);
  if (await waitForDockerDaemon(240_000)) {
    return { provider: "docker-desktop" };
  }

  throw new Error(
    "Docker was installed but the daemon is not ready yet. Open Docker Desktop/Colima once if macOS asks for permissions, then restart the server.",
  );
}

function ensureLinuxDocker() {
  if (commandExists("docker")) {
    // Daemon may just be stopped.
    try {
      runCommand("sudo", ["service", "docker", "start"], { timeoutMs: 60_000 });
    } catch {
      try {
        runCommand("sudo", ["systemctl", "start", "docker"], { timeoutMs: 60_000 });
      } catch {
        // ignore
      }
    }
    return;
  }

  console.log("Installing Docker Engine via get.docker.com...");
  runCommand(
    "/bin/sh",
    ["-c", "curl -fsSL https://get.docker.com | sudo sh"],
    { timeoutMs: 600_000, inherit: true },
  );
  try {
    runCommand("sudo", ["systemctl", "enable", "--now", "docker"], { timeoutMs: 60_000 });
  } catch {
    // ignore
  }
  try {
    const user = os.userInfo().username;
    runCommand("sudo", ["usermod", "-aG", "docker", user], { timeoutMs: 30_000 });
  } catch {
    // ignore — may need re-login for group membership
  }
}

function ensureWindowsDocker() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const dockerDesktop = path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe");
  if (fs.existsSync(dockerDesktop)) {
    console.log("Starting existing Docker Desktop...");
    spawnSync(dockerDesktop, [], { detached: true, stdio: "ignore", windowsHide: true });
    return;
  }

  throw new Error(
    "Docker Desktop is not installed on Windows. Automatic install is not supported yet; install Docker Desktop or set MOONLIGHT_WEB_FORCE_NATIVE=true.",
  );
}

/**
 * Ensure a working Docker daemon is available, installing Colima/Docker when needed.
 */
async function ensureDockerRuntime({ metadataPath, env = process.env } = {}) {
  if (env.DOCKER_SKIP_INSTALL === "true") {
    if (isDockerDaemonReady()) return { ready: true, provider: "existing" };
    throw new Error("Docker is not available and DOCKER_SKIP_INSTALL=true");
  }

  if (isDockerDaemonReady()) {
    return { ready: true, provider: "existing" };
  }

  console.log("Docker daemon not reachable. Ensuring Docker runtime...");

  if (process.platform === "darwin") {
    const result = await ensureDarwinDocker({ metadataPath, env });
    return { ready: true, ...result };
  }

  if (process.platform === "linux") {
    ensureLinuxDocker();
    if (await waitForDockerDaemon(120_000)) {
      return { ready: true, provider: "linux-docker" };
    }
    throw new Error(
      "Docker Engine install finished but the daemon is not ready (you may need to re-login after being added to the docker group).",
    );
  }

  if (process.platform === "win32") {
    ensureWindowsDocker();
    if (await waitForDockerDaemon(240_000)) {
      return { ready: true, provider: "docker-desktop" };
    }
    throw new Error("Docker Desktop was started but the daemon is not ready yet.");
  }

  throw new Error(`Automatic Docker install is not supported on ${process.platform}`);
}

module.exports = {
  isDockerDaemonReady,
  ensureDockerRuntime,
  waitForDockerDaemon,
  resolveBrewBinary,
  commandExists,
};
