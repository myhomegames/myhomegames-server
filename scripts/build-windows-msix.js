/**
 * Build MyHomeGames MSIX from the unified Windows .exe (Windows + MakeAppx only).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');

function msixPathForVersion(version) {
  return path.join(BUILD_DIR, `MyHomeGames-${version}-win-x64.msix`);
}

function buildWindowsMsix() {
  if (process.platform !== 'win32') {
    throw new Error(
      'MSIX packaging requires Windows (MakeAppx.exe). On macOS/Linux, npm run release triggers the GitHub Actions msstore workflow instead.',
    );
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const exe = path.join(BUILD_DIR, `MyHomeGames-${version}-win-x64.exe`);
  if (!fs.existsSync(exe)) {
    throw new Error(`Missing ${exe}. Run npm run build:win-unified first.`);
  }

  const ps1 = path.join(__dirname, 'build-windows-msix.ps1');
  execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  const msix = msixPathForVersion(version);
  if (!fs.existsSync(msix)) {
    throw new Error(`Expected MSIX at ${msix} after packaging.`);
  }
  return msix;
}

if (require.main === module) {
  try {
    const out = buildWindowsMsix();
    console.log(`[msix] ${out}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { buildWindowsMsix, msixPathForVersion, BUILD_DIR };
