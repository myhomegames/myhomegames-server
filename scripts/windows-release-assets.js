/**
 * Windows packaging: unified single-file .exe (embeds pkg server + tray PS1 + config via Go).
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");

const ENV_CONTENT_STANDALONE = require("./release-env-content");
const { copyCloudflaredBinary } = require("./copy-cloudflared-binary");

const SERVER_INFO_FILENAME = "server-info.json";

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
}

const { buildServerInfo } = require("../utils/compatibility");

function getServerInfoJson() {
  return JSON.stringify(buildServerInfo(ROOT), null, 2);
}

function findWinExe() {
  // Multi-target pkg: *-win-x64.exe; single-target pkg: myhomegames-server.exe
  const names = [
    "myhomegames-server-win-x64.exe",
    "myhomegames-server-node18-win-x64.exe",
    "myhomegames-server.exe",
  ];
  return names.find((n) => fs.existsSync(path.join(BUILD_DIR, n)));
}

/** Build only the Windows executable with pkg (no macOS/linux targets). */
function runPkgWindowsOnly() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  // Use -o with an explicit path: --output-path is not a pkg flag (--out-path is).
  // Single-target builds otherwise land as myhomegames-server.exe without -win-x64.
  execSync('npx pkg . --targets node18-win-x64 -o build/myhomegames-server-win-x64.exe', {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (!findWinExe()) {
    const listing = fs.existsSync(BUILD_DIR)
      ? fs.readdirSync(BUILD_DIR).join(", ") || "(empty)"
      : "(missing)";
    throw new Error(
      `pkg finished but no Windows server exe found in build/. Contents: ${listing}`,
    );
  }
}

const TRAY_PS1_DEST = "MyHomeGames-Server-Tray.ps1";
const TRAY_PNG_NAME = "MyHomeGames-Tray.png";

const UNIFIED_EXE_DIR = path.join(__dirname, "windows-unified-exe");
const UNIFIED_PAYLOAD_DIR = path.join(UNIFIED_EXE_DIR, "payload");

/**
 * Copy server .exe, PS1, .env, server-info, optional PNG into windows-unified-exe/payload for go:embed.
 */
function populateUnifiedPayload() {
  const winExe = findWinExe();
  if (!winExe) {
    const listing = fs.existsSync(BUILD_DIR)
      ? fs.readdirSync(BUILD_DIR).join(", ") || "(empty)"
      : "(missing)";
    throw new Error(
      `Windows server exe not found in build/. Run pkg first (e.g. npm run build:win-unified). Contents: ${listing}`,
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
  fs.copyFileSync(path.join(BUILD_DIR, winExe), path.join(UNIFIED_PAYLOAD_DIR, "myhomegames-server-win-x64.exe"));
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
  copyCloudflaredBinary(path.join(UNIFIED_PAYLOAD_DIR, "bin"), {
    platform: "win32",
    arch: "x64",
  });
  const png = path.join(BUILD_DIR, TRAY_PNG_NAME);
  if (fs.existsSync(png)) {
    fs.copyFileSync(png, path.join(UNIFIED_PAYLOAD_DIR, TRAY_PNG_NAME));
  }
}

/**
 * Embed MyHomeGames app icon (+ version/manifest) into the Windows PE via go-winres.
 * Produces rsrc_windows_amd64.syso next to main.go so `go build` links it automatically.
 */
function ensureWindowsExeIconResources(version) {
  const iconPng = path.join(ROOT, "scripts", "assets", "app-icon-1024.png");
  if (!fs.existsSync(iconPng)) {
    console.warn(
      "⚠️  scripts/assets/app-icon-1024.png missing — Windows .exe will keep the generic icon.",
    );
    return;
  }
  const winresDir = path.join(UNIFIED_EXE_DIR, "winres");
  fs.mkdirSync(winresDir, { recursive: true });
  // go-winres accepts one PNG and builds 256/64/48/32/16; source may be 1024.
  const winresIcon = path.join(winresDir, "icon.png");
  if (process.platform === "darwin") {
    const resized = spawnSync(
      "sips",
      ["-z", "256", "256", iconPng, "--out", winresIcon],
      { stdio: "ignore" },
    );
    if (resized.status !== 0 || !fs.existsSync(winresIcon)) {
      fs.copyFileSync(iconPng, winresIcon);
    }
  } else {
    fs.copyFileSync(iconPng, winresIcon);
  }

  const winresJson = path.join(winresDir, "winres.json");
  if (!fs.existsSync(winresJson)) {
    throw new Error(`Missing ${winresJson}`);
  }

  const fileVersion = String(version || "0.0.0").split(".").concat(["0", "0", "0", "0"]).slice(0, 4).join(".");

  function runGoWinres(bin) {
    return spawnSync(
      bin,
      [
        "make",
        "--in",
        "winres/winres.json",
        "--arch",
        "amd64",
        "--product-version",
        fileVersion,
        "--file-version",
        fileVersion,
      ],
      { cwd: UNIFIED_EXE_DIR, stdio: "inherit" },
    );
  }

  let result = runGoWinres("go-winres");
  if (result.error || result.status !== 0) {
    console.log("go-winres not on PATH — installing github.com/tc-hib/go-winres@v0.3.3…");
    const install = spawnSync(
      "go",
      ["install", "github.com/tc-hib/go-winres@v0.3.3"],
      { cwd: UNIFIED_EXE_DIR, stdio: "inherit", env: process.env },
    );
    if (install.error || install.status !== 0) {
      throw new Error(
        "Could not install go-winres (needed to embed the Start Menu / Explorer icon). " +
          "Install Go, then: go install github.com/tc-hib/go-winres@v0.3.3",
      );
    }
    const gopathBin = spawnSync("go", ["env", "GOPATH"], { encoding: "utf8" });
    const gopath = (gopathBin.stdout || "").trim() || path.join(require("os").homedir(), "go");
    const installed = path.join(gopath, "bin", process.platform === "win32" ? "go-winres.exe" : "go-winres");
    result = runGoWinres(fs.existsSync(installed) ? installed : "go-winres");
  }
  if (result.error) {
    throw new Error(`go-winres failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error("go-winres make failed — Windows exe icon was not generated.");
  }
  const syso = path.join(UNIFIED_EXE_DIR, "rsrc_windows_amd64.syso");
  if (!fs.existsSync(syso)) {
    throw new Error(`Expected ${syso} after go-winres make.`);
  }
  console.log("✅ Windows PE icon resources: rsrc_windows_amd64.syso");
}

/**
 * One .exe: embeds payload + extracts to %LOCALAPPDATA%\\MyHomeGames\\server-runtime\\<version> and runs tray PS1.
 * Output: build/MyHomeGames-<version>-win-x64.exe and build/MyHomeGames-<version>-win-x64.zip (zip contains the exe).
 */
function buildWindowsUnifiedExe() {
  const packageJson = readPackageJson();
  const version = packageJson.version;
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  populateUnifiedPayload();
  ensureWindowsExeIconResources(version);
  const outExe = path.join(BUILD_DIR, `MyHomeGames-${version}-win-x64.exe`);
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
    throw new Error("go build failed for MyHomeGames-*-win-x64.exe.");
  }
  if (!fs.existsSync(outExe)) {
    throw new Error("Expected unified exe in build/ after go build.");
  }
  console.log(`✅ Windows unified (single file): MyHomeGames-${version}-win-x64.exe`);
  const exeBasename = path.basename(outExe);
  const zipName = `MyHomeGames-${version}-win-x64.zip`;
  const zipPath = path.join(BUILD_DIR, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // Use adm-zip (not CLI `zip`) so this works on Windows GitHub Actions runners.
  const AdmZip = require("adm-zip");
  const zip = new AdmZip();
  zip.addLocalFile(outExe, "", exeBasename);
  zip.writeZip(zipPath);
  console.log(`✅ Windows: ${zipName}`);
  return outExe;
}

module.exports = {
  BUILD_DIR,
  ENV_CONTENT_STANDALONE,
  SERVER_INFO_FILENAME,
  getServerInfoJson,
  findWinExe,
  runPkgWindowsOnly,
  populateUnifiedPayload,
  ensureWindowsExeIconResources,
  buildWindowsUnifiedExe,
};
