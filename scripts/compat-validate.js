#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROLE = "server";
const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "compatibility.json");

const errors = [];
if (!fs.existsSync(FILE)) {
  errors.push(`Missing ${FILE}`);
} else {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    errors.push(`Invalid JSON in ${FILE}: ${e.message}`);
    doc = null;
  }
  if (doc && doc.role !== ROLE) {
    errors.push(`role must be "${ROLE}"`);
  }
}

if (errors.length) {
  console.error("compatibility.json validation failed:\n");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log("compatibility.json is valid.");
