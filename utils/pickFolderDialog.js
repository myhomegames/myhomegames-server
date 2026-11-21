"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * @typedef {{ folderPath: string | null, cancelled?: boolean, error?: string }} PickFolderResult
 */

function normalizePickedPath(raw) {
  let value = String(raw || "").trim();
  // osascript often returns a trailing slash
  if (value.length > 1 && (value.endsWith("/") || value.endsWith("\\"))) {
    value = value.slice(0, -1);
  }
  return value;
}

function pickFolderDarwin(options = {}) {
  const spawnSyncFn = options.spawnSync || spawnSync;
  const prompt = String(options.prompt || "Select a folder");
  const defaultPath = options.defaultPath
    ? String(options.defaultPath)
    : path.join(os.homedir());
  // AppleScript allows only one `on error` handler per `try`.
  // User cancel is error -128; anything else should surface as a failure.
  const script = `
try
  set defaultFolder to POSIX file ${JSON.stringify(defaultPath)}
  try
    set defaultFolder to defaultFolder as alias
  end try
  set chosenFolder to choose folder with prompt ${JSON.stringify(prompt)} default location defaultFolder
  return POSIX path of chosenFolder
on error errMsg number errNum
  if errNum is -128 then
    return ""
  end if
  error errMsg number errNum
end try
`;
  const result = spawnSyncFn("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
  if (result.error) {
    return { folderPath: null, error: result.error.message };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      folderPath: null,
      error: detail || `Folder picker failed (exit ${result.status})`,
    };
  }
  const folderPath = normalizePickedPath(result.stdout);
  if (!folderPath) {
    return { folderPath: null, cancelled: true };
  }
  return { folderPath };
}

function pickFolderWin32(options = {}) {
  const spawnSyncFn = options.spawnSync || spawnSync;
  const prompt = String(options.prompt || "Select a folder").replace(/'/g, "''");
  const defaultPath = options.defaultPath
    ? String(options.defaultPath).replace(/'/g, "''")
    : String(os.homedir()).replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${prompt}'
$dialog.SelectedPath = '${defaultPath}'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output ''
}
`;
  const result = spawnSyncFn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
    {
      encoding: "utf8",
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      input: script,
      windowsHide: false,
    }
  );
  if (result.error) {
    return { folderPath: null, error: result.error.message };
  }
  const folderPath = normalizePickedPath(result.stdout);
  if (!folderPath) {
    return { folderPath: null, cancelled: true };
  }
  return { folderPath };
}

function pickFolderLinux(options = {}) {
  const spawnSyncFn = options.spawnSync || spawnSync;
  const prompt = String(options.prompt || "Select a folder");
  const defaultPath = options.defaultPath ? String(options.defaultPath) : os.homedir();
  const timeout = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const zenity = spawnSyncFn(
    "zenity",
    ["--file-selection", "--directory", `--title=${prompt}`, `--filename=${defaultPath}${path.sep}`],
    { encoding: "utf8", timeout }
  );
  if (!zenity.error && zenity.status === 0) {
    const folderPath = normalizePickedPath(zenity.stdout);
    if (folderPath) return { folderPath };
  }
  if (!zenity.error && (zenity.status === 1 || zenity.status === 5)) {
    return { folderPath: null, cancelled: true };
  }

  const kdialog = spawnSyncFn(
    "kdialog",
    [`--getexistingdirectory`, defaultPath, `--title`, prompt],
    { encoding: "utf8", timeout }
  );
  if (!kdialog.error && kdialog.status === 0) {
    const folderPath = normalizePickedPath(kdialog.stdout);
    if (folderPath) return { folderPath };
  }
  if (!kdialog.error && kdialog.status === 1) {
    return { folderPath: null, cancelled: true };
  }

  return {
    folderPath: null,
    error:
      "No folder dialog available (install zenity or kdialog), or enter the path manually.",
  };
}

/**
 * Open a native OS folder chooser on the machine running the server.
 * @returns {PickFolderResult}
 */
function pickFolderDialog(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "darwin") return pickFolderDarwin(options);
  if (platform === "win32") return pickFolderWin32(options);
  return pickFolderLinux(options);
}

module.exports = {
  pickFolderDialog,
  normalizePickedPath,
};
