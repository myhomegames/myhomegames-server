/**
 * Windows packaging: exe-only zip (optional) + full tray zip (server .exe + launcher + PS1 + config).
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");

const ENV_CONTENT_STANDALONE = `HTTP_PORT=4000
HTTPS_ENABLED=true
HTTPS_PORT=41440
API_BASE=https://localhost:41440
FRONTEND_URL=https://myhomegames.vige.it/app/
`;

const SERVER_INFO_FILENAME = "server-info.json";

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
}

function getServerInfoJson() {
  const packageJson = readPackageJson();
  return JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      buildDate: new Date().toISOString(),
      creator: "Luca Stancapiano",
      community: "Vige",
      website: "https://myhomegames.vige.it",
    },
    null,
    2
  );
}

function findWinExe() {
  const names = ["myhomegames-server-win-x64.exe", "myhomegames-server-node18-win-x64.exe"];
  return names.find((n) => fs.existsSync(path.join(BUILD_DIR, n)));
}

/** Build only the Windows executable with pkg (no macOS/linux targets). */
function runPkgWindowsOnly() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  execSync("npx pkg . --targets node18-win-x64 --output-path build", {
    cwd: ROOT,
    stdio: "inherit",
  });
}

/**
 * Zip: myhomegames-server-win-x64.exe + .env + server-info.json
 * Output: MyHomeGames-<version>-win-x64-exe.zip
 */
function packageWindowsExeZip() {
  const packageJson = readPackageJson();
  const version = packageJson.version;
  const winExe = findWinExe();
  if (!winExe) {
    throw new Error(
      "Windows exe not found in build/. Run pkg first (e.g. npm run build:win-exe)."
    );
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, ".env"), ENV_CONTENT_STANDALONE);
  fs.writeFileSync(path.join(BUILD_DIR, SERVER_INFO_FILENAME), getServerInfoJson());

  const zipName = `MyHomeGames-${version}-win-x64-exe.zip`;
  const zipPath = path.join(BUILD_DIR, zipName);
  execSync(
    `cd "${BUILD_DIR}" && zip -q "${zipPath}" "${winExe}" ".env" "${SERVER_INFO_FILENAME}"`,
    { stdio: "inherit" }
  );
  console.log(`✅ Windows server: ${zipName}`);
  return zipPath;
}

const TRAY_PS1_DEST = "MyHomeGames-Server-Tray.ps1";
const TRAY_LAUNCHER_EXE_DEST = "Start-MyHomeGames-Server.exe";
const TRAY_PNG_NAME = "MyHomeGames-Tray.png";

const UNIFIED_EXE_DIR = path.join(__dirname, "windows-unified-exe");
const UNIFIED_PAYLOAD_DIR = path.join(UNIFIED_EXE_DIR, "payload");

/**
 * Copy server .exe, PS1, .env, server-info, optional PNG into windows-unified-exe/payload for go:embed.
 */
