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

const PUBLISHER = "CN=E85A2E78-E3FE-4829-96B9-294CD6CDD7C2";
const PUBLISHER_DISPLAY_NAME = "it.vige";
const PACKAGE_NAME = "lucastancapiano.myhomegames-server";
const DISPLAY_NAME = "myhomegames-server";

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
    <DisplayName>${DISPLAY_NAME}</DisplayName>
    <PublisherDisplayName>${PUBLISHER_DISPLAY_NAME}</PublisherDisplayName>
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
        DisplayName="${DISPLAY_NAME}"
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
  // Extensionless ".env" has no Appx content type, so Windows refuses the package.
  fs.writeFileSync(path.join(LAYOUT_DIR, "MyHomeGames.env"), ENV_CONTENT_STANDALONE);
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
  markAppContainer(outExe);
}

/** Windows refuses an MSIX whose entry exe lacks IMAGE_DLLCHARACTERISTICS_APPCONTAINER. */
function markAppContainer(exePath) {
  const buf = fs.readFileSync(exePath);
  if (buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${path.basename(exePath)} is not a PE executable.`);
  }
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", pe, pe + 4) !== "PE\0\0") {
    throw new Error(`${path.basename(exePath)} has no PE header.`);
  }
  const optional = pe + 24;
  const magic = buf.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) {
    throw new Error(`${path.basename(exePath)} has an unknown PE optional header.`);
  }
  const at = optional + 70;
  buf.writeUInt16LE(buf.readUInt16LE(at) | 0x1000, at);
  fs.writeFileSync(exePath, buf);
}

const OPENAPPX_VENV = path.join(BUILD_DIR, "openappx-venv");
const SIGNING_DIR = path.join(BUILD_DIR, "msix-signing");

function runChecked(command, args, extraEnv) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 4).join(" ")} failed.`);
  }
}

function findPython() {
  const candidates = ["python3.12", "python3.13", "python3.11", "python3"];
  for (const name of candidates) {
    const result = spawnSync(
      name,
      ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"],
      { stdio: "ignore" },
    );
    if (result.status === 0) return name;
  }
  throw new Error("Python 3.10+ is required to pack an MSIX on macOS or Linux.");
}

function ensureOpenAppx() {
  const py = path.join(OPENAPPX_VENV, "bin", "python3");
  if (!fs.existsSync(py)) {
    runChecked(findPython(), ["-m", "venv", OPENAPPX_VENV]);
  }
  const check = spawnSync(py, ["-c", "import openappx, cryptography"], { stdio: "ignore" });
  if (check.status !== 0) {
    runChecked(py, ["-m", "pip", "install", "--disable-pip-version-check", "openappx[sign]"]);
  }
  return py;
}

