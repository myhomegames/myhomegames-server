const fs = require("fs");
const path = require("path");

const COMPATIBILITY_FILENAME = "compatibility.json";

function readCompatibilityFile(baseDir) {
  const candidates = [
    path.join(baseDir, COMPATIBILITY_FILENAME),
    path.join(__dirname, "..", COMPATIBILITY_FILENAME),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { data, filePath };
      }
    } catch (_) {
      // try next
    }
  }
  return { data: null, filePath: null };
}

function readPackageVersion(baseDir = path.join(__dirname, "..")) {
  const packageJsonPath = path.join(baseDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

function buildServerInfo(baseDir = path.join(__dirname, "..")) {
  const packageJsonPath = path.join(baseDir, "package.json");
  let packageJson = { name: "myhomegames-server", version: "0.0.0" };
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (_) {
    // ignore
  }
  return {
    name: packageJson.name,
    version: packageJson.version,
    buildDate: new Date().toISOString(),
    creator: "Luca Stancapiano",
    community: "Vige",
    website: "https://myhomegames.vige.it",
  };
}

module.exports = {
  COMPATIBILITY_FILENAME,
  readCompatibilityFile,
  readPackageVersion,
  buildServerInfo,
};
