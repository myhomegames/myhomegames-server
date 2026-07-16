const fs = require("fs");
const path = require("path");

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
  readPackageVersion,
  buildServerInfo,
};
