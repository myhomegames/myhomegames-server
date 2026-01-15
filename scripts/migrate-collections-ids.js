#!/usr/bin/env node
// Script to migrate collection IDs from text-based to numeric IDs

const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile, ensureDirectoryExists } = require('../utils/fileUtils');

const METADATA_PATH = process.env.METADATA_PATH || 
  path.join(process.env.HOME || process.env.USERPROFILE || '', 'Library', 'Application Support', 'MyHomeGames');

const COLLECTIONS_DIR = path.join(METADATA_PATH, 'content', 'collections');

function isNumeric(str) {
  return /^\d+$/.test(str);
}

function migrateCollections() {
  if (!fs.existsSync(COLLECTIONS_DIR)) {
    console.log('Collections directory does not exist. Nothing to migrate.');
    return;
  }

  const collectionFolders = fs.readdirSync(COLLECTIONS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`Found ${collectionFolders.length} collections to check...`);

  let migratedCount = 0;
  const migrations = [];

  for (const oldId of collectionFolders) {
    // Skip if already numeric
    if (isNumeric(oldId)) {
      console.log(`✓ Collection "${oldId}" already has numeric ID, skipping`);
      continue;
    }

    const oldPath = path.join(COLLECTIONS_DIR, oldId);
    const metadataPath = path.join(oldPath, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      console.log(`⚠ Skipping "${oldId}" - no metadata.json found`);
      continue;
    }

    // Load collection metadata
    const collection = readJsonFile(metadataPath, null);
    if (!collection) {
      console.log(`⚠ Skipping "${oldId}" - could not read metadata.json`);
      continue;
    }

    // Generate new numeric ID
    const newId = Date.now() + migratedCount; // Add migratedCount to ensure uniqueness
    const newPath = path.join(COLLECTIONS_DIR, String(newId));

    // Check if new ID already exists (unlikely but possible)
    if (fs.existsSync(newPath)) {
      console.log(`⚠ New ID ${newId} already exists, trying next...`);
      continue;
    }

    console.log(`Migrating "${oldId}" (${collection.title || 'untitled'}) -> ${newId}`);

    try {
      // Create new directory
      ensureDirectoryExists(newPath);

      // Copy all files from old directory to new directory
      const files = fs.readdirSync(oldPath);
      for (const file of files) {
        const oldFilePath = path.join(oldPath, file);
        const newFilePath = path.join(newPath, file);
        
        if (fs.statSync(oldFilePath).isFile()) {
          fs.copyFileSync(oldFilePath, newFilePath);
        }
      }

      // Update metadata.json with new ID
      collection.id = newId;
      const updatedMetadataPath = path.join(newPath, 'metadata.json');
      const collectionToSave = { ...collection };
      delete collectionToSave.id; // ID is in folder name
      writeJsonFile(updatedMetadataPath, collectionToSave);

      // Store migration info
      migrations.push({
        oldId,
        newId,
        title: collection.title || 'untitled'
      });

      // Remove old directory
      fs.rmSync(oldPath, { recursive: true, force: true });

      migratedCount++;
      console.log(`  ✓ Successfully migrated to ${newId}`);
    } catch (error) {
      console.error(`  ✗ Error migrating "${oldId}":`, error.message);
      // Try to clean up new directory if it was created
      if (fs.existsSync(newPath)) {
        try {
          fs.rmSync(newPath, { recursive: true, force: true });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Migrated ${migratedCount} collections`);
  
  if (migrations.length > 0) {
    console.log(`\nMigration summary:`);
    migrations.forEach(m => {
      console.log(`   "${m.oldId}" (${m.title}) -> ${m.newId}`);
    });
  }
}

// Run migration
console.log('Starting collection ID migration...');
console.log(`Collections directory: ${COLLECTIONS_DIR}\n`);

try {
  migrateCollections();
} catch (error) {
  console.error('Fatal error during migration:', error);
  process.exit(1);
}
