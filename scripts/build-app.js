#!/usr/bin/env node
// Script to build macOS .app bundle

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildWindowsUnifiedExe } = require('./windows-release-assets');
const releaseEnvContent = require('./release-env-content');
const { copyCloudflaredBinary } = require('./copy-cloudflared-binary');

const APP_NAME = 'MyHomeGames';
const APP_BUNDLE = `${APP_NAME}.app`;
const BUILD_DIR = path.join(__dirname, '..', 'build');
const TEMP_APP_PATH = path.join(BUILD_DIR, APP_BUNDLE);
const CONTENTS_PATH = path.join(TEMP_APP_PATH, 'Contents');
const MACOS_PATH = path.join(CONTENTS_PATH, 'MacOS');
const RESOURCES_PATH = path.join(CONTENTS_PATH, 'Resources');

// Clean build directory
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

console.log('Building macOS app bundle...');

// Step 1: Build all executables with pkg in one run (bytecode enabled)
console.log('Step 1: Creating executables (macOS x64, macOS arm64, Linux, Windows)...');
try {
  execSync('npx pkg . --targets node18-macos-x64,node18-macos-arm64,node18-linux-x64,node18-win-x64 --out-path build', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
} catch (error) {
  console.error('Error building executables:', error.message);
  process.exit(1);
}

// Step 2: Create .app bundle structure (macOS only)
console.log('Step 2: Creating .app bundle structure...');
fs.mkdirSync(CONTENTS_PATH, { recursive: true });
fs.mkdirSync(MACOS_PATH, { recursive: true });
fs.mkdirSync(RESOURCES_PATH, { recursive: true });

// Step 3: Move macOS x64 executable to MacOS folder (first .app is x64; arm64 .pkg is built later)
// pkg with multiple targets uses -platform-arch (no nodeRange when same): macos-x64, macos-arm64, linux-x64, win-x64
const possibleMacNames = [
  'myhomegames-server-macos-x64',
  'myhomegames-server-node18-macos-x64',
  'myhomegames-server-macos',
  'myhomegames-server',
  'server-macos',
  'server'
];

let executablePath = null;
for (const name of possibleMacNames) {
  const testPath = path.join(BUILD_DIR, name);
  if (fs.existsSync(testPath)) {
    executablePath = testPath;
    break;
  }
}

if (!executablePath) {
  // List files in build directory to help debug
  const files = fs.readdirSync(BUILD_DIR);
  console.error(`Executable not found. Files in build directory:`, files);
  process.exit(1);
}

// Rename executable to _original first
const originalExecutablePath = path.join(MACOS_PATH, `${APP_NAME}_original`);
fs.renameSync(executablePath, originalExecutablePath);
fs.chmodSync(originalExecutablePath, '755');

// Create a minimal Swift GUI wrapper that launches the server
// This solves the bouncing icon issue by providing a proper GUI app
const swiftWrapper = `import Cocoa
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate {
    var serverProcess: Process?
    private var stdoutBuffer = ""
    private var serverReady = false
    private let readyLock = NSLock()
    private var readyFlagPath = ""
    
    /// Wait until Node writes the ready flag / "Server ready" (Sunshine, Moonlight, tunnel).
    private let readyTimeoutSeconds: TimeInterval = 600
    
    private func isServerReady() -> Bool {
        readyLock.lock()
        defer { readyLock.unlock() }
        if serverReady { return true }
        if !readyFlagPath.isEmpty, FileManager.default.fileExists(atPath: readyFlagPath) {
            serverReady = true
            return true
        }
        return false
    }
    
    private func consumeStdout(_ chunk: String) {
        print(chunk, terminator: "")
        readyLock.lock()
        stdoutBuffer += chunk
        if stdoutBuffer.contains("Server ready") {
            serverReady = true
        }
        if stdoutBuffer.count > 4096 {
            stdoutBuffer = String(stdoutBuffer.suffix(512))
        }
        readyLock.unlock()
    }
    
    private func beginLoadingDockCue() {
        NSApp.setActivationPolicy(.regular)
        // Badge is reliable; criticalRequest is not (stops on hover, ignores cancel).
        NSApp.dockTile.badgeLabel = "…"
        NSApp.dockTile.display()
    }
    
    private func endLoadingDockCue() {
        NSApp.dockTile.badgeLabel = nil
        NSApp.dockTile.display()
        NSApp.setActivationPolicy(.regular)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        // Single bounce when fully ready — not a sticky critical attention request.
        _ = NSApp.requestUserAttention(.informationalRequest)
    }
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        beginLoadingDockCue()
        
        // Get the bundle path
        let bundle = Bundle.main
        let bundlePath = bundle.bundlePath
        let macosPath = (bundlePath as NSString).appendingPathComponent("Contents/MacOS")
        let executablePath = (macosPath as NSString).appendingPathComponent("${APP_NAME}_original")
        
        // Check if executable exists
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: executablePath) else {
            print("Error: Could not find ${APP_NAME}_original at: \\(executablePath)")
            // Show alert and keep app running for debugging
            let alert = NSAlert()
            alert.messageText = "Error"
            alert.informativeText = "Could not find server executable at: \\(executablePath)"
            alert.alertStyle = .critical
            alert.runModal()
            endLoadingDockCue()
            return
        }
        
        // Make sure executable is executable
        do {
            try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executablePath)
        } catch {
            print("Warning: Could not set executable permissions: \\(error)")
        }
        
        // Ready flag: Node touches this file when Sunshine/Moonlight/tunnel are up.
        let supportRoot = (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/Application Support/MyHomeGames")
        try? fileManager.createDirectory(atPath: supportRoot, withIntermediateDirectories: true)
        readyFlagPath = (supportRoot as NSString).appendingPathComponent("server-ready.flag")
        try? fileManager.removeItem(atPath: readyFlagPath)
        
        // Launch the server process
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = []
        
        // GUI launches (Dock/Finder) get a minimal PATH — include Homebrew + Docker CLI
        // so docker / colima work the same as when started from Terminal.
        var env = ProcessInfo.processInfo.environment
        let pathPrefix = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/Applications/Docker.app/Contents/Resources/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ].joined(separator: ":")
        if let currentPath = env["PATH"], !currentPath.isEmpty {
            env["PATH"] = "\\(pathPrefix):\\(currentPath)"
        } else {
            env["PATH"] = pathPrefix
        }
        env["MHG_READY_FLAG"] = readyFlagPath
        process.environment = env
        
        // Set working directory to Resources (where .env file is)
        let resourcesPath = (bundlePath as NSString).appendingPathComponent("Contents/Resources")
        process.currentDirectoryPath = resourcesPath
        
        // Redirect output to console (keep stderr separate for errors)
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard data.count > 0, let output = String(data: data, encoding: .utf8) else { return }
            self?.consumeStdout(output)
        }
        
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard data.count > 0, let output = String(data: data, encoding: .utf8) else { return }
            print(output, terminator: "")
            self?.consumeStdout(output)
        }
        
        do {
            try process.run()
            self.serverProcess = process
            print("Server process started with PID: \\(process.processIdentifier)")
            print("Waiting for ready flag at: \\(readyFlagPath)")
            
            process.terminationHandler = { process in
                print("Server process terminated with status: \\(process.terminationStatus)")
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
            }
            
            let deadline = Date().addingTimeInterval(readyTimeoutSeconds)
            while !isServerReady() {
                if !process.isRunning {
                    print("Server exited before ready flag")
                    break
                }
                if Date() >= deadline {
                    print("Timed out waiting for ready after \\(Int(readyTimeoutSeconds))s")
                    break
                }
                RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
            }
            
            endLoadingDockCue()
            if isServerReady() {
                print("Dock loading cue cleared after Server ready")
            }
        } catch {
            print("Error launching server: \\(error)")
            let alert = NSAlert()
            alert.messageText = "Error Launching Server"
            alert.informativeText = "Failed to start server: \\(error.localizedDescription)"
            alert.alertStyle = .critical
            alert.runModal()
            endLoadingDockCue()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                NSApplication.shared.terminate(nil)
            }
        }
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        // Terminate server process gracefully
        if let process = serverProcess, process.isRunning {
            process.terminate()
            // Wait up to 5 seconds for graceful shutdown
            let group = DispatchGroup()
            group.enter()
            process.terminationHandler = { _ in group.leave() }
            _ = group.wait(timeout: .now() + 5)
            // Force kill if still running (use SIGKILL)
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
        }
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false // Don't terminate when window closes (we have no window)
    }
    
    @objc func showAbout(_ sender: Any?) {
        let L = AboutStrings.current
        let alert = NSAlert()
        alert.messageText = "${APP_NAME}"
        alert.alertStyle = .informational
        let contentWidth: CGFloat = 420
        let contentHeight: CGFloat = 140
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: contentWidth, height: contentHeight))
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.isAutomaticLinkDetectionEnabled = true
        if let url = Bundle.main.url(forResource: "server-info", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = info["version"] as? String,
           let buildDate = info["buildDate"] as? String {
            let attr = NSMutableAttributedString()
            attr.append(NSAttributedString(string: "\\(L.version) \\(version)\\n"))
            attr.append(NSAttributedString(string: "\\(L.build) \\(buildDate)\\n"))
            if let creator = info["creator"] as? String {
                attr.append(NSAttributedString(string: "\\(L.creator) \\(creator)\\n"))
            }
            if let community = info["community"] as? String {
                attr.append(NSAttributedString(string: "\\(L.community) \\(community)\\n"))
            }
            if let website = info["website"] as? String, let linkURL = URL(string: website) {
                attr.append(NSAttributedString(string: "\\(L.website) "))
                let linkStr = NSMutableAttributedString(string: website)
                linkStr.addAttribute(.link, value: linkURL, range: NSRange(location: 0, length: website.count))
                attr.append(linkStr)
            }
            textView.textStorage?.setAttributedString(attr)
        } else {
            textView.string = "\\(L.version) –"
        }
        textView.textColor = .labelColor
        let wrapper = NSView(frame: NSRect(x: 0, y: 0, width: contentWidth, height: contentHeight))
        wrapper.addSubview(textView)
        alert.accessoryView = wrapper
        alert.runModal()
    }
}

struct AboutStrings {
    let version: String
    let build: String
    let creator: String
    let community: String
    let website: String
    static var current: AboutStrings {
        let pref = Locale.preferredLanguages.first ?? ""
        return pref.hasPrefix("it") ? AboutStrings.it : AboutStrings.en
    }
    static let en = AboutStrings(
        version: "Version",
        build: "Build:",
        creator: "Creator:",
        community: "Community:",
        website: "Website:"
    )
    static let it = AboutStrings(
        version: "Versione",
        build: "Build:",
        creator: "Creatore:",
        community: "Community:",
        website: "Sito web:"
    )
}

struct MenuStrings {
    let aboutApp: String
    let quitApp: String
    let quit: String
    static var current: MenuStrings {
        let pref = Locale.preferredLanguages.first ?? ""
        return pref.hasPrefix("it") ? MenuStrings.it : MenuStrings.en
    }
    static let en = MenuStrings(
        aboutApp: "About ${APP_NAME}",
        quitApp: "Quit ${APP_NAME}",
        quit: "Quit"
    )
    static let it = MenuStrings(
        aboutApp: "Informazioni su ${APP_NAME}",
        quitApp: "Esci da ${APP_NAME}",
        quit: "Esci"
    )
}

// Create and run the app
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

// Menu principale (nome app in alto a sinistra) – testi in base alla lingua di sistema
let menuL = MenuStrings.current
let mainMenu = NSMenu()
let appMenuItem = NSMenuItem()
mainMenu.addItem(appMenuItem)
let appMenu = NSMenu(title: "${APP_NAME}")
appMenuItem.submenu = appMenu
let aboutItem = NSMenuItem(title: menuL.aboutApp, action: #selector(AppDelegate.showAbout(_:)), keyEquivalent: "")
aboutItem.target = delegate
appMenu.addItem(aboutItem)
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(NSMenuItem(title: menuL.quitApp, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
NSApp.mainMenu = mainMenu

// Menu bar icon (right) for quick access
let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
if let button = statusItem.button {
    button.image = NSImage(systemSymbolName: "server.rack", accessibilityDescription: "MyHomeGames Server")
    button.toolTip = "MyHomeGames Server"
}
let statusMenu = NSMenu()
statusMenu.addItem(NSMenuItem(title: menuL.quit, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
statusItem.menu = statusMenu

app.run()
`;

// Write Swift source file
const swiftSourcePath = path.join(BUILD_DIR, 'wrapper.swift');
fs.writeFileSync(swiftSourcePath, swiftWrapper);

// Compile Swift wrapper to executable
const swiftExecutablePath = path.join(MACOS_PATH, APP_NAME);
try {
  console.log('Compiling Swift wrapper...');
  execSync(`swiftc -o "${swiftExecutablePath}" "${swiftSourcePath}"`, {
    stdio: 'inherit',
    cwd: BUILD_DIR
  });
  fs.chmodSync(swiftExecutablePath, '755');
  // Clean up Swift source
  fs.unlinkSync(swiftSourcePath);
  console.log('✅ Swift wrapper compiled successfully');
} catch (error) {
  console.error('⚠️  Failed to compile Swift wrapper:', error.message);
  console.log('   Falling back to bash wrapper...');
  
  // Fallback to bash wrapper if Swift compilation fails
  const dollar = '$';
  const bashWrapperScript = `#!/bin/bash
# Wrapper script for MyHomeGames server
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin:${dollar}{PATH}"
SCRIPT_DIR="${dollar}( cd "${dollar}( dirname "${dollar}{BASH_SOURCE[0]}" )" && pwd )"
EXECUTABLE="${dollar}{SCRIPT_DIR}/${APP_NAME}_original"
trap 'if [ ! -z "${dollar}PID" ]; then kill -TERM ${dollar}PID 2>/dev/null; wait ${dollar}PID 2>/dev/null; fi; exit 0' SIGTERM SIGINT
"${dollar}EXECUTABLE" &
PID=${dollar}!
wait ${dollar}PID
exit ${dollar}?
`;
  fs.writeFileSync(swiftExecutablePath, bashWrapperScript);
  fs.chmodSync(swiftExecutablePath, '755');
}

// Step 4: Create Info.plist
console.log('Step 3: Creating Info.plist...');
const { buildServerInfo } = require('../utils/compatibility');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const serverInfo = buildServerInfo(path.join(__dirname, '..'));
const serverInfoJson = JSON.stringify(serverInfo, null, 2);
const SERVER_INFO_FILENAME = 'server-info.json';
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.myhomegames.server</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${packageJson.version}</string>
  <key>CFBundleVersion</key>
  <string>${packageJson.version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSRequiresAquaSystemAppearance</key>
  <false/>
  <key>LSUIElement</key>
  <false/>
  <key>LSBackgroundOnly</key>
  <false/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>`;

fs.writeFileSync(path.join(CONTENTS_PATH, 'Info.plist'), infoPlist);

// Step 5: Create PkgInfo (optional but recommended)
fs.writeFileSync(path.join(CONTENTS_PATH, 'PkgInfo'), 'APPL????');

// Step 5.4: Bundle cloudflared for the macOS app (copied to writable metadata on first tunnel start)
console.log('Step 5.4: Bundling cloudflared binary...');
copyCloudflaredBinary(path.join(RESOURCES_PATH, 'bin'));

// Step 5.5: Create .env file with default configuration
console.log('Step 5: Creating .env file...');
const envContent = releaseEnvContent;
fs.writeFileSync(path.join(RESOURCES_PATH, '.env'), envContent);
fs.writeFileSync(path.join(RESOURCES_PATH, SERVER_INFO_FILENAME), serverInfoJson);
console.log('✅ .env file created with default configuration');

// Step 6: App icon (Dock / Finder)
console.log('Step 6: Creating app icon...');
const ASSETS_DIR = path.join(__dirname, 'assets');
const BUNDLED_ICNS = path.join(ASSETS_DIR, 'AppIcon.icns');
const BUNDLED_PNG = path.join(ASSETS_DIR, 'app-icon-1024.png');
const RETINA_SUFFIX = '@' + '2x.png';

function findMagickBin() {
  const candidates = [
    process.env.MAGICK_BIN,
    '/opt/homebrew/bin/magick',
    '/usr/local/bin/magick',
    '/opt/homebrew/bin/convert',
    '/usr/local/bin/convert',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const which = execSync('which magick || which convert', { encoding: 'utf8' }).trim().split('\n')[0];
    if (which) return which;
  } catch (_) {}
  return null;
}

function writeIconsetFromPng(basePng, iconSetPath) {
  // Apple iconset only: icon_NxN.png (N px) and icon_NxN + RETINA_SUFFIX (2N px).
  // Do not include bare icon_64x64.png or icon_1024x1024.png (iconutil rejects them).
  const entries = [
    [16, 16], [16, 32], [32, 32], [32, 64],
    [128, 128], [128, 256], [256, 256], [256, 512],
    [512, 512], [512, 1024],
  ];
  if (fs.existsSync(iconSetPath)) {
    fs.rmSync(iconSetPath, { recursive: true, force: true });
  }
  fs.mkdirSync(iconSetPath, { recursive: true });
  for (const [logical, px] of entries) {
    const name = px === logical
      ? `icon_${logical}x${logical}.png`
      : `icon_${logical}x${logical}` + RETINA_SUFFIX;
    const dest = path.join(iconSetPath, name);
    const tmp = path.join(BUILD_DIR, `_icon_resize_${px}.png`);
    execSync(`sips -z ${px} ${px} "${basePng}" --out "${tmp}"`, { stdio: 'pipe' });
    fs.copyFileSync(tmp, dest);
    fs.unlinkSync(tmp);
  }
}

try {
  const iconSetPath = path.join(BUILD_DIR, 'icon.iconset');
  const icnsPath = path.join(RESOURCES_PATH, 'AppIcon.icns');
  let iconCreated = false;
  let basePng = fs.existsSync(BUNDLED_PNG) ? BUNDLED_PNG : null;

  if (fs.existsSync(BUNDLED_ICNS)) {
    fs.copyFileSync(BUNDLED_ICNS, icnsPath);
    console.log('✅ AppIcon.icns copied from scripts/assets');
    iconCreated = true;
  }

  if (!iconCreated) {
    if (!basePng) {
      const magick = findMagickBin();
      if (!magick) {
        throw new Error('No bundled AppIcon.icns/app-icon-1024.png and ImageMagick not found');
      }
      basePng = path.join(BUILD_DIR, 'app-icon-1024.png');
      const font = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
      const fontArg = fs.existsSync(font) ? `-font "${font}"` : '';
      execSync(
        `"${magick}" -size 1024x1024 xc:'#FFD700' ${fontArg} -gravity center ` +
          `-pointsize 520 -fill black -annotate 0 'MY' "${basePng}"`,
        { stdio: 'pipe' }
      );
      console.log('✅ Generated app-icon-1024.png via ImageMagick');
    }

    writeIconsetFromPng(basePng, iconSetPath);
    execSync(`iconutil -c icns "${iconSetPath}" -o "${icnsPath}"`, { stdio: 'inherit' });
    iconCreated = true;
    console.log('✅ AppIcon.icns created via iconutil');
  }

  // Windows tray PNG
  const trayDest = path.join(BUILD_DIR, 'MyHomeGames-Tray.png');
  const traySource = basePng || (fs.existsSync(BUNDLED_PNG) ? BUNDLED_PNG : null);
  if (traySource) {
    execSync(`sips -z 32 32 "${traySource}" --out "${trayDest}"`, { stdio: 'pipe' });
    console.log('✅ Windows tray icon: MyHomeGames-Tray.png');
  }

  if (!fs.existsSync(icnsPath)) {
    throw new Error('AppIcon.icns missing after Step 6');
  }

  if (fs.existsSync(iconSetPath)) {
    fs.rmSync(iconSetPath, { recursive: true, force: true });
  }
} catch (error) {
  console.error('❌ Could not create app icon:', error.message);
  console.error('   Add scripts/assets/AppIcon.icns (or app-icon-1024.png) or install ImageMagick.');
  process.exitCode = 1;
}

// Step 7: Create .pkg installers (mac-x64 and mac-arm64)
console.log('Step 7: Creating .pkg installers (mac-x64 and mac-arm64)...');
const version = packageJson.version;
// pkg multi-target: -macos-arm64 (no node18); single-target: plain "myhomegames-server"
const macArm64Exe =
  (['myhomegames-server-macos-arm64', 'myhomegames-server-node18-macos-arm64', 'myhomegames-server'].map((name) => path.join(BUILD_DIR, name)).find((p) => fs.existsSync(p))) || null;

// Remove old .pkg files with the same version (if any)
const existingPkgs = fs.readdirSync(BUILD_DIR).filter(file =>
  file.endsWith('.pkg') && file.includes(version)
);
existingPkgs.forEach(file => {
  fs.unlinkSync(path.join(BUILD_DIR, file));
});

function createPkg(pkgSuffix) {
  const pkgName = `${APP_NAME}-${version}-mac-${pkgSuffix}.pkg`;
  const pkgPath = path.join(BUILD_DIR, pkgName);
  const pkgRoot = path.join(BUILD_DIR, 'pkgroot');
  const applicationsDir = path.join(pkgRoot, 'Applications');
  fs.mkdirSync(applicationsDir, { recursive: true });
  const appInPkg = path.join(applicationsDir, APP_BUNDLE);
  fs.cpSync(TEMP_APP_PATH, appInPkg, { recursive: true });

  function fixPermissions(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.chmodSync(fullPath, '755');
        fixPermissions(fullPath);
      } else {
        if (entry.name === APP_NAME || entry.name.endsWith('.icns')) {
          fs.chmodSync(fullPath, '755');
        } else {
          fs.chmodSync(fullPath, '644');
        }
      }
    }
  }
  fixPermissions(appInPkg);

  const scriptsDir = path.join(BUILD_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) fs.rmSync(scriptsDir, { recursive: true, force: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  const postinstallScript = `#!/bin/bash
APP_PATH="/Applications/${APP_BUNDLE}"
if [ -d "$APP_PATH" ]; then
    INSTALL_USER=$(stat -f "%Su" /dev/console 2>/dev/null || echo "$USER")
    if [ -z "$INSTALL_USER" ] || [ "$INSTALL_USER" = "root" ]; then
        INSTALL_USER=$(defaults read /Library/Preferences/com.apple.loginwindow lastUserName 2>/dev/null || echo "")
    fi
    find "$APP_PATH" -type d -exec chmod 755 {} \\;
    find "$APP_PATH" -type f ! -name "${APP_NAME}" ! -name "*.icns" -exec chmod 644 {} \\;
    if [ -f "$APP_PATH/Contents/MacOS/${APP_NAME}" ]; then
        chmod 755 "$APP_PATH/Contents/MacOS/${APP_NAME}"
    fi
    find "$APP_PATH" -name "*.icns" -exec chmod 644 {} \\;
    if [ -n "$INSTALL_USER" ] && [ "$INSTALL_USER" != "root" ] && id "$INSTALL_USER" &>/dev/null; then
        chown -R "$INSTALL_USER:staff" "$APP_PATH"
    else
        chmod -R a+rX "$APP_PATH"
    fi
fi
exit 0
`;
  const postinstallPath = path.join(scriptsDir, 'postinstall');
  fs.writeFileSync(postinstallPath, postinstallScript);
  fs.chmodSync(postinstallPath, '755');

  const componentPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>CFBundleIdentifier</key>
    <string>com.myhomegames.server</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>RootRelativeBundlePath</key>
    <string>Applications/${APP_BUNDLE}</string>
    <key>IFPkgFlagInstalledSize</key>
    <integer>1</integer>
  </dict>
</array>
</plist>`;
  const componentPlistPath = path.join(BUILD_DIR, 'component.plist');
  fs.writeFileSync(componentPlistPath, componentPlist);

  execSync(`pkgbuild --root "${pkgRoot}" --component-plist "${componentPlistPath}" --scripts "${scriptsDir}" --install-location / "${pkgPath}"`, {
    stdio: 'inherit'
  });

  if (fs.existsSync(pkgRoot)) fs.rmSync(pkgRoot, { recursive: true, force: true });
  if (fs.existsSync(componentPlistPath)) fs.unlinkSync(componentPlistPath);
  if (fs.existsSync(scriptsDir)) fs.rmSync(scriptsDir, { recursive: true, force: true });
  console.log(`✅ ${pkgName}`);
}

try {
  createPkg('x64');

  if (macArm64Exe) {
    // Replace executable in .app with arm64 for the second .pkg
    fs.copyFileSync(macArm64Exe, originalExecutablePath);
    fs.chmodSync(originalExecutablePath, '755');
    createPkg('arm64');
  } else {
    console.log('⚠️  arm64 executable not found, only mac-x64.pkg was created.');
  }

  console.log(`\n📦 App bundle: ${TEMP_APP_PATH}`);
  console.log(`\nTo install: double-click the .pkg or run sudo installer -pkg "build/<pkg>" -target /`);
} catch (error) {
  console.error('Error creating .pkg:', error.message);
  console.log(`\n⚠️  App bundle created at: ${TEMP_APP_PATH} but .pkg creation failed.`);
}

// Step 8: Package Linux and Windows (executable + .env, then archive)
const envContentStandalone = releaseEnvContent;
const linuxExe = ['myhomegames-server-linux-x64', 'myhomegames-server-node18-linux-x64'].find((n) => fs.existsSync(path.join(BUILD_DIR, n)));
const winExe = ['myhomegames-server-win-x64.exe', 'myhomegames-server-node18-win-x64.exe'].find((n) => fs.existsSync(path.join(BUILD_DIR, n)));

function keepOnlyFinalArtifacts() {
  const keepPatterns = [
    /\.pkg$/,
    /-linux-x64\.tar\.gz$/,
    /^MyHomeGames-.*-win-x64\.zip$/,
    /^myhomegames-server_.*_amd64\.deb$/,
    /^myhomegames-server-.*\.x86_64\.rpm$/,
  ];
  const toKeep = (name) => keepPatterns.some((re) => re.test(name));
  for (const name of fs.readdirSync(BUILD_DIR)) {
    const full = path.join(BUILD_DIR, name);
    if (toKeep(name)) continue;
    try {
      if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
    } catch (_) {}
  }
  console.log('\n✅ build/ contiene solo i pacchetti finali.');
}

if (linuxExe || winExe) {
  console.log('\nStep 8: Packaging Linux and Windows...');
  const version = packageJson.version;

  if (linuxExe) {
    fs.writeFileSync(path.join(BUILD_DIR, '.env'), envContentStandalone);
    fs.writeFileSync(path.join(BUILD_DIR, SERVER_INFO_FILENAME), serverInfoJson);
    const linuxBinDir = path.join(BUILD_DIR, 'bin');
    const hasLinuxBin = copyCloudflaredBinary(linuxBinDir);
    const tarName = `MyHomeGames-${version}-linux-x64.tar.gz`;
    const tarPath = path.join(BUILD_DIR, tarName);
    const tarMembers = [`"${linuxExe}"`, '".env"', `"${SERVER_INFO_FILENAME}"`];
    if (hasLinuxBin) {
      tarMembers.push('"bin"');
    }
    try {
      execSync(`tar -czf "${tarPath}" -C "${BUILD_DIR}" ${tarMembers.join(' ')}`, {
        stdio: 'inherit',
      });
      console.log(`✅ Linux: ${tarName}`);
    } catch (e) {
      console.log('⚠️  Linux tarball failed:', e.message);
    }
  }

  if (winExe) {
    try {
      buildWindowsUnifiedExe();
    } catch (e) {
      console.log('⚠️  Windows packaging failed:', e.message);
    }
  }

  // Step 9: Linux .deb (deboa) and .rpm (rpm-builder) — npm only; .rpm requires rpmbuild on the system
  if (linuxExe) {
    (async () => {
      const pkgRoot = path.join(BUILD_DIR, 'linux-pkgroot');
      if (fs.existsSync(pkgRoot)) fs.rmSync(pkgRoot, { recursive: true, force: true });
      const optDir = path.join(pkgRoot, 'opt', 'myhomegames-server');
      const usrBinDir = path.join(pkgRoot, 'usr', 'bin');
      fs.mkdirSync(optDir, { recursive: true });
      fs.mkdirSync(usrBinDir, { recursive: true });
      fs.copyFileSync(path.join(BUILD_DIR, linuxExe), path.join(optDir, 'myhomegames-server'));
      fs.chmodSync(path.join(optDir, 'myhomegames-server'), '755');
      if (!fs.existsSync(path.join(BUILD_DIR, '.env'))) {
        fs.writeFileSync(path.join(BUILD_DIR, '.env'), envContentStandalone);
      }
      fs.copyFileSync(path.join(BUILD_DIR, '.env'), path.join(optDir, '.env'));
      fs.writeFileSync(path.join(optDir, SERVER_INFO_FILENAME), serverInfoJson);
      copyCloudflaredBinary(path.join(optDir, 'bin'));
      const wrapper = `#!/bin/sh
cd /opt/myhomegames-server && exec ./myhomegames-server "$@"
`;
      fs.writeFileSync(path.join(usrBinDir, 'myhomegames-server'), wrapper);
      fs.chmodSync(path.join(usrBinDir, 'myhomegames-server'), '755');

      const PKG_HOMEPAGE = 'https://github.com/myhomegames/myhomegames-server';
      const PKG_MAINTAINER = 'MyHomeGames <noreply@myhomegames.dev>';
      const PKG_SHORT_DESCRIPTION =
        'Self-hosted game library backend for MyHomeGames (catalog and remote play)';
      const PKG_LONG_DESCRIPTION_LINES = [
        'MyHomeGames Server powers the MyHomeGames web app: a self-hosted catalog for',
        'your game collection (covers, metadata, libraries, and launchers). It is not a',
        'game store or DRM platform — you keep and run your own games.',
        '',
        'Features include a local HTTP API, optional Cloudflare Tunnel for remote access,',
        'UI skins, and optional Sunshine / Moonlight Web setup for browser remote play.',
        '',
        'Installed under /opt/myhomegames-server. Start with: myhomegames-server',
        '',
        'Web UI: https://github.com/myhomegames/myhomegames-web',
        `Docs: ${PKG_HOMEPAGE}`,
      ];
      // Deboa prefixes only the first extended-description line with a space; continue lines need one too.
      const pkgDebExtendedDescription = PKG_LONG_DESCRIPTION_LINES.map((line, idx) => {
        const body = line === '' ? '.' : line;
        return idx === 0 ? body : ` ${body}`;
      }).join('\n');
      const pkgRpmDescription = PKG_LONG_DESCRIPTION_LINES.join('\n');

      // .deb con deboa (npm, cross-platform)
      try {
        const { Deboa } = require('deboa');
        const deboa = new Deboa({
          sourceDir: optDir,
          targetDir: BUILD_DIR,
          installationRoot: 'opt/myhomegames-server',
          controlFileOptions: {
            packageName: 'myhomegames-server',
            version,
            shortDescription: PKG_SHORT_DESCRIPTION,
            extendedDescription: pkgDebExtendedDescription,
            maintainer: PKG_MAINTAINER,
            homepage: PKG_HOMEPAGE,
            section: 'games',
            priority: 'optional',
            architecture: 'amd64',
          },
          modifyTarHeader: (header) => {
            if (header.name && header.name.endsWith('myhomegames-server') && !header.name.endsWith('.env')) {
              header.mode = parseInt('0755', 8);
            }
            return header;
          },
          beforePackage: (dataFolderDestination) => {
            const usrBin = path.join(dataFolderDestination, 'usr', 'bin');
            fs.mkdirSync(usrBin, { recursive: true });
            const wrapperPath = path.join(usrBin, 'myhomegames-server');
            fs.writeFileSync(wrapperPath, wrapper);
            fs.chmodSync(wrapperPath, '755');
          },
        });
        await deboa.package();
        console.log(`✅ Linux: myhomegames-server_${version}_amd64.deb`);
      } catch (e) {
        console.log('⚠️  .deb failed:', e.message);
      }

      // .rpm via rpm-builder (npm); requires rpmbuild on the system (Linux or brew install rpm on macOS)
      // Paths must be relative to cwd: absolute src paths make globby return [] → empty RPM.
      try {
        const buildRpm = require('rpm-builder');
        const optDirRel = path.relative(process.cwd(), optDir) || '.';
        const usrBinDirRel = path.relative(process.cwd(), usrBinDir) || '.';
        const rpmFiles = [
          { cwd: optDirRel, src: 'myhomegames-server', dest: '/opt/myhomegames-server/' },
          { cwd: optDirRel, src: '.env', dest: '/opt/myhomegames-server/' },
          { cwd: optDirRel, src: SERVER_INFO_FILENAME, dest: '/opt/myhomegames-server/' },
          { cwd: usrBinDirRel, src: 'myhomegames-server', dest: '/usr/bin/' },
        ];
        const optBinDir = path.join(optDir, 'bin');
        if (fs.existsSync(optBinDir) && fs.readdirSync(optBinDir).length > 0) {
          rpmFiles.push({
            cwd: path.relative(process.cwd(), optBinDir) || '.',
            src: '*',
            dest: '/opt/myhomegames-server/bin/',
          });
        }
        const rpmOutName = `myhomegames-server-${version}-1.x86_64.rpm`;
        const rpmOutPath = path.join(BUILD_DIR, rpmOutName);
        await new Promise((resolve, reject) => {
          buildRpm(
            {
              name: 'myhomegames-server',
              version,
              release: '1',
              buildArch: 'x86_64',
              summary: PKG_SHORT_DESCRIPTION,
              description: pkgRpmDescription,
              license: 'Apache-2.0',
              vendor: 'MyHomeGames',
              packager: PKG_MAINTAINER,
              group: 'Amusements/Games',
              url: PKG_HOMEPAGE,
              rpmDest: BUILD_DIR,
              tempDir: path.join(BUILD_DIR, 'rpm-work'),
              verbose: false,
              files: rpmFiles,
            },
            (err, rpmPath) => {
              if (err) return reject(err);
              if (rpmPath) console.log(`✅ Linux: ${rpmOutName}`);
              resolve(rpmPath);
            }
          );
        });
        // Fail loudly if rpmbuild produced an empty package (common with bad file paths)
        if (!fs.existsSync(rpmOutPath) || fs.statSync(rpmOutPath).size < 1024 * 1024) {
          const size = fs.existsSync(rpmOutPath) ? fs.statSync(rpmOutPath).size : 0;
          throw new Error(
            `RPM looks empty (${size} bytes). Check rpm-builder file paths / rpmbuild output.`,
          );
        }
      } catch (e) {
        console.log('⚠️  .rpm skipped (rpmbuild required, e.g. on Linux or: brew install rpm):', e.message);
      }

      if (fs.existsSync(pkgRoot)) fs.rmSync(pkgRoot, { recursive: true, force: true });

      keepOnlyFinalArtifacts();
    })();
  } else if (winExe) {
    keepOnlyFinalArtifacts();
  }
}
