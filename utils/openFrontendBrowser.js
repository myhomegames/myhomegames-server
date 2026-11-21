"use strict";

const { spawn, spawnSync } = require("child_process");

const FOCUS_TIMEOUT_MS = 8_000;

const MAC_BROWSERS = [
  { name: "Google Chrome", kind: "chromium" },
  { name: "Microsoft Edge", kind: "chromium" },
  { name: "Brave Browser", kind: "chromium" },
  { name: "Arc", kind: "chromium" },
  { name: "Comet", kind: "chromium" },
  { name: "Vivaldi", kind: "chromium" },
  { name: "Chromium", kind: "chromium" },
  { name: "Opera", kind: "chromium" },
  { name: "Orion", kind: "chromium" },
  { name: "Safari", kind: "safari" },
];

/**
 * Split an http(s) URL without the URL constructor.
 * macOS JXA (JavaScriptCore) does not provide URL, so tab matching must stay on strings.
 */
function splitHttpUrl(value) {
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(String(value || "").trim());
  if (!match) return null;
  let pathname = match[3] || "/";
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  return {
    protocol: `${match[1].toLowerCase()}:`,
    host: match[2].toLowerCase(),
    pathname,
  };
}

/** True when an open tab is already the FRONTEND_URL app, including its routes. */
function urlMatchesFrontend(openUrl, target) {
  const open = splitHttpUrl(openUrl);
  const want = splitHttpUrl(target);
  if (!open || !want) return false;
  if (open.protocol !== want.protocol || open.host !== want.host) return false;
  const base = want.pathname.endsWith("/") ? want.pathname : `${want.pathname}/`;
  const path = open.pathname.endsWith("/") ? open.pathname : `${open.pathname}/`;
  return path === base || path.startsWith(base);
}

function parseFrontendUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return { invalid: value };
  }
}

const MAC_FOCUS_SCRIPT = String.raw`
function run(argv) {
  var target = argv[0];
  var browsers = ${JSON.stringify(MAC_BROWSERS)};

  function splitHttpUrl(value) {
    var match = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(String(value || "").trim());
    if (!match) return null;
    var pathname = match[3] || "/";
    if (pathname.charAt(0) !== "/") pathname = "/" + pathname;
    return {
      protocol: match[1].toLowerCase() + ":",
      host: match[2].toLowerCase(),
      pathname: pathname
    };
  }

  function matches(openUrl) {
    var open = splitHttpUrl(openUrl);
    var want = splitHttpUrl(target);
    if (!open || !want) return false;
    if (open.protocol !== want.protocol || open.host !== want.host) return false;
    var base = want.pathname.charAt(want.pathname.length - 1) === "/" ? want.pathname : want.pathname + "/";
    var path = open.pathname.charAt(open.pathname.length - 1) === "/" ? open.pathname : open.pathname + "/";
    return path === base || path.indexOf(base) === 0;
  }

  var running = [];
  try {
    var listed = Application("System Events").processes.name();
    running = [].slice.call(listed).map(function (name) { return String(name); });
  } catch (error) {
    return "missing";
  }

  for (var i = 0; i < browsers.length; i++) {
    var spec = browsers[i];
    if (running.indexOf(spec.name) < 0) continue;
    try {
      var app = Application(spec.name);
      var windows = [].slice.call(app.windows());
      for (var w = 0; w < windows.length; w++) {
        var win = windows[w];
        var tabs = [];
        try { tabs = [].slice.call(win.tabs()); } catch (error) { continue; }
        for (var t = 0; t < tabs.length; t++) {
          var tabUrl = "";
          try { tabUrl = String(tabs[t].url()); } catch (error) { continue; }
          if (!matches(tabUrl)) continue;
          try {
            if (spec.kind === "safari") win.currentTab = tabs[t];
            else win.activeTabIndex = t + 1;
          } catch (error) {}
          try { win.index = 1; } catch (error) {}
          try { app.activate(); } catch (error) {}
          return "found";
        }
      }
    } catch (error) {}
  }
  return "missing";
}
`;

const WINDOWS_FOCUS_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$Target = $env:MHG_FRONTEND_URL
if ([string]::IsNullOrWhiteSpace($Target)) { exit 1 }