function certInfo(py, cerPath) {
  const result = spawnSync(
    py,
    [
      "-c",
      [
        "import sys",
        "from pathlib import Path",
        "from cryptography import x509",
        "raw = Path(sys.argv[1]).read_bytes()",
        "try:",
        "    cert = x509.load_der_x509_certificate(raw)",
        "except ValueError:",
        "    cert = x509.load_pem_x509_certificate(raw)",
        "print(cert.subject.rfc4514_string())",
        "print(cert.not_valid_after_utc.year)",
      ].join("\n"),
      cerPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return { subject: "", year: 0 };
  const [subject, year] = String(result.stdout || "").trim().split(/\r?\n/);
  return { subject: subject || "", year: Number(year) || 0 };
}

function ensureMsixCert(py) {
  fs.mkdirSync(SIGNING_DIR, { recursive: true });
  const stem = path.join(SIGNING_DIR, "MyHomeGames");
  const pfx = `${stem}.pfx`;
  const cer = `${stem}.cer`;
  const info = fs.existsSync(cer) ? certInfo(py, cer) : { subject: "", year: 0 };
  if (!fs.existsSync(pfx) || !fs.existsSync(cer) || info.subject !== PUBLISHER || info.year < 9999) {
    fs.rmSync(pfx, { force: true });
    fs.rmSync(cer, { force: true });
    runChecked(py, [
      "-c",
      [
        "import datetime, sys",
        "from pathlib import Path",
        "from cryptography import x509",
        "from cryptography.hazmat.primitives import hashes, serialization",
        "from cryptography.hazmat.primitives.serialization import pkcs12",
        "from cryptography.hazmat.primitives.serialization import pkcs12",
        "from cryptography.hazmat.primitives.asymmetric import rsa",
        "from cryptography.x509.oid import ExtendedKeyUsageOID",
        "publisher, stem = sys.argv[1], Path(sys.argv[2])",
        "name = x509.Name.from_rfc4514_string(publisher)",
        "key = rsa.generate_private_key(public_exponent=65537, key_size=2048)",
        "now = datetime.datetime.now(datetime.timezone.utc)",
        "cert = (",
        "    x509.CertificateBuilder()",
        "    .subject_name(name)",
        "    .issuer_name(name)",
        "    .public_key(key.public_key())",
        "    .serial_number(x509.random_serial_number())",
        "    .not_valid_before(now - datetime.timedelta(days=1))",
        "    .not_valid_after(datetime.datetime(9999, 12, 31, 23, 59, 59, tzinfo=datetime.timezone.utc))",
        "    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)",
        "    .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False, data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)",
        "    .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]), critical=True)",
        "    .sign(key, hashes.SHA256())",
        ")",
        "pfx = pkcs12.serialize_key_and_certificates(b'MyHomeGames MSIX', key, cert, None, serialization.NoEncryption())",
        "stem.with_suffix('.pfx').write_bytes(pfx)",
        "stem.with_suffix('.cer').write_bytes(cert.public_bytes(serialization.Encoding.DER))",
        "print(cert.not_valid_after_utc.date().isoformat())",
      ].join("\n"),
      PUBLISHER,
      stem,
    ]);
  }
  return { pfx, cer };
}

/**
 * Pack and sign a layout on macOS or Linux. The .pfx stays in build/msix-signing.
 * @param {string} layoutDir
 * @param {string} outFile
 */
function packSignedMsix(layoutDir, outFile, cerOut) {
  const py = ensureOpenAppx();
  const cert = ensureMsixCert(py);
  if (fs.existsSync(outFile)) fs.rmSync(outFile);
  runChecked(py, ["-m", "openappx", "pack", "--root", layoutDir, "--out", outFile]);
  runChecked(py, ["-m", "openappx", "sign", "--package", outFile, "--pfx", cert.pfx]);
  runChecked(py, ["-m", "openappx", "inspect", "--package", outFile]);
  fs.copyFileSync(cert.cer, cerOut);
  return cerOut;
}

function packOnWindows(outFile, cerOut) {
  const script = path.join(MSIX_DIR, "pack.ps1");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Layout",
      LAYOUT_DIR,
      "-OutFile",
      outFile,
      "-CerFile",
      cerOut,
    ],
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
  const packageVersion = readPackageJson().version;
  const version = msixVersion(packageVersion);
  const outFile = path.join(BUILD_DIR, `MyHomeGames-${packageVersion}-win-x64.msix`);
  const cerOut = path.join(BUILD_DIR, `MyHomeGames-${packageVersion}.cer`);
  resetLayout();
  stagePayload();
  buildLauncher();
  fs.writeFileSync(path.join(LAYOUT_DIR, "AppxManifest.xml"), manifestXml(version));
  const assets = path.join(LAYOUT_DIR, "Assets");
  writeLogo(path.join(assets, "Square44x44Logo.png"), 44);
  writeLogo(path.join(assets, "Square150x150Logo.png"), 150);
  writeLogo(path.join(assets, "StoreLogo.png"), 50);

  if (process.platform === "win32") {
    packOnWindows(outFile, cerOut);
  } else {
    packSignedMsix(LAYOUT_DIR, outFile, cerOut);
  }

  console.log(`✅ Windows MSIX: ${path.basename(outFile)}`);
  console.log(`   Public cert: ${cerOut}`);
  console.log("   On Windows, enable sideload (or Developer Mode), then:");
  console.log(`   Import-Certificate -FilePath ${path.basename(cerOut)} -CertStoreLocation Cert:\\CurrentUser\\TrustedPeople`);
  console.log(`   Add-AppxPackage -Path ${path.basename(outFile)}`);
  return outFile;
}

module.exports = {
  PACKAGE_NAME,
  PUBLISHER,
  msixVersion,
  buildWindowsMsix,
  packSignedMsix,
};

if (require.main === module) {
  try {
    buildWindowsMsix({ ensurePkg: true });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
