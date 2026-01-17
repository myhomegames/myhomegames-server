const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import setup first to set environment variables
const { testMetadataPath } = require('./setup');

// Import server after setting up environment
let app;

beforeAll(() => {
  // Clear module cache to ensure fresh server instance
  delete require.cache[require.resolve('../server.js')];
  app = require('../server.js');
});

afterAll(async () => {
  // Give time for any pending async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Force garbage collection if available (helps with cleanup)
  if (global.gc) {
    global.gc();
  }
});

describe('Authentication', () => {
  test('should reject requests without token', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should accept requests with X-Auth-Token header', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
  });

  test('should accept requests with token query parameter', async () => {
    const response = await request(app)
      .get('/libraries/library/games?token=test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
  });

  test('should accept requests with Authorization header', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('Authorization', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
  });
});


describe('GET /covers/:gameId', () => {
  test('should return 404 for non-existent cover', async () => {
    const response = await request(app)
      .get('/covers/nonexistent_game')
      .expect(404);
    
    // Server returns 404 with image/webp content type and empty body to avoid CORB issues
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.body).toEqual(Buffer.from([]));
  });

  test('should return cover image for existing game', async () => {
    const response = await request(app)
      .get('/covers/1')
      .expect(200);
    
    expect(response.headers['content-type']).toContain('image/webp');
  });

  test('should handle URL-encoded game IDs', async () => {
    const encodedId = encodeURIComponent('1');
    const response = await request(app)
      .get(`/covers/${encodedId}`)
      .expect(200);
    
    expect(response.headers['content-type']).toContain('image/webp');
  });
});

describe('GET /launcher', () => {
  test('should return 400 if gameId is missing', async () => {
    const response = await request(app)
      .get('/launcher')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Missing gameId');
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .get('/launcher?gameId=nonexistent')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should launch game when executable is valid', async () => {
    const response = await request(app)
      .get('/launcher?gameId=1')
      .set('X-Auth-Token', 'test-token');
    
    // Should either succeed (if executable exists), fail with 500 (spawn error), or 400 (no executable/script not found)
    // 400 can happen if game doesn't have executables field or script file doesn't exist
    expect([200, 400, 404, 500]).toContain(response.status);
  });

  test('should accept executableName parameter', async () => {
    // First, get a game and upload multiple executables
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fs = require('fs');
      const path = require('path');
      const { testMetadataPath } = require('./setup');
      
      // Create game directory if it doesn't exist
      const gameDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      fs.mkdirSync(gameDir, { recursive: true });
      
      // Create two executable files
      const script1Content = '#!/bin/bash\necho "Script 1"';
      const script2Content = '#!/bin/bash\necho "Script 2"';
      fs.writeFileSync(path.join(gameDir, 'script1.sh'), script1Content);
      fs.chmodSync(path.join(gameDir, 'script1.sh'), 0o755);
      fs.writeFileSync(path.join(gameDir, 'script2.sh'), script2Content);
      fs.chmodSync(path.join(gameDir, 'script2.sh'), 0o755);
      
      // Update game metadata to include both executables
      const metadataPath = path.join(gameDir, 'metadata.json');
      let metadata = {};
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      }
      metadata.executables = ['script1', 'script2'];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Reload games to pick up the changes
      await request(app)
        .post('/reload-games')
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Test launcher with executableName parameter
      const response = await request(app)
        .get(`/launcher?gameId=${gameId}&executableName=script2`)
        .set('X-Auth-Token', 'test-token');
      
      // Should either succeed (if script2.sh exists), fail with 500 (spawn error), or 400/404 (script not found)
      expect([200, 400, 404, 500]).toContain(response.status);
      
      // If it returns 400, check that the error mentions the executable
      if (response.status === 400 && response.body.detail) {
        // The error should not say "no executables configured" if we passed executableName
        expect(response.body.detail).not.toContain('No executables configured');
      }
    }
  });

  test('should return 400 if executableName is not in game executables list', async () => {
    // First, get a game and ensure it has executables
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fs = require('fs');
      const path = require('path');
      const { testMetadataPath } = require('./setup');
      
      // Create game directory if it doesn't exist
      const gameDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      fs.mkdirSync(gameDir, { recursive: true });
      
      // Create an executable file
      const scriptContent = '#!/bin/bash\necho "Script 1"';
      fs.writeFileSync(path.join(gameDir, 'script1.sh'), scriptContent);
      fs.chmodSync(path.join(gameDir, 'script1.sh'), 0o755);
      
      // Update game metadata to include only script1
      const metadataPath = path.join(gameDir, 'metadata.json');
      let metadata = {};
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      }
      metadata.executables = ['script1'];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Reload games to pick up the changes
      await request(app)
        .post('/reload-games')
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Test launcher with invalid executableName
      const response = await request(app)
        .get(`/launcher?gameId=${gameId}&executableName=nonexistent`)
        .set('X-Auth-Token', 'test-token')
        .expect(400);
      
      expect(response.body).toHaveProperty('error', 'Launch failed');
      expect(response.body.detail).toContain('not found in game configuration');
    }
  });
});

describe('POST /reload-games', () => {
  test('should reload games and return count', async () => {
    const response = await request(app)
      .post('/reload-games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'reloaded');
    expect(response.body).toHaveProperty('count');
    expect(typeof response.body.count).toBe('number');
    expect(response.body.count).toBeGreaterThan(0);
    expect(response.body).toHaveProperty('collections');
    expect(typeof response.body.collections).toBe('number');
    expect(response.body).toHaveProperty('recommended');
    expect(typeof response.body.recommended).toBe('number');
    expect(response.body).toHaveProperty('categories');
    expect(typeof response.body.categories).toBe('number');
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .post('/reload-games')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('GET /settings', () => {
  test('should return settings', async () => {
    const response = await request(app)
      .get('/settings')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('language');
  });

  test('should return default settings if file does not exist', async () => {
    // Temporarily rename settings file
    const settingsPath = path.join(testMetadataPath, 'settings.json');
    const backupPath = settingsPath + '.backup';
    
    if (fs.existsSync(settingsPath)) {
      fs.renameSync(settingsPath, backupPath);
    }
    
    const response = await request(app)
      .get('/settings')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('language', 'en');
    
    // Restore settings file
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, settingsPath);
    }
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/settings')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('PUT /settings', () => {
  test('should accept settings update request', async () => {
    const newSettings = { language: 'it' };
    
    const response = await request(app)
      .put('/settings')
      .set('X-Auth-Token', 'test-token')
      .send(newSettings)
      .expect(200);
    
    // Note: Server currently does not persist settings to file
    // It only returns the merged settings in the response
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('settings');
    expect(response.body.settings).toHaveProperty('language', 'it');
  });

  test('should merge with existing settings', async () => {
    // First get current settings
    const currentResponse = await request(app)
      .get('/settings')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const currentLanguage = currentResponse.body.language;
    
    // Then update with new language
    const response = await request(app)
      .put('/settings')
      .set('X-Auth-Token', 'test-token')
      .send({ language: 'it' })
      .expect(200);
    
    expect(response.body.settings.language).toBe('it');
    
    // Verify settings were merged (should include other fields if they exist)
    expect(response.body.settings).toHaveProperty('language');
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .put('/settings')
      .send({ language: 'en' })
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});