function Test-FrontendUrl([string]$OpenUrl) {
  if ([string]::IsNullOrWhiteSpace($OpenUrl)) { return $false }
  $candidate = $OpenUrl.Trim()
  if ($candidate -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*:') { $candidate = "https://$candidate" }
  try {
    $open = [Uri]$candidate
    $want = [Uri]$Target
    if ($open.Scheme -ne $want.Scheme -or $open.Authority -ne $want.Authority) { return $false }
    $base = $want.AbsolutePath
    if (-not $base.EndsWith("/")) { $base += "/" }
    $path = $open.AbsolutePath
    if (-not $path.EndsWith("/")) { $path += "/" }
    return ($path -eq $base -or $path.StartsWith($base))
  } catch { return $false }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MhgWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$processNames = @("chrome", "msedge", "brave", "vivaldi", "opera", "firefox")
$root = [System.Windows.Automation.AutomationElement]::RootElement
$editType = [System.Windows.Automation.ControlType]::Edit
$tabType = [System.Windows.Automation.ControlType]::TabItem
$cond = New-Object System.Windows.Automation.OrCondition @(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $editType)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $tabType))
)

foreach ($name in $processNames) {
  $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
  foreach ($proc in $procs) {
    try {
    $pidCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
    foreach ($win in $windows) {
      $nodes = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($node in $nodes) {
        $texts = New-Object System.Collections.Generic.List[string]
        try { [void]$texts.Add([string]$node.Current.Name) } catch {}
        try {
          $value = $node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          [void]$texts.Add([string]$value.Current.Value)
        } catch {}
        $matched = $false
        foreach ($text in $texts) { if (Test-FrontendUrl $text) { $matched = $true; break } }
        if (-not $matched) { continue }
        try {
          $select = $node.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          $select.Select()
        } catch {}
        $hwnd = [IntPtr]$win.Current.NativeWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) {
          [MhgWindow]::ShowWindow($hwnd, 9) | Out-Null
          [MhgWindow]::SetForegroundWindow($hwnd) | Out-Null
        }
        Write-Output "found"
        exit 0
      }
    }
    } catch {}
  }
}
Write-Output "missing"
exit 0
`;

function focusExistingFrontendTab(target, options = {}) {
  const platform = options.platform || process.platform;
  const spawnSyncFn = options.spawnSync || spawnSync;
  if (platform === "darwin") {
    const result = spawnSyncFn("osascript", ["-l", "JavaScript", "-e", MAC_FOCUS_SCRIPT, target], {
      encoding: "utf8",
      timeout: FOCUS_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return false;
    return String(result.stdout || "").includes("found");
  }
  if (platform === "win32") {
    const result = spawnSyncFn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      {
        encoding: "utf8",
        timeout: FOCUS_TIMEOUT_MS,
        input: WINDOWS_FOCUS_SCRIPT,
        env: { ...process.env, MHG_FRONTEND_URL: target },
        windowsHide: true,
      },
    );
    if (result.error || result.status !== 0) return false;
    return String(result.stdout || "").includes("found");
  }
  return false;
}

function launchFrontendUrl(target, platform, spawnFn) {
  const child =
    platform === "darwin"
      ? spawnFn("open", [target], { detached: true, stdio: "ignore" })
      : platform === "win32"
        ? spawnFn("cmd", ["/c", "start", "", target], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawnFn("xdg-open", [target], { detached: true, stdio: "ignore" });
  child.on("error", (err) => {
    console.warn(`Could not open browser: ${err.message || err}`);
  });
  child.unref();
}

/**
 * Focus an existing FRONTEND_URL tab, or open one.
 * @returns {boolean} true when a browser was focused or a new page was requested
 */
function openFrontendUrl(raw, options = {}) {
  const parsed = parseFrontendUrl(raw);
  if (!parsed) return false;
  if (parsed.invalid) {
    console.warn(`FRONTEND_URL is not a valid URL: ${parsed.invalid}`);
    return false;
  }
  const target = parsed;
  const platform = options.platform || process.platform;
  const log = options.log || ((message) => console.log(message));
  const focus = options.focusExisting || focusExistingFrontendTab;
  try {
    if (focus(target, { platform, spawnSync: options.spawnSync })) {
      log(`Browser already open at ${target}`);
      return true;
    }
  } catch (err) {
    console.warn(`Could not check open browser tabs: ${err?.message || err}`);
  }
  log(`Opening browser at ${target}`);
  try {
    launchFrontendUrl(target, platform, options.spawn || spawn);
  } catch (err) {
    console.warn(`Could not open browser: ${err?.message || err}`);
  }
  return true;
}

module.exports = {
  urlMatchesFrontend,
  focusExistingFrontendTab,
  openFrontendUrl,
};