function populateUnifiedPayload() {
  const winExe = findWinExe();
  if (!winExe) {
    throw new Error(
      "Windows server exe not found in build/. Run pkg first (e.g. npm run build:win-exe)."
    );
  }
  fs.mkdirSync(UNIFIED_PAYLOAD_DIR, { recursive: true });
  for (const name of fs.readdirSync(UNIFIED_PAYLOAD_DIR)) {
    if (name === ".gitkeep") continue;
    const p = path.join(UNIFIED_PAYLOAD_DIR, name);
    try {
      if (fs.statSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    } catch (_) {}
  }
  fs.copyFileSync(path.join(BUILD_DIR, winExe), path.join(UNIFIED_PAYLOAD_DIR, winExe));
  const trayPs1Src = path.join(__dirname, "windows-tray-launcher.ps1");
  if (!fs.existsSync(trayPs1Src)) {
    throw new Error("Missing scripts/windows-tray-launcher.ps1");
  }
  fs.copyFileSync(trayPs1Src, path.join(UNIFIED_PAYLOAD_DIR, TRAY_PS1_DEST));
  const readmeWinSrc = path.join(__dirname, "README-WINDOWS.txt");
  if (fs.existsSync(readmeWinSrc)) {
    fs.copyFileSync(readmeWinSrc, path.join(UNIFIED_PAYLOAD_DIR, "README-WINDOWS.txt"));
  }
  fs.writeFileSync(path.join(UNIFIED_PAYLOAD_DIR, ".env"), ENV_CONTENT_STANDALONE);
  fs.writeFileSync(path.join(UNIFIED_PAYLOAD_DIR, SERVER_INFO_FILENAME), getServerInfoJson());
  const png = path.join(BUILD_DIR, TRAY_PNG_NAME);
  if (fs.existsSync(png)) {
    fs.copyFileSync(png, path.join(UNIFIED_PAYLOAD_DIR, TRAY_PNG_NAME));
  }
}

/**
 * One .exe: embeds payload + extracts to %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version> and runs tray PS1.
 * Output: build/MyHomeGames-<version>-win-x64-unified.exe
 */
function buildWindowsUnifiedExe() {
  const packageJson = readPackageJson();
  const version = packageJson.version;
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  populateUnifiedPayload();
  const outExe = path.join(BUILD_DIR, `MyHomeGames-${version}-win-x64-unified.exe`);
  const ldflags = `-s -w -H windowsgui -X main.appVersion=${version}`;
  const result = spawnSync(
    "go",
    ["build", "-ldflags=" + ldflags, "-o", outExe, "."],
    {
      cwd: UNIFIED_EXE_DIR,
      env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw new Error(
      "Could not run `go` (install Go 1.21+ from https://go.dev/dl/ and add it to PATH).\n" +
        result.error.message
    );
  }
  if (result.status !== 0) {
    throw new Error("go build failed for MyHomeGames-*-win-x64-unified.exe.");
  }
  if (!fs.existsSync(outExe)) {
    throw new Error("Expected unified exe in build/ after go build.");
  }
  console.log(`✅ Windows unified (single file): MyHomeGames-${version}-win-x64-unified.exe`);
  return outExe;
}

/**
 * Cross-compile the small GUI-subsystem stub (Go) that starts PowerShell + tray PS1.
 */
function buildTrayLauncherExe() {
  const launcherDir = path.join(__dirname, "tray-launcher-exe");
  const mainGo = path.join(launcherDir, "main.go");
  if (!fs.existsSync(mainGo)) {
    throw new Error("Missing scripts/tray-launcher-exe/main.go");
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const outExe = path.join(BUILD_DIR, TRAY_LAUNCHER_EXE_DEST);
  const result = spawnSync(
    "go",
    ["build", "-ldflags=-s -w -H windowsgui", "-o", outExe, "."],
    {
      cwd: launcherDir,
      env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw new Error(
      "Could not run `go` (install Go 1.21+ from https://go.dev/dl/ and add it to PATH).\n" +
        result.error.message
    );
  }
  if (result.status !== 0) {
    throw new Error("go build failed for tray launcher (Start-MyHomeGames-Server.exe).");
  }
  if (!fs.existsSync(outExe)) {
    throw new Error(`Expected ${TRAY_LAUNCHER_EXE_DEST} in build/ after go build.`);
  }
}

/**
 * Zip: packaged Node server .exe + tray launcher (stub .exe, PS1), README, optional tray PNG, .env, server-info.
 * Self-contained: one download, unzip and run Start-MyHomeGames-Server.exe.
 * Output: MyHomeGames-<version>-win-x64-tray.zip
 */
function packageWindowsTrayZip() {
  const packageJson = readPackageJson();
  const version = packageJson.version;
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  fs.writeFileSync(path.join(BUILD_DIR, ".env"), ENV_CONTENT_STANDALONE);
  fs.writeFileSync(path.join(BUILD_DIR, SERVER_INFO_FILENAME), getServerInfoJson());

  const winExe = findWinExe();
  if (!winExe) {
    throw new Error(
      "Windows server exe not found in build/. Run pkg first (e.g. npm run build:win-exe) or use npm run build:win-tray which builds it automatically."
    );
  }

  buildTrayLauncherExe();

  const trayPs1Src = path.join(__dirname, "windows-tray-launcher.ps1");
  const readmeWinSrc = path.join(__dirname, "README-WINDOWS.txt");

  if (fs.existsSync(trayPs1Src)) {
    fs.copyFileSync(trayPs1Src, path.join(BUILD_DIR, TRAY_PS1_DEST));
  }
  if (fs.existsSync(readmeWinSrc)) {
    fs.copyFileSync(readmeWinSrc, path.join(BUILD_DIR, "README-WINDOWS.txt"));
  }

  const zipName = `MyHomeGames-${version}-win-x64-tray.zip`;
  const zipPath = path.join(BUILD_DIR, zipName);
  const entries = [
    winExe,
    TRAY_LAUNCHER_EXE_DEST,
    TRAY_PS1_DEST,
    "README-WINDOWS.txt",
    ".env",
    SERVER_INFO_FILENAME,
  ];
  if (fs.existsSync(path.join(BUILD_DIR, TRAY_PNG_NAME))) {
    entries.push(TRAY_PNG_NAME);
  } else {
    console.warn(
      "⚠️  MyHomeGames-Tray.png not in build/ — tray zip will have no custom icon (add PNG from full macOS build or copy manually)."
    );
  }
  const zipArgs = entries.map((f) => `"${f}"`).join(" ");
  execSync(`cd "${BUILD_DIR}" && zip -q "${zipPath}" ${zipArgs}`, { stdio: "inherit" });
  console.log(`✅ Windows tray: ${zipName}`);
  return zipPath;
}

module.exports = {
  BUILD_DIR,
  ENV_CONTENT_STANDALONE,
  SERVER_INFO_FILENAME,
  getServerInfoJson,
  findWinExe,
  runPkgWindowsOnly,
  packageWindowsExeZip,
  packageWindowsTrayZip,
  buildTrayLauncherExe,
  populateUnifiedPayload,
  buildWindowsUnifiedExe,
};
