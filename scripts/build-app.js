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

// Step 1: Build executable with pkg
console.log('Step 1: Creating executable with pkg...');
try {
  // Use pkg from package.json config - output to temp build directory
  execSync('npx pkg . --targets node18-macos-x64 --output-path build', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
} catch (error) {
  console.error('Error building executable:', error.message);
  process.exit(1);
}

// Step 2: Create .app bundle structure
console.log('Step 2: Creating .app bundle structure...');
fs.mkdirSync(CONTENTS_PATH, { recursive: true });
fs.mkdirSync(MACOS_PATH, { recursive: true });
fs.mkdirSync(RESOURCES_PATH, { recursive: true });

// Step 3: Move executable to MacOS folder
// pkg creates executable with name based on package.json name
const possibleNames = [
  'myhomegames-server-macos',
  'myhomegames-server',
  'server-macos',
  'server'
];

let executablePath = null;
for (const name of possibleNames) {
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

const finalExecutablePath = path.join(MACOS_PATH, APP_NAME);
fs.renameSync(executablePath, finalExecutablePath);
// Make executable
fs.chmodSync(finalExecutablePath, '755');

// Step 4: Create Info.plist
console.log('Step 3: Creating Info.plist...');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
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
</dict>
</plist>`;

fs.writeFileSync(path.join(CONTENTS_PATH, 'Info.plist'), infoPlist);

// Step 5: Create PkgInfo (optional but recommended)
fs.writeFileSync(path.join(CONTENTS_PATH, 'PkgInfo'), 'APPL????');

// Step 6: Create icon from favicon design
console.log('Step 5: Creating app icon...');
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

// Step 7: Create .pkg installer
console.log('Step 6: Creating .pkg installer...');
const PKG_NAME = `${APP_NAME}-${packageJson.version}.pkg`;
const PKG_PATH = path.join(BUILD_DIR, PKG_NAME);

// Remove old .pkg files with the same version (if any)
const existingPkgs = fs.readdirSync(BUILD_DIR).filter(file => 
  file.endsWith('.pkg') && file.includes(packageJson.version)
);
existingPkgs.forEach(file => {
  const oldPkgPath = path.join(BUILD_DIR, file);
  console.log(`Removing old package: ${file}`);
  fs.unlinkSync(oldPkgPath);
});

try {
  // Create a temporary directory for pkgbuild
  const pkgRoot = path.join(BUILD_DIR, 'pkgroot');
  const applicationsDir = path.join(pkgRoot, 'Applications');
  fs.mkdirSync(applicationsDir, { recursive: true });
  
  // Copy .app to Applications folder in pkgroot
  const appInPkg = path.join(applicationsDir, APP_BUNDLE);
  fs.cpSync(TEMP_APP_PATH, appInPkg, { recursive: true });
  
  // Fix permissions recursively: directories 755, files 644, executable 755
  function fixPermissions(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.chmodSync(fullPath, '755');
        fixPermissions(fullPath);
      } else {
        // Check if it's the executable
        if (entry.name === APP_NAME || entry.name.endsWith('.icns')) {
          fs.chmodSync(fullPath, '755');
        } else {
          fs.chmodSync(fullPath, '644');
        }
      }
    }
  }
  fixPermissions(appInPkg);
  
  // Create scripts directory for pkgbuild
  const scriptsDir = path.join(BUILD_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    fs.rmSync(scriptsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(scriptsDir, { recursive: true });
  
  // Create postinstall script to fix permissions after installation
  const postinstallScript = `#!/bin/bash
# Fix permissions for MyHomeGames.app after installation
APP_PATH="/Applications/${APP_BUNDLE}"
if [ -d "$APP_PATH" ]; then
    # Get the user who installed the package (from installer environment or last logged in user)
    INSTALL_USER=$(stat -f "%Su" /dev/console 2>/dev/null || echo "$USER")
    if [ -z "$INSTALL_USER" ] || [ "$INSTALL_USER" = "root" ]; then
        # Try to get the last logged in user
        INSTALL_USER=$(defaults read /Library/Preferences/com.apple.loginwindow lastUserName 2>/dev/null || echo "")
    fi
    
    # Set directory permissions
    find "$APP_PATH" -type d -exec chmod 755 {} \\;
    # Set file permissions (except executable)
    find "$APP_PATH" -type f ! -name "${APP_NAME}" ! -name "*.icns" -exec chmod 644 {} \\;
    # Set executable permissions
    if [ -f "$APP_PATH/Contents/MacOS/${APP_NAME}" ]; then
        chmod 755 "$APP_PATH/Contents/MacOS/${APP_NAME}"
    fi
    # Set icon permissions
    find "$APP_PATH" -name "*.icns" -exec chmod 644 {} \\;
    
    # Fix ownership to the installing user (if not root and user exists)
    if [ -n "$INSTALL_USER" ] && [ "$INSTALL_USER" != "root" ] && id "$INSTALL_USER" &>/dev/null; then
        chown -R "$INSTALL_USER:staff" "$APP_PATH"
    else
        # If we can't determine the user, at least make it readable by all
        chmod -R a+rX "$APP_PATH"
    fi
fi
exit 0
`;
  const postinstallPath = path.join(scriptsDir, 'postinstall');
  fs.writeFileSync(postinstallPath, postinstallScript);
  fs.chmodSync(postinstallPath, '755');
  
  // Create component plist for pkgbuild (must be an array of dictionaries)
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
    <string>${packageJson.version}</string>
    <key>RootRelativeBundlePath</key>
    <string>Applications/${APP_BUNDLE}</string>
    <key>IFPkgFlagInstalledSize</key>
    <integer>1</integer>
  </dict>
</array>
</plist>`;
  
  const componentPlistPath = path.join(BUILD_DIR, 'component.plist');
  fs.writeFileSync(componentPlistPath, componentPlist);
  
  // Build the .pkg using pkgbuild with postinstall script
  execSync(`pkgbuild --root "${pkgRoot}" --component-plist "${componentPlistPath}" --scripts "${scriptsDir}" --install-location / "${PKG_PATH}"`, {
    stdio: 'inherit'
  });
  
  // Clean up pkgroot, component.plist, and scripts directory (keep .app and .pkg)
  if (fs.existsSync(pkgRoot)) {
    fs.rmSync(pkgRoot, { recursive: true, force: true });
  }
  if (fs.existsSync(componentPlistPath)) {
    fs.unlinkSync(componentPlistPath);
  }
  if (fs.existsSync(scriptsDir)) {
    fs.rmSync(scriptsDir, { recursive: true, force: true });
  }
  
  console.log(`\n✅ Build complete!`);
  console.log(`\n📦 App bundle: ${TEMP_APP_PATH}`);
  console.log(`📦 Installer package: ${PKG_PATH}`);
  console.log(`\nTo install, double-click ${PKG_NAME} or run:`);
  console.log(`   sudo installer -pkg "${PKG_PATH}" -target /`);
} catch (error) {
  console.error('Error creating .pkg:', error.message);
  console.log(`\n⚠️  App bundle created at: ${TEMP_APP_PATH} but .pkg creation failed.`);
}
