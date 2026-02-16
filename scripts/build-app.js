#!/usr/bin/env node
// Script to build macOS .app bundle

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  execSync('npx pkg . --targets node18-macos-x64,node18-macos-arm64,node18-linux-x64,node18-win-x64 --output-path build', {
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
    
    func applicationDidFinishLaunching(_ notification: Notification) {
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
            return
        }
        
        // Make sure executable is executable
        do {
            try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executablePath)
        } catch {
            print("Warning: Could not set executable permissions: \\(error)")
        }
        
        // Launch the server process
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = []
        
        // Set up environment - preserve current environment and add PATH
        var env = ProcessInfo.processInfo.environment
        if let currentPath = env["PATH"] {
            env["PATH"] = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\\(currentPath)"
        } else {
            env["PATH"] = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        }
        process.environment = env
        
        // Set working directory to Resources (where .env file is)
        let resourcesPath = (bundlePath as NSString).appendingPathComponent("Contents/Resources")
        process.currentDirectoryPath = resourcesPath
        
        // Redirect output to console (keep stderr separate for errors)
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        
        // Read output asynchronously
        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.count > 0 {
                if let output = String(data: data, encoding: .utf8) {
                    print(output, terminator: "")
                }
            }
        }
        
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.count > 0 {
                if let output = String(data: data, encoding: .utf8) {
                    print(output, terminator: "")
                }
            }
        }
        
        do {
            try process.run()
            self.serverProcess = process
            print("Server process started with PID: \\(process.processIdentifier)")
            
            // Signal that app is ready (this stops the bouncing icon)
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
            
            // Monitor the process
            process.terminationHandler = { process in
                print("Server process terminated with status: \\(process.terminationStatus)")
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
            }
        } catch {
            print("Error launching server: \\(error)")
            // Show alert instead of terminating immediately
            let alert = NSAlert()
            alert.messageText = "Error Launching Server"
            alert.informativeText = "Failed to start server: \\(error.localizedDescription)"
            alert.alertStyle = .critical
            alert.runModal()
            // Keep app running for a moment to see the error
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

// Icona nella menu bar (destra) per accesso rapido
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
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const serverInfo = {
  name: packageJson.name,
  version: packageJson.version,
  buildDate: new Date().toISOString(),
  creator: 'Luca Stancapiano',
  community: 'Vige',
  website: 'https://myhomegames.vige.it',
};
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

// Step 5.5: Create .env file with default configuration
console.log('Step 5: Creating .env file...');
const envContent = `HTTP_PORT=4000
HTTPS_ENABLED=true
HTTPS_PORT=41440
API_BASE=https://localhost:41440
FRONTEND_URL=https://myhomegames.vige.it/app/
`;
fs.writeFileSync(path.join(RESOURCES_PATH, '.env'), envContent);
fs.writeFileSync(path.join(RESOURCES_PATH, SERVER_INFO_FILENAME), serverInfoJson);
console.log('✅ .env file created with default configuration');

// Step 6: Create icon from favicon design
console.log('Step 6: Creating app icon...');
try {
  // Create icon.iconset directory structure
  const iconSetPath = path.join(BUILD_DIR, 'icon.iconset');
  if (fs.existsSync(iconSetPath)) {
    fs.rmSync(iconSetPath, { recursive: true, force: true });
  }
  fs.mkdirSync(iconSetPath, { recursive: true });
  
  let iconCreated = false;
  const baseIconPath = path.join(BUILD_DIR, 'icon_base.png');
  
  // Try ImageMagick first (if available)
  try {
    execSync(`which convert`, { stdio: 'ignore' });
    
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#FFD700" rx="128"/>
  <text x="512" y="512" font-family="Arial, sans-serif" font-size="600" font-weight="bold" fill="black" text-anchor="middle" dominant-baseline="middle">MY</text>
</svg>`;
    const svgPath = path.join(BUILD_DIR, 'icon.svg');
    fs.writeFileSync(svgPath, svgIcon);
    
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of sizes) {
      const pngPath = path.join(iconSetPath, `icon_${size}x${size}.png`);
      execSync(`convert -background none -size ${size}x${size} "${svgPath}" "${pngPath}"`, { stdio: 'ignore' });
      
      if (size <= 512) {
        const size2x = size * 2;
        const pngPath2x = path.join(iconSetPath, `icon_${size}x${size}@2x.png`);
        execSync(`convert -background none -size ${size2x}x${size2x} "${svgPath}" "${pngPath2x}"`, { stdio: 'ignore' });
      }
    }
    
    if (fs.existsSync(svgPath)) {
      fs.unlinkSync(svgPath);
    }
    iconCreated = true;
  } catch (e) {
    // ImageMagick not available, try Python (built-in on macOS)
    try {
      // Create a base PNG using Python PIL/Pillow
      const pythonScript = `
from PIL import Image, ImageDraw, ImageFont
import sys

size = 1024
img = Image.new('RGB', (size, size), color='#FFD700')
draw = ImageDraw.Draw(img)

# Try to use a system font
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 600)
except:
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 600)
    except:
        font = ImageFont.load_default()

# Draw "MY" text centered
text = "MY"
bbox = draw.textbbox((0, 0), text, font=font)
text_width = bbox[2] - bbox[0]
text_height = bbox[3] - bbox[1]
position = ((size - text_width) // 2, (size - text_height) // 2 - bbox[1])
draw.text(position, text, fill='black', font=font)

img.save(sys.argv[1], 'PNG')
`;
      const pythonScriptPath = path.join(BUILD_DIR, 'create_icon.py');
      fs.writeFileSync(pythonScriptPath, pythonScript);
      
      execSync(`python3 "${pythonScriptPath}" "${baseIconPath}"`, { stdio: 'ignore' });
      
      if (fs.existsSync(pythonScriptPath)) {
        fs.unlinkSync(pythonScriptPath);
      }
      
      if (fs.existsSync(baseIconPath)) {
        // Use sips (built-in macOS) to resize to all required sizes
        const sizes = [16, 32, 64, 128, 256, 512, 1024];
        for (const size of sizes) {
          const pngPath = path.join(iconSetPath, `icon_${size}x${size}.png`);
          execSync(`sips -z ${size} ${size} "${baseIconPath}" --out "${pngPath}"`, { stdio: 'ignore' });
          
          if (size <= 512) {
            const size2x = size * 2;
            const pngPath2x = path.join(iconSetPath, `icon_${size}x${size}@2x.png`);
            execSync(`sips -z ${size2x} ${size2x} "${baseIconPath}" --out "${pngPath2x}"`, { stdio: 'ignore' });
          }
        }
        
        fs.unlinkSync(baseIconPath);
        iconCreated = true;
      }
    } catch (pyError) {
      // Python/PIL not available, create minimal icon using sips with a solid color
      console.log('⚠️  ImageMagick and Python PIL not found. Creating minimal icon...');
      // Create a simple colored square using sips (it can create solid color images)
      try {
        // Create a 1x1 PNG with yellow color, then resize it
        const onePixelScript = `
from PIL import Image
import sys
img = Image.new('RGB', (1, 1), color='#FFD700')
img.save(sys.argv[1], 'PNG')
`;
        const onePixelScriptPath = path.join(BUILD_DIR, 'create_pixel.py');
        fs.writeFileSync(onePixelScriptPath, onePixelScript);
        const onePixelPath = path.join(BUILD_DIR, 'one_pixel.png');
        execSync(`python3 "${onePixelScriptPath}" "${onePixelPath}"`, { stdio: 'ignore' });
        fs.unlinkSync(onePixelScriptPath);
        
        if (fs.existsSync(onePixelPath)) {
          // Resize to 1024x1024
          execSync(`sips -z 1024 1024 "${onePixelPath}" --out "${baseIconPath}"`, { stdio: 'ignore' });
          fs.unlinkSync(onePixelPath);
          
          // Create all sizes
          const sizes = [16, 32, 64, 128, 256, 512, 1024];
          for (const size of sizes) {
            const pngPath = path.join(iconSetPath, `icon_${size}x${size}.png`);
            execSync(`sips -z ${size} ${size} "${baseIconPath}" --out "${pngPath}"`, { stdio: 'ignore' });
            
            if (size <= 512) {
              const size2x = size * 2;
              const pngPath2x = path.join(iconSetPath, `icon_${size}x${size}@2x.png`);
              execSync(`sips -z ${size2x} ${size2x} "${baseIconPath}" --out "${pngPath2x}"`, { stdio: 'ignore' });
            }
          }
          
          if (fs.existsSync(baseIconPath)) {
            fs.unlinkSync(baseIconPath);
          }
          iconCreated = true;
        }
      } catch (e) {
        console.log('⚠️  Could not create icon. App will work but may not display an icon.');
      }
    }
  }
  
  // Convert iconset to .icns if icon was created
  if (iconCreated) {
    const icnsPath = path.join(RESOURCES_PATH, 'AppIcon.icns');
    execSync(`iconutil -c icns "${iconSetPath}" -o "${icnsPath}"`, { stdio: 'inherit' });
    console.log('✅ Icon created successfully');
  }
  
  // Clean up iconset
  if (fs.existsSync(iconSetPath)) {
    fs.rmSync(iconSetPath, { recursive: true, force: true });
  }
} catch (error) {
  console.log('⚠️  Could not create icon:', error.message);
  console.log('   The app will work but may not display an icon.');
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
const envContentStandalone = `HTTP_PORT=4000
HTTPS_ENABLED=true
HTTPS_PORT=41440
API_BASE=https://localhost:41440
FRONTEND_URL=https://myhomegames.vige.it/app/
`;
const linuxExe = ['myhomegames-server-linux-x64', 'myhomegames-server-node18-linux-x64'].find((n) => fs.existsSync(path.join(BUILD_DIR, n)));
const winExe = ['myhomegames-server-win-x64.exe', 'myhomegames-server-node18-win-x64.exe'].find((n) => fs.existsSync(path.join(BUILD_DIR, n)));

function keepOnlyFinalArtifacts() {
  const keepPatterns = [
    /\.pkg$/,
    /-linux-x64\.tar\.gz$/,
    /-win-x64\.zip$/,
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
    const tarName = `MyHomeGames-${version}-linux-x64.tar.gz`;
    const tarPath = path.join(BUILD_DIR, tarName);
    try {
      execSync(`tar -czf "${tarPath}" -C "${BUILD_DIR}" "${linuxExe}" ".env" "${SERVER_INFO_FILENAME}"`, { stdio: 'inherit' });
      console.log(`✅ Linux: ${tarName}`);
    } catch (e) {
      console.log('⚠️  Linux tarball failed:', e.message);
    }
  }

  if (winExe) {
    if (!fs.existsSync(path.join(BUILD_DIR, '.env'))) {
      fs.writeFileSync(path.join(BUILD_DIR, '.env'), envContentStandalone);
    }
    if (!fs.existsSync(path.join(BUILD_DIR, SERVER_INFO_FILENAME))) {
      fs.writeFileSync(path.join(BUILD_DIR, SERVER_INFO_FILENAME), serverInfoJson);
    }
    const zipName = `MyHomeGames-${version}-win-x64.zip`;
    const zipPath = path.join(BUILD_DIR, zipName);
    try {
      execSync(`cd "${BUILD_DIR}" && zip -q "${zipPath}" "${winExe}" ".env" "${SERVER_INFO_FILENAME}"`, { stdio: 'inherit' });
      console.log(`✅ Windows: ${zipName}`);
    } catch (e) {
      console.log('⚠️  Windows zip failed:', e.message);
    }
  }

  // Step 9: Linux .deb (deboa) and .rpm (rpm-builder) — solo npm; .rpm richiede rpmbuild su sistema
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
      const wrapper = `#!/bin/sh
cd /opt/myhomegames-server && exec ./myhomegames-server "$@"
`;
      fs.writeFileSync(path.join(usrBinDir, 'myhomegames-server'), wrapper);
      fs.chmodSync(path.join(usrBinDir, 'myhomegames-server'), '755');

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
            shortDescription: 'MyHomeGames server',
            maintainer: 'MyHomeGames <noreply@myhomegames.local>',
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

      // .rpm con rpm-builder (npm); richiede rpmbuild su sistema (Linux o brew install rpm su macOS)
      try {
        const buildRpm = require('rpm-builder');
        await new Promise((resolve, reject) => {
          buildRpm(
            {
              name: 'myhomegames-server',
              version,
              release: '1',
              buildArch: 'x86_64',
              summary: 'MyHomeGames server',
              description: 'MyHomeGames server',
              vendor: 'MyHomeGames',
              rpmDest: BUILD_DIR,
              tempDir: path.join(BUILD_DIR, 'rpm-work'),
              verbose: false,
              files: [
                { src: path.join(optDir, 'myhomegames-server'), dest: '/opt/myhomegames-server/' },
                { src: path.join(optDir, '.env'), dest: '/opt/myhomegames-server/' },
                { src: path.join(optDir, SERVER_INFO_FILENAME), dest: '/opt/myhomegames-server/' },
                { src: path.join(usrBinDir, 'myhomegames-server'), dest: '/usr/bin/' },
              ],
            },
            (err, rpmPath) => {
              if (err) return reject(err);
              if (rpmPath) console.log(`✅ Linux: myhomegames-server-${version}-1.x86_64.rpm`);
              resolve();
            }
          );
        });
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
