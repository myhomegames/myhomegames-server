/**
 * Stage an MSIX that already contains the server, tray script, and config.
 * The entry point is MyHomeGames.exe, which only starts the tray. Windows owns install and Start Menu.
 * Packing and signing need the Windows SDK (makeappx, signtool), so that step runs on Windows.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(ROOT, "build");
const LAYOUT_DIR = path.join(BUILD_DIR, "msix-layout");
const MSIX_DIR = __dirname;

const { copyCloudflaredBinary } = require("../copy-cloudflared-binary");
const {
  findWinExe,
  runPkgWindowsOnly,
  ENV_CONTENT_STANDALONE,
  getServerInfoJson,
  SERVER_INFO_FILENAME,
} = require("../windows-release-assets");

const PUBLISHER = "CN=MyHomeGames";
const PACKAGE_NAME = "MyHomeGames.Server";

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
}

/** MSIX Identity Version is four numeric parts. */
function msixVersion(version) {
  const core = String(version).split("-")[0];
  const parts = core.split(".").map((n) => {
    const parsed = parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join(".");
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const tag = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([len, tag, data, crc]);
}

/** Uncompressed-filter RGB PNG, used when no app icon is available to resize. */
function solidPng(width, height, r, g, b) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function iconSource() {
  const candidates = [
    path.join(BUILD_DIR, "MyHomeGames-Tray.png"),
    path.join(BUILD_DIR, "app-icon-1024.png"),
    path.join(ROOT, "scripts", "assets", "app-icon-1024.png"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function writeLogo(filePath, size) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const source = iconSource();
  if (source && process.platform === "darwin") {
    const result = spawnSync("sips", ["-z", String(size), String(size), source, "--out", filePath], {
      stdio: "ignore",
    });
    if (result.status === 0 && fs.existsSync(filePath)) return;
  }
  fs.writeFileSync(filePath, solidPng(size, size, 0xe5, 0xa0, 0x0d));
}

function manifestXml(version) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  xmlns:virtualization="http://schemas.microsoft.com/appx/manifest/virtualization/windows10"
  IgnorableNamespaces="uap rescap virtualization">
  <Identity
    Name="${PACKAGE_NAME}"
    Publisher="${PUBLISHER}"
    Version="${version}"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>MyHomeGames Server</DisplayName>
    <PublisherDisplayName>MyHomeGames</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
    <virtualization:FileSystemWriteVirtualization>
      <virtualization:ExcludedDirectories>
        <virtualization:ExcludedDirectory>$(KnownFolder:RoamingAppData)\\MyHomeGames</virtualization:ExcludedDirectory>
        <virtualization:ExcludedDirectory>$(KnownFolder:LocalAppData)\\MyHomeGames</virtualization:ExcludedDirectory>
      </virtualization:ExcludedDirectories>
    </virtualization:FileSystemWriteVirtualization>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="Server" Executable="MyHomeGames.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="MyHomeGames Server"
        Description="MyHomeGames home game server"
        BackgroundColor="#1a1a1a"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <Capability Name="privateNetworkClientServer" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

function resetLayout() {
  fs.rmSync(LAYOUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LAYOUT_DIR, { recursive: true });
}

function stagePayload() {
  const winExe = findWinExe();
  if (!winExe) {
    throw new Error("Windows server exe not found in build/. Run pkg (node18-win-x64) first.");
  }
  fs.copyFileSync(
    path.join(BUILD_DIR, winExe),
    path.join(LAYOUT_DIR, "myhomegames-server-win-x64.exe"),
  );
  fs.copyFileSync(
    path.join(ROOT, "scripts", "windows-tray-launcher.ps1"),
    path.join(LAYOUT_DIR, "MyHomeGames-Server-Tray.ps1"),
  );
  const readme = path.join(ROOT, "scripts", "README-WINDOWS.txt");
  if (fs.existsSync(readme)) {
    fs.copyFileSync(readme, path.join(LAYOUT_DIR, "README-WINDOWS.txt"));
  }
  fs.writeFileSync(path.join(LAYOUT_DIR, ".env"), ENV_CONTENT_STANDALONE);
  fs.writeFileSync(path.join(LAYOUT_DIR, SERVER_INFO_FILENAME), getServerInfoJson());
  copyCloudflaredBinary(path.join(LAYOUT_DIR, "bin"), { platform: "win32", arch: "x64" });
  const trayPng = path.join(BUILD_DIR, "MyHomeGames-Tray.png");
  if (fs.existsSync(trayPng)) {
    fs.copyFileSync(trayPng, path.join(LAYOUT_DIR, "MyHomeGames-Tray.png"));
  }
}

function buildLauncher() {
  const outExe = path.join(LAYOUT_DIR, "MyHomeGames.exe");
  const result = spawnSync(
    "go",
    ["build", "-ldflags=-s -w -H windowsgui", "-o", outExe, "."],
    {
      cwd: MSIX_DIR,
      env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(
      "Could not run `go` (install Go 1.21+ and add it to PATH).\n" + result.error.message,
    );
  }
  if (result.status !== 0 || !fs.existsSync(outExe)) {
    throw new Error("go build failed for the MSIX launcher.");
  }
}

function packOnWindows(outFile) {
  const script = path.join(MSIX_DIR, "pack.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Layout", LAYOUT_DIR, "-OutFile", outFile],
    { stdio: "inherit" },
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error("MSIX pack/sign failed.");
  }
}

/**
 * Stage build/msix-layout and, on Windows, produce a signed build/MyHomeGames-<ver>-win-x64.msix.
 * @param {{ ensurePkg?: boolean }} [options]
 */
function buildWindowsMsix(options = {}) {
  if (options.ensurePkg && !findWinExe()) {
    runPkgWindowsOnly();
  }
  const version = msixVersion(readPackageJson().version);
  const outFile = path.join(BUILD_DIR, `MyHomeGames-${readPackageJson().version}-win-x64.msix`);
  resetLayout();
  stagePayload();
  buildLauncher();
  fs.writeFileSync(path.join(LAYOUT_DIR, "AppxManifest.xml"), manifestXml(version));
  const assets = path.join(LAYOUT_DIR, "Assets");
  writeLogo(path.join(assets, "Square44x44Logo.png"), 44);
  writeLogo(path.join(assets, "Square150x150Logo.png"), 150);
  writeLogo(path.join(assets, "StoreLogo.png"), 50);

  if (process.platform === "win32") {
    packOnWindows(outFile);
    console.log(`✅ Windows MSIX: ${path.basename(outFile)}`);
    return outFile;
  }

  console.log(`✅ Windows MSIX layout: ${LAYOUT_DIR}`);
  console.log("   Pack and sign on Windows (SDK makeappx + signtool):");
  console.log(`   powershell -File scripts/windows-msix/pack.ps1 -Layout build/msix-layout -OutFile build/${path.basename(outFile)}`);
  return LAYOUT_DIR;
}

module.exports = {
  PACKAGE_NAME,
  PUBLISHER,
  msixVersion,
  buildWindowsMsix,
};

if (require.main === module) {
  try {
    buildWindowsMsix({ ensurePkg: true });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
