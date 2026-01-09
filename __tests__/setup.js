const fs = require('fs');
const path = require('path');
const os = require('os');

// Create a temporary directory for test metadata
const testMetadataPath = path.join(os.tmpdir(), `myhomegames-test-${Date.now()}`);

// Set environment variables before requiring server
process.env.NODE_ENV = 'test';
process.env.METADATA_PATH = testMetadataPath;
process.env.API_TOKEN = 'test-token';
process.env.PORT = '0'; // Use random port for tests

// Create test metadata directory structure immediately when module is loaded
// This ensures directories exist before server.js is required
fs.mkdirSync(testMetadataPath, { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content'), { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content', 'library'), { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content', 'collections'), { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content', 'categories'), { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content', 'recommended'), { recursive: true });
fs.mkdirSync(path.join(testMetadataPath, 'content', 'games'), { recursive: true });

// Create initial settings.json file
const settingsFile = path.join(testMetadataPath, 'settings.json');
if (!fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify({}, null, 2), 'utf8');
}

// No need to create metadata.json files in main directories anymore
// Each item (game, collection, category, section) has its own folder with metadata.json

// Setup test environment
beforeAll(() => {
  // Copy test fixtures to test metadata directory
  const fixturesDir = path.join(__dirname, 'fixtures');
  
  // Copy games fixtures (each game has its own folder)
  const gamesSourceDir = path.join(fixturesDir, 'content', 'games');
  const gamesDestDir = path.join(testMetadataPath, 'content', 'games');
  if (fs.existsSync(gamesSourceDir)) {
    // Copy all game folders
    const gameFolders = fs.readdirSync(gamesSourceDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    gameFolders.forEach((gameId) => {
      const sourceGameDir = path.join(gamesSourceDir, gameId);
      const destGameDir = path.join(gamesDestDir, gameId);
      if (fs.existsSync(sourceGameDir)) {
        fs.mkdirSync(destGameDir, { recursive: true });
        // Copy all files in the game folder
        const files = fs.readdirSync(sourceGameDir);
        files.forEach((file) => {
          fs.copyFileSync(path.join(sourceGameDir, file), path.join(destGameDir, file));
        });
      }
    });
  }
  
  // Copy recommended sections (each section has its own folder)
  const recommendedSourceDir = path.join(fixturesDir, 'content', 'recommended');
  const recommendedDestDir = path.join(testMetadataPath, 'content', 'recommended');
  if (fs.existsSync(recommendedSourceDir)) {
    const sectionFolders = fs.readdirSync(recommendedSourceDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    sectionFolders.forEach((sectionId) => {
      const sourceSectionDir = path.join(recommendedSourceDir, sectionId);
      const destSectionDir = path.join(recommendedDestDir, sectionId);
      if (fs.existsSync(sourceSectionDir)) {
        fs.mkdirSync(destSectionDir, { recursive: true });
        const files = fs.readdirSync(sourceSectionDir);
        files.forEach((file) => {
          fs.copyFileSync(path.join(sourceSectionDir, file), path.join(destSectionDir, file));
        });
      }
    });
  }
  
  // Copy categories (each category has its own folder)
  const categoriesSourceDir = path.join(fixturesDir, 'content', 'categories');
  const categoriesDestDir = path.join(testMetadataPath, 'content', 'categories');
  if (fs.existsSync(categoriesSourceDir)) {
    const categoryFolders = fs.readdirSync(categoriesSourceDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    categoryFolders.forEach((categoryId) => {
      const sourceCategoryDir = path.join(categoriesSourceDir, categoryId);
      const destCategoryDir = path.join(categoriesDestDir, categoryId);
      if (fs.existsSync(sourceCategoryDir)) {
        fs.mkdirSync(destCategoryDir, { recursive: true });
        const files = fs.readdirSync(sourceCategoryDir);
        files.forEach((file) => {
          fs.copyFileSync(path.join(sourceCategoryDir, file), path.join(destCategoryDir, file));
        });
      }
    });
  }
  
  // Copy collections (each collection has its own folder)
  const collectionsSourceDir = path.join(fixturesDir, 'content', 'collections');
  const collectionsDestDir = path.join(testMetadataPath, 'content', 'collections');
  if (fs.existsSync(collectionsSourceDir)) {
    const collectionFolders = fs.readdirSync(collectionsSourceDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    collectionFolders.forEach((collectionId) => {
      const sourceCollectionDir = path.join(collectionsSourceDir, collectionId);
      const destCollectionDir = path.join(collectionsDestDir, collectionId);
      if (fs.existsSync(sourceCollectionDir)) {
        fs.mkdirSync(destCollectionDir, { recursive: true });
        const files = fs.readdirSync(sourceCollectionDir);
        files.forEach((file) => {
          fs.copyFileSync(path.join(sourceCollectionDir, file), path.join(destCollectionDir, file));
        });
      }
    });
  }
  
  // Copy settings.json
  const settingsSource = path.join(fixturesDir, 'settings.json');
  const settingsDest = path.join(testMetadataPath, 'settings.json');
  if (fs.existsSync(settingsSource)) {
    fs.copyFileSync(settingsSource, settingsDest);
  }
  
          // Create test cover image directories in content/games folder
          const testGameId = 1;
          const coverDir = path.join(testMetadataPath, 'content', 'games', String(testGameId));
  fs.mkdirSync(coverDir, { recursive: true });
  // Create a dummy cover file (empty file for testing)
  fs.writeFileSync(path.join(coverDir, 'cover.webp'), 'fake webp data');
});

// Cleanup after all tests
afterAll(async () => {
  // Give time for any pending async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Remove test metadata directory
  if (fs.existsSync(testMetadataPath)) {
    try {
      fs.rmSync(testMetadataPath, { recursive: true, force: true });
    } catch (error) {
      // Silently ignore cleanup errors - test directory will be cleaned up by OS eventually
      // This prevents test failures due to file system race conditions or locked files
    }
  }
});

module.exports = { testMetadataPath };

