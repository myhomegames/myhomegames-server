const fs = require("fs");
const path = require("path");

/**
 * File utility functions
 */

/**
 * Helper function to write file
 * @param {string} filePath - Path to the file to write
 * @param {string} data - Data to write to the file
 * @param {string} encoding - File encoding (default: 'utf8')
 */
function writeFile(filePath, data, encoding = 'utf8') {
  fs.writeFileSync(filePath, data, encoding);
}

/**
 * Read and parse a JSON file, returning a default value on error
 * @param {string} filePath - Path to the JSON file
 * @param {any} defaultValue - Default value to return if file doesn't exist or is invalid
 * @returns {any} - Parsed JSON data or default value
 */
function readJsonFile(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      const txt = fs.readFileSync(filePath, "utf8");
      return JSON.parse(txt);
    }
  } catch (e) {
    console.error(`Failed to load ${filePath}:`, e.message);
  }
  return defaultValue;
}

/**
 * Ensure a directory exists, creating parent directories if needed (important for macOS)
 * @param {string} dirPath - Path to the directory to ensure exists
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    // Ensure parent directory exists first (important for macOS filesystem)
    const parentDir = path.dirname(dirPath);
    if (parentDir !== dirPath && !fs.existsSync(parentDir)) {
      ensureDirectoryExists(parentDir); // Recursive
    }
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Write JSON data to a file
 * @param {string} filePath - Path to the file
 * @param {any} data - Data to serialize to JSON
 * @param {number} indent - JSON indentation (default: 2)
 */
function writeJsonFile(filePath, data, indent = 2) {
  writeFile(filePath, JSON.stringify(data, null, indent), "utf8");
}

/**
 * Check if a directory is empty (contains no files or subdirectories)
 * @param {string} dirPath - Path to the directory to check
 * @returns {boolean} - True if directory is empty or doesn't exist, false otherwise
 */
function isDirectoryEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  try {
    const entries = fs.readdirSync(dirPath);
    return entries.length === 0;
  } catch (e) {
    // If we can't read the directory, consider it empty
    return true;
  }
}

/**
 * Remove a directory only if it's empty
 * @param {string} dirPath - Path to the directory to remove
 * @returns {boolean} - True if directory was removed, false if it wasn't empty or didn't exist
 */
function removeDirectoryIfEmpty(dirPath) {
  if (isDirectoryEmpty(dirPath)) {
    try {
      fs.rmdirSync(dirPath);
      return true;
    } catch (e) {
      // If removal fails, directory might not be empty or might have been removed already
      return false;
    }
  }
  return false;
}

module.exports = {
  writeFile,
  readJsonFile,
  ensureDirectoryExists,
  writeJsonFile,
  isDirectoryEmpty,
  removeDirectoryIfEmpty,
};

