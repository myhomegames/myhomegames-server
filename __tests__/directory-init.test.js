const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Directory Structure Initialization', () => {
  let originalMetadataPath;
  let originalNodeEnv;
  let originalApiToken;
  
  beforeEach(() => {
    // Save original environment variables
    originalMetadataPath = process.env.METADATA_PATH;
    originalNodeEnv = process.env.NODE_ENV;
    originalApiToken = process.env.API_TOKEN;
    // Set NODE_ENV to test to prevent server from starting
    process.env.NODE_ENV = 'test';
    // Set API_TOKEN to avoid auth issues
    process.env.API_TOKEN = 'test-token';
    // Clear all module caches to ensure fresh load
    delete require.cache[require.resolve('../server.js')];
    delete require.cache[require.resolve('../routes/library.js')];
    delete require.cache[require.resolve('../routes/recommended.js')];
    delete require.cache[require.resolve('../routes/categories.js')];
    delete require.cache[require.resolve('../routes/collections.js')];
    delete require.cache[require.resolve('../routes/auth.js')];
  });
  
  afterEach(() => {
    // Restore original environment variables
    if (originalMetadataPath) {
      process.env.METADATA_PATH = originalMetadataPath;
    } else {
      delete process.env.METADATA_PATH;
    }
    if (originalNodeEnv) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalApiToken) {
      process.env.API_TOKEN = originalApiToken;
    } else {
      delete process.env.API_TOKEN;
    }
    // Clear module cache to ensure fresh load next time
    delete require.cache[require.resolve('../server.js')];
    delete require.cache[require.resolve('../routes/library.js')];
    delete require.cache[require.resolve('../routes/recommended.js')];
    delete require.cache[require.resolve('../routes/categories.js')];
    delete require.cache[require.resolve('../routes/collections.js')];
    delete require.cache[require.resolve('../routes/auth.js')];
  });
  
  test('should create metadata directories and files automatically on startup', () => {
    // Create a temporary directory for this test
    const tempMetadataPath = path.join(os.tmpdir(), `myhomegames-test-init-${Date.now()}`);
    
    // Ensure the directory doesn't exist
    if (fs.existsSync(tempMetadataPath)) {
      fs.rmSync(tempMetadataPath, { recursive: true, force: true });
    }
    
    // Set environment variable BEFORE requiring server
    // This is critical - METADATA_PATH is evaluated when the module loads
    process.env.METADATA_PATH = tempMetadataPath;
    
    // Now require the server - it will read METADATA_PATH and call ensureMetadataDirectories
    const testApp = require('../server.js');
    
    // Verify all directories were created
    const expectedDirectories = [
      tempMetadataPath,
      path.join(tempMetadataPath, 'content'),
      path.join(tempMetadataPath, 'content', 'games'),
      path.join(tempMetadataPath, 'content', 'collections'),
      path.join(tempMetadataPath, 'content', 'categories'),
      path.join(tempMetadataPath, 'content', 'recommended'),
    ];
    
    expectedDirectories.forEach((dir) => {
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    });
    
    // Verify settings.json was created
    const settingsFile = path.join(tempMetadataPath, 'settings.json');
    expect(fs.existsSync(settingsFile)).toBe(true);
    
    // Cleanup
    if (fs.existsSync(tempMetadataPath)) {
      fs.rmSync(tempMetadataPath, { recursive: true, force: true });
    }
  });
  
  test('should not fail if directories already exist', () => {
    // Create a temporary directory for this test
    const tempMetadataPath = path.join(os.tmpdir(), `myhomegames-test-exists-${Date.now()}`);
    
    // Pre-create some directories
    fs.mkdirSync(tempMetadataPath, { recursive: true });
    fs.mkdirSync(path.join(tempMetadataPath, 'content'), { recursive: true });
    
    // Set environment variable before requiring server
    process.env.METADATA_PATH = tempMetadataPath;
    
    // Clear module cache and require server (should not fail)
    expect(() => {
      const testApp = require('../server.js');
    }).not.toThrow();
    
    // Verify directories still exist
    expect(fs.existsSync(tempMetadataPath)).toBe(true);
    expect(fs.existsSync(path.join(tempMetadataPath, 'content'))).toBe(true);
    
    // Cleanup
    if (fs.existsSync(tempMetadataPath)) {
      fs.rmSync(tempMetadataPath, { recursive: true, force: true });
    }
  });
});

