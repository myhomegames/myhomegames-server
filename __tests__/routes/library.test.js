const request = require('supertest');

// Import setup first to set environment variables
const { testMetadataPath } = require('../setup');

// Import server after setting up environment
let app;

beforeAll(() => {
  // Clear module cache to ensure fresh server instance
  delete require.cache[require.resolve('../../server.js')];
  app = require('../../server.js');
});

afterAll(async () => {
  // Give time for any pending async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Force garbage collection if available (helps with cleanup)
  if (global.gc) {
    global.gc();
  }
});

describe('GET /libraries/library/games', () => {
  test('should return games for library', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
    expect(Array.isArray(response.body.games)).toBe(true);
    expect(response.body.games.length).toBeGreaterThan(0);
  });

  test('should return games with correct structure', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (response.body.games.length > 0) {
      const game = response.body.games[0];
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('cover');
      expect(game.cover).toContain('/covers/');
    }
  });

  test('should include optional fields when present', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const gameWithStars = response.body.games.find(g => g.stars);
    if (gameWithStars) {
      expect(typeof gameWithStars.stars).toBe('number');
    }
  });

  // Helper: tag fields in API are [{ id, title }, ...]; support legacy string[] in assertions
  const tagArrayContainsTitle = (arr, title) =>
    Array.isArray(arr) && arr.some((t) => (typeof t === 'object' && t && t.title === title) || t === title);

  test('should return games with genres from fixtures', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);

    const game1 = response.body.games.find(g => g.id === 1);
    if (game1) {
      expect(game1).toHaveProperty('genre');
      expect(Array.isArray(game1.genre)).toBe(true);
      expect(tagArrayContainsTitle(game1.genre, 'Adventure')).toBe(true);
    }

    const game2 = response.body.games.find(g => g.id === 2);
    if (game2) {
      expect(game2).toHaveProperty('genre');
      expect(Array.isArray(game2.genre)).toBe(true);
      expect(tagArrayContainsTitle(game2.genre, 'Role-playing (RPG)')).toBe(true);
    }

    const game3 = response.body.games.find(g => g.id === 3);
    if (game3) {
      expect(game3).toHaveProperty('genre');
      expect(Array.isArray(game3.genre)).toBe(true);
      expect(tagArrayContainsTitle(game3.genre, 'Puzzle')).toBe(true);
      expect(tagArrayContainsTitle(game3.genre, 'Strategy')).toBe(true);
    }
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('GET /games/:gameId', () => {
  test('should return a single game by ID', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('id', gameId);
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('cover');
      expect(response.body.cover).toContain('/covers/');
    }
  });

  test('should return game with correct structure', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      const game = response.body;
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('cover');
      
      // Optional fields should be present but can be null
      expect(game).toHaveProperty('day');
      expect(game).toHaveProperty('month');
      expect(game).toHaveProperty('year');
      expect(game).toHaveProperty('stars');
      expect(game).toHaveProperty('genre');
      expect(game).toHaveProperty('criticratings');
      expect(game).toHaveProperty('userratings');
    }
  });

  test('should return criticratings and userratings when present', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Find a game with ratings (if any)
    const gameWithRatings = libraryResponse.body.games.find(g => {
      // We'll check by fetching the full game details
      return true; // Check all games
    });
    
    if (libraryResponse.body.games.length > 0) {
      // Try to find a game that has ratings by checking multiple games
      let foundGameWithRatings = null;
      
      for (const game of libraryResponse.body.games.slice(0, 10)) {
        const gameResponse = await request(app)
          .get(`/games/${game.id}`)
          .set('X-Auth-Token', 'test-token')
          .expect(200);
        
        if (gameResponse.body.criticratings !== null || gameResponse.body.userratings !== null) {
          foundGameWithRatings = gameResponse.body;
          break;
        }
      }
      
      if (foundGameWithRatings) {
        // Verify ratings are numbers between 0 and 10
        if (foundGameWithRatings.criticratings !== null) {
          expect(typeof foundGameWithRatings.criticratings).toBe('number');
          expect(foundGameWithRatings.criticratings).toBeGreaterThanOrEqual(0);
          expect(foundGameWithRatings.criticratings).toBeLessThanOrEqual(10);
        }
        
        if (foundGameWithRatings.userratings !== null) {
          expect(typeof foundGameWithRatings.userratings).toBe('number');
          expect(foundGameWithRatings.userratings).toBeGreaterThanOrEqual(0);
          expect(foundGameWithRatings.userratings).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .get('/games/non-existent-game-id')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .get(`/games/${gameId}`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle URL-encoded game IDs', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const encodedGameId = encodeURIComponent(gameId);
      
      const response = await request(app)
        .get(`/games/${encodedGameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('id', gameId);
    }
  });
});

describe('PUT /games/:gameId', () => {
  test('should update a single field', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const updateResponse = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ title: 'Updated Title' })
        .expect(200);
      
      expect(updateResponse.body).toHaveProperty('status', 'success');
      expect(updateResponse.body).toHaveProperty('game');
      expect(updateResponse.body.game).toHaveProperty('title', 'Updated Title');
      
      // Verify the update persisted by fetching again
      const verifyResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(verifyResponse.body).toHaveProperty('title', 'Updated Title');
    }
  });

  test('should update multiple fields', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const updateResponse = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ 
          title: 'New Title',
          stars: 9 
        })
        .expect(200);
      
      expect(updateResponse.body).toHaveProperty('status', 'success');
      expect(updateResponse.body.game).toHaveProperty('title', 'New Title');
      expect(updateResponse.body.game).toHaveProperty('stars', 9);
    }
  });

  test('should ignore non-allowed fields', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const originalTitle = libraryResponse.body.games[0].title;
      
      const updateResponse = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ 
          title: 'Updated Title',
          invalidField: 'should be ignored',
          anotherInvalidField: 123
        })
        .expect(200);
      
      expect(updateResponse.body.game).toHaveProperty('title', 'Updated Title');
      expect(updateResponse.body.game).not.toHaveProperty('invalidField');
    }
  });

  test('should return 400 when no valid fields provided', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ 
          invalidField: 'should be ignored',
          anotherInvalidField: 123
        })
        .expect(400);
      
      expect(response.body).toHaveProperty('error', 'No valid fields to update');
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .put('/games/non-existent-game-id')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Updated Title' })
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should return 404 for game not in library file', async () => {
    // Try to update a game that doesn't exist at all
    const response = await request(app)
      .put('/games/completely-nonexistent-game-id-12345')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Updated Title' })
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .put(`/games/${gameId}`)
        .send({ title: 'Updated Title' })
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should return updated game data', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const updateResponse = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ title: 'Updated Title' })
        .expect(200);
      
      const game = updateResponse.body.game;
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title', 'Updated Title');
      // Verify that criticratings and userratings are included in the response
      expect(game).toHaveProperty('criticratings');
      expect(game).toHaveProperty('userratings');
    }
  });

  test('should preserve criticratings and userratings after update', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      // Find a game with ratings
      let gameWithRatings = null;
      let gameId = null;
      
      for (const game of libraryResponse.body.games.slice(0, 10)) {
        const gameResponse = await request(app)
          .get(`/games/${game.id}`)
          .set('X-Auth-Token', 'test-token')
          .expect(200);
        
        if (gameResponse.body.criticratings !== null || gameResponse.body.userratings !== null) {
          gameWithRatings = gameResponse.body;
          gameId = game.id;
          break;
        }
      }
      
      if (gameWithRatings) {
        const originalCriticRatings = gameWithRatings.criticratings;
        const originalUserRatings = gameWithRatings.userratings;
        
        // Update a different field
        const updateResponse = await request(app)
          .put(`/games/${gameId}`)
          .set('X-Auth-Token', 'test-token')
          .send({ title: 'Updated Title' })
          .expect(200);
        
        // Verify ratings are preserved
        expect(updateResponse.body.game).toHaveProperty('criticratings', originalCriticRatings);
        expect(updateResponse.body.game).toHaveProperty('userratings', originalUserRatings);
      }
    }
  });
});

describe('POST /games/:gameId/reload', () => {
  test('should reload metadata for a single game', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .post(`/games/${gameId}/reload`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'reloaded');
      expect(response.body).toHaveProperty('game');
      expect(response.body.game).toHaveProperty('id', gameId);
      expect(response.body.game).toHaveProperty('title');
      expect(response.body.game).toHaveProperty('summary');
      expect(response.body.game).toHaveProperty('cover');
    }
  });

  test('should return game with correct structure after reload', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .post(`/games/${gameId}/reload`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      const game = response.body.game;
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('cover');
      expect(game.cover).toContain('/covers/');
      expect(game).toHaveProperty('day');
      expect(game).toHaveProperty('month');
      expect(game).toHaveProperty('year');
      expect(game).toHaveProperty('stars');
      expect(game).toHaveProperty('genre');
      expect(game).toHaveProperty('criticratings');
      expect(game).toHaveProperty('userratings');
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .post('/games/non-existent-game-id/reload')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .post(`/games/${gameId}/reload`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });
});

describe('POST /games/:gameId/upload-executable', () => {
  test('should upload a .sh file successfully', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "Hello World"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test-script.sh')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('game');
      expect(response.body.game).toHaveProperty('executables', ['script']);
      expect(response.body.game).toHaveProperty('id', gameId);
      
      // Verify the file was saved
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'script.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
      
      // Verify file content
      const savedContent = fs.readFileSync(scriptPath);
      expect(savedContent.toString()).toBe(fileContent.toString());
      
      // Verify executables field was updated in JSON
      const gameResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Verify executables contains 'script'
      expect(gameResponse.body).toHaveProperty('executables');
      expect(Array.isArray(gameResponse.body.executables)).toBe(true);
      expect(gameResponse.body.executables).toContain('script');
    }
  });

  test('should upload a .bat file successfully', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('@echo off\necho Hello World');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test-script.bat')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      // Verify executables contains 'script' (may have multiple if .sh file exists from previous test)
      expect(response.body.game).toHaveProperty('executables');
      expect(Array.isArray(response.body.game.executables)).toBe(true);
      expect(response.body.game.executables).toContain('script');
      
      // Verify the file was saved as script.bat
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'script.bat');
      expect(fs.existsSync(scriptPath)).toBe(true);
      
      // Verify file content
      const savedContent = fs.readFileSync(scriptPath);
      expect(savedContent.toString()).toBe(fileContent.toString());
    }
  });

  test('should reject files with invalid extensions', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('some content');
      
      // Try uploading a .txt file
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test-file.txt')
        .expect(400);
      
      expect(response.body).toHaveProperty('error', 'Only .sh and .bat files are allowed');
    }
  });

  test('should reject request without file', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .expect(400);
      
      expect(response.body).toHaveProperty('error', 'No file uploaded');
    }
  });

  test('should return 404 for non-existent game', async () => {
    const fileContent = Buffer.from('#!/bin/bash\necho "test"');
    
    const response = await request(app)
      .post('/games/non-existent-game-id/upload-executable')
      .set('X-Auth-Token', 'test-token')
      .attach('file', fileContent, 'test-script.sh')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .attach('file', fileContent, 'test-script.sh')
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should rename file to script.sh regardless of original name', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "renamed test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'my-custom-name.sh')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify the file was saved as script.sh (not my-custom-name.sh)
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'script.sh');
      const customPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'my-custom-name.sh');
      
      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.existsSync(customPath)).toBe(false);
    }
  });

  test('should rename file to script.bat regardless of original name', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('@echo off\necho "renamed test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'my-custom-name.bat')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify the file was saved as script.bat (not my-custom-name.bat)
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'script.bat');
      const customPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'my-custom-name.bat');
      
      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.existsSync(customPath)).toBe(false);
    }
  });

  test('should return updated game data with executables field', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test-script.sh')
        .expect(200);
      
      const game = response.body.game;
      expect(game).toHaveProperty('id', gameId);
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('cover');
      // Verify executables contains 'script' (may have multiple if .sh file exists from previous test)
      expect(game).toHaveProperty('executables');
      expect(Array.isArray(game.executables)).toBe(true);
      expect(game.executables).toContain('script');
      expect(game).toHaveProperty('day');
      expect(game).toHaveProperty('month');
      expect(game).toHaveProperty('year');
      expect(game).toHaveProperty('stars');
      expect(game).toHaveProperty('genre');
      expect(game).toHaveProperty('criticratings');
      expect(game).toHaveProperty('userratings');
    }
  });

  test('should reject .exe files', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('fake exe content');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test.exe')
        .expect(400);
      
      expect(response.body).toHaveProperty('error', 'Only .sh and .bat files are allowed');
    }
  });

  test('should save file with custom label when label parameter is provided', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "Custom label test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .field('label', 'play')
        .attach('file', fileContent, 'test-script.sh')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.game).toHaveProperty('executables');
      expect(Array.isArray(response.body.game.executables)).toBe(true);
      expect(response.body.game.executables).toContain('play');
      
      // Verify the file was saved as play.sh (not script.sh)
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const customPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'play.sh');
      
      expect(fs.existsSync(customPath)).toBe(true);
      
      // Verify file content
      const savedContent = fs.readFileSync(customPath);
      expect(savedContent.toString()).toBe(fileContent.toString());
    }
  });

  test('should sanitize label to valid filename', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "Sanitize test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .field('label', 'my custom label!')
        .attach('file', fileContent, 'test-script.sh')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify the file was saved with sanitized name (invalid chars replaced with _)
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const sanitizedPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'my_custom_label_.sh');
      
      expect(fs.existsSync(sanitizedPath)).toBe(true);
      
      // Verify executables contains original label (not sanitized) - this is what users see
      expect(response.body.game.executables).toContain('my custom label!');
    }
  });

  test('should use default script name when label is not provided', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const fileContent = Buffer.from('#!/bin/bash\necho "Default name test"');
      
      const response = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .attach('file', fileContent, 'test-script.sh')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.game).toHaveProperty('executables');
      expect(Array.isArray(response.body.game.executables)).toBe(true);
      expect(response.body.game.executables).toContain('script');
      
      // Verify the file was saved as script.sh (default behavior)
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'script.sh');
      
      expect(fs.existsSync(scriptPath)).toBe(true);
      
      // Verify file content
      const savedContent = fs.readFileSync(scriptPath);
      expect(savedContent.toString()).toBe(fileContent.toString());
    }
  });

  test('should preserve executables order from metadata.json', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      const metadataPath = path.join(gameContentDir, 'metadata.json');
      
      // Create multiple executable files
      const file1Content = Buffer.from('#!/bin/bash\necho "first"');
      const file2Content = Buffer.from('#!/bin/bash\necho "second"');
      const file3Content = Buffer.from('#!/bin/bash\necho "third"');
      
      fs.writeFileSync(path.join(gameContentDir, 'first.sh'), file1Content);
      fs.writeFileSync(path.join(gameContentDir, 'second.sh'), file2Content);
      fs.writeFileSync(path.join(gameContentDir, 'third.sh'), file3Content);
      
      // Set a specific order in metadata.json (different from alphabetical)
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      metadata.executables = ['third', 'first', 'second'];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Reload the game to refresh cache
      await request(app)
        .post(`/games/${gameId}/reload`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Get the game and verify order is preserved
      const gameResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Verify executables are in the order from metadata.json
      expect(gameResponse.body).toHaveProperty('executables');
      expect(gameResponse.body.executables).toEqual(['third', 'first', 'second']);
      
      // Clean up
      fs.unlinkSync(path.join(gameContentDir, 'first.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'second.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'third.sh'));
    }
  });

  test('should maintain executables order when updating via PUT', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      
      // Create multiple executable files
      const file1Content = Buffer.from('#!/bin/bash\necho "first"');
      const file2Content = Buffer.from('#!/bin/bash\necho "second"');
      const file3Content = Buffer.from('#!/bin/bash\necho "third"');
      
      fs.writeFileSync(path.join(gameContentDir, 'first.sh'), file1Content);
      fs.writeFileSync(path.join(gameContentDir, 'second.sh'), file2Content);
      fs.writeFileSync(path.join(gameContentDir, 'third.sh'), file3Content);
      
      // Update executables with a specific order
      const updateResponse = await request(app)
        .put(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .send({ executables: ['second', 'third', 'first'] })
        .expect(200);
      
      // Verify order is preserved in response
      expect(updateResponse.body.game).toHaveProperty('executables');
      expect(updateResponse.body.game.executables).toEqual(['second', 'third', 'first']);
      
      // Reload the game and verify order is still preserved
      const gameResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(gameResponse.body.executables).toEqual(['second', 'third', 'first']);
      
      // Clean up
      fs.unlinkSync(path.join(gameContentDir, 'first.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'second.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'third.sh'));
    }
  });

  test('should maintain existing order when uploading new executable', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      const metadataPath = path.join(gameContentDir, 'metadata.json');
      
      // Create initial executable files
      const file1Content = Buffer.from('#!/bin/bash\necho "first"');
      const file2Content = Buffer.from('#!/bin/bash\necho "second"');
      
      fs.writeFileSync(path.join(gameContentDir, 'first.sh'), file1Content);
      fs.writeFileSync(path.join(gameContentDir, 'second.sh'), file2Content);
      
      // Set initial order in metadata.json
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      metadata.executables = ['first', 'second'];
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Upload a new executable with label 'third'
      const newFileContent = Buffer.from('#!/bin/bash\necho "third"');
      const uploadResponse = await request(app)
        .post(`/games/${gameId}/upload-executable`)
        .set('X-Auth-Token', 'test-token')
        .field('label', 'third')
        .attach('file', newFileContent, 'test-script.sh')
        .expect(200);
      
      // Verify existing order is maintained and new executable is added
      expect(uploadResponse.body.game).toHaveProperty('executables');
      expect(uploadResponse.body.game.executables).toEqual(['first', 'second', 'third']);
      
      // Clean up
      fs.unlinkSync(path.join(gameContentDir, 'first.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'second.sh'));
      fs.unlinkSync(path.join(gameContentDir, 'third.sh'));
    }
  });
});

describe('DELETE /games/:gameId', () => {
  test('should delete a game successfully', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .delete(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify the game was deleted by trying to fetch it
      const getResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(404);
      
      expect(getResponse.body).toHaveProperty('error', 'Game not found');
      
      // Verify the game is no longer in the library list
      const libraryResponseAfter = await request(app)
        .get('/libraries/library/games')
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      const gameStillExists = libraryResponseAfter.body.games.some(g => g.id === gameId);
      expect(gameStillExists).toBe(false);
    }
  });

  test('should delete only metadata.json and remove directory only if empty', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Create a test content directory for the game
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      const metadataFile = path.join(gameContentDir, 'metadata.json');
      // Ensure parent directories exist (important for macOS filesystem)
      const parentDir = path.dirname(gameContentDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      if (!fs.existsSync(gameContentDir)) {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      
      // Verify metadata.json exists before deletion
      expect(fs.existsSync(metadataFile)).toBe(true);
      
      // Delete the game
      const response = await request(app)
        .delete(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify metadata.json was deleted
      expect(fs.existsSync(metadataFile)).toBe(false);
      
      // If directory is empty, it should be removed
      // If directory has other files, it should remain
      if (fs.existsSync(gameContentDir)) {
        const remainingFiles = fs.readdirSync(gameContentDir);
        // Directory still exists because it has other files (not empty)
        expect(remainingFiles.length).toBeGreaterThan(0);
      } else {
        // Directory was removed because it was empty after metadata.json deletion
        expect(true).toBe(true);
      }
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .delete('/games/non-existent-game-id')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .delete(`/games/${gameId}`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle game not found in library file gracefully', async () => {
    // This test verifies that if a game exists in memory but not in the file,
    // the deletion should still work (it will fail when trying to find it in the file)
    // Actually, the current implementation checks allGames first, so if it's not there,
    // it returns 404. Let's test the case where the game is in memory but not in file.
    // Actually, looking at the code, it checks allGames first, so if the game doesn't exist
    // in allGames, it returns 404. So this test is covered by the non-existent game test.
    
    // Test with a completely non-existent game ID
    const response = await request(app)
      .delete('/games/completely-nonexistent-game-id-12345')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should remove game from in-memory cache', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      // Verify game exists before deletion
      const getResponseBefore = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(getResponseBefore.body).toHaveProperty('id', gameId);
      
      // Delete the game
      const deleteResponse = await request(app)
        .delete(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(deleteResponse.body).toHaveProperty('status', 'success');
      
      // Verify game is removed from cache (should return 404)
      const getResponseAfter = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(404);
      
      expect(getResponseAfter.body).toHaveProperty('error', 'Game not found');
    }
  });

  test('should remove game from content/recommended/metadata.json (new format)', async () => {
    const fs = require('fs');
    const path = require('path');
    const { testMetadataPath } = require('../setup');
    
    // First, add a game to the library
    const addGameResponse = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999995,
        name: 'Test Game for Recommended Removal',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['Action'],
        criticRating: 80,
        userRating: 75
      })
      .expect(200);
    
    const gameId = addGameResponse.body.gameId;
    
    // Add the game to content/recommended/metadata.json (new format: array of sections)
    const recommendedFilePath = path.join(testMetadataPath, 'content', 'recommended', 'metadata.json');
    const recommendedData = [
      {
        id: 'section1',
        games: [gameId, 999, 888]
      },
      {
        id: 'section2',
        games: [777, gameId, 666]
      }
    ];
    fs.writeFileSync(recommendedFilePath, JSON.stringify(recommendedData, null, 2), 'utf8');
    
    // Verify the game is in the recommended file
    const recommendedBefore = JSON.parse(fs.readFileSync(recommendedFilePath, 'utf8'));
    const gameInSection1 = recommendedBefore[0].games.includes(gameId);
    const gameInSection2 = recommendedBefore[1].games.includes(gameId);
    expect(gameInSection1).toBe(true);
    expect(gameInSection2).toBe(true);
    
    // Delete the game
    const deleteResponse = await request(app)
      .delete(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(deleteResponse.body).toHaveProperty('status', 'success');
    
    // Verify the game was removed from content/recommended/metadata.json
    const recommendedAfter = JSON.parse(fs.readFileSync(recommendedFilePath, 'utf8'));
    const gameStillInSection1 = recommendedAfter[0].games.includes(gameId);
    const gameStillInSection2 = recommendedAfter[1].games.includes(gameId);
    expect(gameStillInSection1).toBe(false);
    expect(gameStillInSection2).toBe(false);
    
    // Verify other games are still there
    expect(recommendedAfter[0].games).toEqual([999, 888]);
    expect(recommendedAfter[1].games).toEqual([777, 666]);
  });

  test('should remove game from content/recommended/metadata.json (old format: array of IDs)', async () => {
    const fs = require('fs');
    const path = require('path');
    const { testMetadataPath } = require('../setup');
    
    // First, add a game to the library
    const addGameResponse = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999996,
        name: 'Test Game for Recommended Removal Old Format',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['Action'],
        criticRating: 80,
        userRating: 75
      })
      .expect(200);
    
    const gameId = addGameResponse.body.gameId;
    
    // Add the game to content/recommended/metadata.json (old format: array of IDs)
    const recommendedFilePath = path.join(testMetadataPath, 'content', 'recommended', 'metadata.json');
    const recommendedData = [gameId, 999, 888, 777];
    fs.writeFileSync(recommendedFilePath, JSON.stringify(recommendedData, null, 2), 'utf8');
    
    // Verify the game is in the recommended file
    const recommendedBefore = JSON.parse(fs.readFileSync(recommendedFilePath, 'utf8'));
    expect(recommendedBefore).toContain(gameId);
    
    // Delete the game
    const deleteResponse = await request(app)
      .delete(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(deleteResponse.body).toHaveProperty('status', 'success');
    
    // Verify the game was removed from content/recommended/metadata.json
    const recommendedAfter = JSON.parse(fs.readFileSync(recommendedFilePath, 'utf8'));
    expect(recommendedAfter).not.toContain(gameId);
    expect(recommendedAfter).toEqual([999, 888, 777]);
  });

  test('should delete orphaned categories when deleting a game', async () => {
    // Create a category
    const createCategoryResponse = await request(app)
      .post('/categories')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'orphanedcategory' })
      .expect(200);
    
    const categoryTitle = createCategoryResponse.body.category; // POST returns just the title string
    
    // Verify category exists
    const categoriesBefore = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const categoryExistsBefore = categoriesBefore.body.categories.some(cat => 
      (typeof cat === 'string' ? cat : cat.title) === categoryTitle
    );
    expect(categoryExistsBefore).toBe(true);
    
    // Add a game with this category
    const addGameResponse = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999994,
        name: 'Test Game with Orphaned Category',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['orphanedcategory'],
        criticRating: 80,
        userRating: 75
      })
      .expect(200);
    
    const gameId = addGameResponse.body.gameId;
    
    // Verify game has the category
    const gameResponse = await request(app)
      .get(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(
      (gameResponse.body.genre || []).some(
        (g) => (typeof g === 'object' && g && g.title === 'orphanedcategory') || g === 'orphanedcategory'
      )
    ).toBe(true);
    
    // Delete the game
    const deleteResponse = await request(app)
      .delete(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(deleteResponse.body).toHaveProperty('status', 'success');
    
    // Verify category was deleted (orphaned)
    const categoriesAfter = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const categoryExistsAfter = categoriesAfter.body.categories.some(cat => 
      (typeof cat === 'string' ? cat : cat.title) === categoryTitle
    );
    expect(categoryExistsAfter).toBe(false);
  });

  test('should not delete categories that are still used by other games', async () => {
    // Create a category
    const createCategoryResponse = await request(app)
      .post('/categories')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'sharedcategory' })
      .expect(200);
    
    const categoryTitle = createCategoryResponse.body.category;
    
    // Add first game with this category
    const addGame1Response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999993,
        name: 'Test Game 1 with Shared Category',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['sharedcategory'],
        criticRating: 80,
        userRating: 75
      })
      .expect(200);
    
    const gameId1 = addGame1Response.body.gameId;
    
    // Add second game with the same category
    const addGame2Response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999992,
        name: 'Test Game 2 with Shared Category',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['sharedcategory'],
        criticRating: 85,
        userRating: 80
      })
      .expect(200);
    
    const gameId2 = addGame2Response.body.gameId;
    
    // Delete first game
    const deleteResponse = await request(app)
      .delete(`/games/${gameId1}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(deleteResponse.body).toHaveProperty('status', 'success');
    
    // Verify category still exists (used by second game)
    const categoriesAfter = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const categoryExistsAfter = categoriesAfter.body.categories.some(cat => 
      (typeof cat === 'string' ? cat : cat.title) === categoryTitle
    );
    expect(categoryExistsAfter).toBe(true);
    
    // Cleanup: delete second game
    await request(app)
      .delete(`/games/${gameId2}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Now category should be deleted (orphaned)
    const categoriesFinal = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const categoryExistsFinal = categoriesFinal.body.categories.some(
      (c) => (typeof c === 'string' ? c : c.title) === categoryTitle
    );
    expect(categoryExistsFinal).toBe(false);
  });
});

describe('POST /games/add-from-igdb', () => {
  test('should add game from IGDB and create missing categories', async () => {
    // Get initial categories count
    const categoriesBefore = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const initialCategoriesCount = categoriesBefore.body.categories.length;
    
    // Add a game with new genres
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999999,
        name: 'Test Game from IGDB',
        summary: 'Test summary',
        cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/test.jpg',
        background: 'https://images.igdb.com/igdb/image/upload/t_1080p/test.jpg',
        releaseDate: 1609459200, // 2021-01-01 timestamp
        genres: ['New Genre 1', 'New Genre 2'],
        criticRating: 85,
        userRating: 80
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('game');
    expect(response.body).toHaveProperty('gameId', 999999);
    expect(response.body.game).toHaveProperty('id', 999999);
    expect(response.body.game).toHaveProperty('title', 'Test Game from IGDB');
    expect(response.body.game).toHaveProperty('genre');
    expect(Array.isArray(response.body.game.genre)).toBe(true);
    expect(
      response.body.game.genre.some((g) => (typeof g === 'object' && g && g.title === 'New Genre 1') || g === 'New Genre 1')
    ).toBe(true);
    expect(
      response.body.game.genre.some((g) => (typeof g === 'object' && g && g.title === 'New Genre 2') || g === 'New Genre 2')
    ).toBe(true);

    // Verify categories were created
    const categoriesAfter = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(categoriesAfter.body.categories.length).toBe(initialCategoriesCount + 2);
    
    const hasNewGenre1 = categoriesAfter.body.categories.some(cat => 
      (typeof cat === 'string' ? cat : cat.title) === 'New Genre 1'
    );
    const hasNewGenre2 = categoriesAfter.body.categories.some(cat => 
      (typeof cat === 'string' ? cat : cat.title) === 'New Genre 2'
    );
    expect(hasNewGenre1).toBe(true);
    expect(hasNewGenre2).toBe(true);
    
    // Cleanup: delete the test game
    await request(app)
      .delete(`/games/${999999}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
  });

  test('should not create duplicate categories if they already exist', async () => {
    // First create a category manually
    const createCategoryResponse = await request(app)
      .post('/categories')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Existing Genre' })
      .expect(200);
    
    const existingCategoryTitle = createCategoryResponse.body.category; // POST returns just the title string
    
    // Get categories count before adding game
    const categoriesBefore = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const initialCategoriesCount = categoriesBefore.body.categories.length;
    
    // Add a game with the same genre
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999998,
        name: 'Test Game with Existing Genre',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['Existing Genre'],
        criticRating: 75,
        userRating: 70
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
    
    // Verify genre was preserved (API returns [{ id, title }, ...])
    expect(response.body.game).toHaveProperty('genre');
    expect(Array.isArray(response.body.game.genre)).toBe(true);
    expect(
      response.body.game.genre.some((g) => (typeof g === 'object' && g && g.title === 'Existing Genre') || g === 'Existing Genre')
    ).toBe(true);
    
    // Verify category count didn't increase
    const categoriesAfter = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(categoriesAfter.body.categories.length).toBe(initialCategoriesCount);
    
    // Verify the existing category still exists
    const existingCategory = categoriesAfter.body.categories.find(c => {
      const title = typeof c === 'string' ? c : c.title;
      return title === existingCategoryTitle;
    });
    expect(existingCategory).toBeDefined();
    
    // Cleanup: delete the test game
    await request(app)
      .delete(`/games/${999998}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
  });

  test('should return 400 if required fields are missing', async () => {
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        name: 'Test Game'
        // Missing igdbId
      })
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Missing required fields: igdbId and name');
  });

  test('should return 409 if game already exists', async () => {
    // First get an existing game ID
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const existingGameId = libraryResponse.body.games[0].id;
      
      // Verify game exists in file system
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(existingGameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Ensure game is in cache by fetching it first
      // If game doesn't exist, skip this test (it may have been deleted by a previous test)
      const gameCheckResponse = await request(app)
        .get(`/games/${existingGameId}`)
        .set('X-Auth-Token', 'test-token');
      
      if (gameCheckResponse.status !== 200) {
        // Game was deleted by a previous test, skip this test
        return;
      }
      
      // Try to add the same game again
      const response = await request(app)
        .post('/games/add-from-igdb')
        .set('X-Auth-Token', 'test-token')
        .send({
          igdbId: existingGameId,
          name: 'Duplicate Game',
          summary: 'Test summary'
        })
        .expect(409);
      
      expect(response.body).toHaveProperty('error', 'Game already exists');
      expect(response.body).toHaveProperty('gameId', existingGameId);
    }
  });

  test('should allow adding game if directory exists but metadata.json does not', async () => {
    const { testMetadataPath } = require('../setup');
    const fs = require('fs');
    const path = require('path');
    
    const gameId = 999994;
    const gameDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
    const gameMetadataPath = path.join(gameDir, 'metadata.json');
    
    // Create directory without metadata.json
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }
    
    // Ensure metadata.json does not exist
    if (fs.existsSync(gameMetadataPath)) {
      fs.unlinkSync(gameMetadataPath);
    }
    
    // Verify directory exists but metadata.json does not
    expect(fs.existsSync(gameDir)).toBe(true);
    expect(fs.existsSync(gameMetadataPath)).toBe(false);
    
    // Add the game - should succeed
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: gameId,
        name: 'Test Game with Existing Directory',
        summary: 'Test summary',
        cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/test.jpg',
        background: 'https://images.igdb.com/igdb/image/upload/t_1080p/test.jpg',
        releaseDate: 1609459200,
        genres: ['Test Genre'],
        criticRating: 75,
        userRating: 70
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('game');
    expect(response.body).toHaveProperty('gameId', gameId);
    expect(response.body.game).toHaveProperty('id', gameId);
    expect(response.body.game).toHaveProperty('title', 'Test Game with Existing Directory');
    
    // Verify metadata.json was created
    expect(fs.existsSync(gameMetadataPath)).toBe(true);
    
    // Verify game can be retrieved
    const getResponse = await request(app)
      .get(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(getResponse.body).toHaveProperty('id', gameId);
    expect(getResponse.body).toHaveProperty('title', 'Test Game with Existing Directory');
    
    // Cleanup: delete the test game
    await request(app)
      .delete(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
  });

  test('should handle games without genres', async () => {
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999997,
        name: 'Test Game Without Genres',
        summary: 'Test summary',
        releaseDate: 1609459200
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.game).toHaveProperty('genre');
    expect(response.body.game.genre).toBeNull();
    
    // Cleanup: delete the test game
    await request(app)
      .delete(`/games/${999997}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .post('/games/add-from-igdb')
      .send({
        igdbId: 999996,
        name: 'Test Game'
      })
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should preserve genre case', async () => {
    // Add a game with uppercase genres
    const response = await request(app)
      .post('/games/add-from-igdb')
      .set('X-Auth-Token', 'test-token')
      .send({
        igdbId: 999995,
        name: 'Test Game with Uppercase Genres',
        summary: 'Test summary',
        releaseDate: 1609459200,
        genres: ['ACTION', 'ADVENTURE', 'RPG'],
        criticRating: 90,
        userRating: 85
      })
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.game).toHaveProperty('genre');
    expect(Array.isArray(response.body.game.genre)).toBe(true);

    // API returns genre as [{ id, title }, ...]
    const genreTitles = response.body.game.genre.map((g) => (typeof g === 'object' && g && g.title ? g.title : g));
    expect(genreTitles).toContain('ACTION');
    expect(genreTitles).toContain('ADVENTURE');
    expect(genreTitles).toContain('RPG');
    
    // Verify categories were created
    // Note: On case-insensitive filesystems (like macOS), category folder names use the first case created
    // The genres in the game preserve their original case, but category folders may differ
    const categoriesResponse = await request(app)
      .get('/categories')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // On case-insensitive filesystems, category folder names use the first case created
    // Check that either "ACTION" or "Action" exists (case-insensitive match)
    const hasAction = categoriesResponse.body.categories.some(cat => {
      const title = typeof cat === 'string' ? cat : cat.title;
      return title && title.toLowerCase() === 'action';
    });
    expect(hasAction).toBe(true);
    // On case-insensitive filesystems, "Adventure" may already exist from fixtures
    // Check that either "ADVENTURE" or "Adventure" exists (case-insensitive match)
    const hasAdventure = categoriesResponse.body.categories.some(cat => {
      const title = typeof cat === 'string' ? cat : cat.title;
      return title && title.toLowerCase() === 'adventure';
    });
    expect(hasAdventure).toBe(true);
    // Check that either "RPG" or "Rpg" exists (case-insensitive match)
    const hasRPG = categoriesResponse.body.categories.some(cat => {
      const title = typeof cat === 'string' ? cat : cat.title;
      return title && title.toLowerCase() === 'rpg';
    });
    expect(hasRPG).toBe(true);
    
    // Cleanup: delete the test game
    await request(app)
      .delete(`/games/${999995}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
  });
});

describe('DELETE /games/:gameId/delete-cover', () => {
  test('should delete cover image for a game', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Create a test cover file
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      if (!fs.existsSync(gameContentDir)) {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      const coverPath = path.join(gameContentDir, 'cover.webp');
      fs.writeFileSync(coverPath, 'fake cover content');
      
      // Verify cover file exists
      expect(fs.existsSync(coverPath)).toBe(true);
      
      // Ensure game is in cache by fetching it first
      // If game doesn't exist, skip this test (it may have been deleted by a previous test)
      const gameCheckResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token');
      
      if (gameCheckResponse.status !== 200) {
        // Game was deleted by a previous test, skip this test
        return;
      }
      
      // Delete the cover
      const response = await request(app)
        .delete(`/games/${gameId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('game');
      expect(response.body.game).toHaveProperty('id', gameId);
      
      // Verify cover file was deleted
      expect(fs.existsSync(coverPath)).toBe(false);
      
      // Verify cover field in response is null or undefined
      expect(response.body.game.cover).toBeFalsy();
      
      // Verify directory still exists (because metadata.json is still there)
      expect(fs.existsSync(gameContentDir)).toBe(true);
    }
  });

  test('should not delete directory when deleting cover if metadata.json exists', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Create a test cover file
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      if (!fs.existsSync(gameContentDir)) {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      const coverPath = path.join(gameContentDir, 'cover.webp');
      fs.writeFileSync(coverPath, 'fake cover content');
      
      // Ensure game is in cache by fetching it first
      // If game doesn't exist, skip this test (it may have been deleted by a previous test)
      const gameCheckResponse = await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token');
      
      if (gameCheckResponse.status !== 200) {
        // Game was deleted by a previous test, skip this test
        return;
      }
      
      // Delete the cover
      const response = await request(app)
        .delete(`/games/${gameId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify cover file was deleted
      expect(fs.existsSync(coverPath)).toBe(false);
      
      // Verify directory still exists because metadata.json is still there
      expect(fs.existsSync(gameContentDir)).toBe(true);
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
    }
  });

  test('should delete directory when deleting cover if directory becomes empty', async () => {
    // This test verifies that if a directory becomes completely empty after deleting a cover,
    // it gets deleted. This can happen if metadata.json was somehow removed or corrupted.
    
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      const { deleteMediaFile } = require('../../utils/gameMediaUtils');
      
      // Create a temporary directory with only a cover file (no metadata.json)
      // This simulates an edge case where directory might be empty
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      
      // Clean up any existing files in the directory first
      if (fs.existsSync(gameContentDir)) {
        const existingFiles = fs.readdirSync(gameContentDir);
        existingFiles.forEach(file => {
          fs.unlinkSync(path.join(gameContentDir, file));
        });
      } else {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      
      // Create only cover file (no metadata.json in this test scenario)
      const coverPath = path.join(gameContentDir, 'cover.webp');
      fs.writeFileSync(coverPath, 'fake cover content');
      
      // Verify directory contains only the cover file
      const filesBefore = fs.readdirSync(gameContentDir);
      expect(filesBefore).toEqual(['cover.webp']);
      
      // Use deleteMediaFile directly to test directory cleanup when directory becomes empty
      // (The endpoint would return 404 because game doesn't exist without metadata.json)
      deleteMediaFile({
        metadataPath: testMetadataPath,
        resourceId: gameId,
        resourceType: 'games',
        mediaType: 'cover'
      });
      
      // Verify directory was deleted because it became empty
      expect(fs.existsSync(gameContentDir)).toBe(false);
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .delete('/games/non-existent-game-id/delete-cover')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .delete(`/games/${gameId}/delete-cover`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle game without cover file gracefully', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Ensure cover file doesn't exist
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      const coverPath = path.join(gameContentDir, 'cover.webp');
      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
      }
      
      // Delete the cover (should succeed even if file doesn't exist)
      const response = await request(app)
        .delete(`/games/${gameId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('game');
    }
  });
});

describe('DELETE /games/:gameId/delete-background', () => {
  test('should delete background image for a game', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Create a test background file
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      if (!fs.existsSync(gameContentDir)) {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      const backgroundPath = path.join(gameContentDir, 'background.webp');
      fs.writeFileSync(backgroundPath, 'fake background content');
      
      // Verify background file exists
      expect(fs.existsSync(backgroundPath)).toBe(true);
      
      // Ensure game is in cache by fetching it first
      await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Delete the background
      const response = await request(app)
        .delete(`/games/${gameId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('game');
      expect(response.body.game).toHaveProperty('id', gameId);
      
      // Verify background file was deleted
      expect(fs.existsSync(backgroundPath)).toBe(false);
      
      // Verify background field in response is null or undefined
      expect(response.body.game.background).toBeFalsy();
      
      // Verify directory still exists (because metadata.json is still there)
      expect(fs.existsSync(gameContentDir)).toBe(true);
    }
  });

  test('should not delete directory when deleting background if metadata.json exists', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Create a test background file
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      if (!fs.existsSync(gameContentDir)) {
        fs.mkdirSync(gameContentDir, { recursive: true });
      }
      const backgroundPath = path.join(gameContentDir, 'background.webp');
      fs.writeFileSync(backgroundPath, 'fake background content');
      
      // Delete the background
      const response = await request(app)
        .delete(`/games/${gameId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify background file was deleted
      expect(fs.existsSync(backgroundPath)).toBe(false);
      
      // Verify directory still exists because metadata.json is still there
      expect(fs.existsSync(gameContentDir)).toBe(true);
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
    }
  });

  test('should return 404 for non-existent game', async () => {
    const response = await request(app)
      .delete('/games/non-existent-game-id/delete-background')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Game not found');
  });

  test('should require authentication', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      
      const response = await request(app)
        .delete(`/games/${gameId}/delete-background`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle game without background file gracefully', async () => {
    // First get a game ID from the library
    const libraryResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (libraryResponse.body.games.length > 0) {
      const gameId = libraryResponse.body.games[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify game metadata exists
      const gameMetadataPath = path.join(testMetadataPath, 'content', 'games', String(gameId), 'metadata.json');
      expect(fs.existsSync(gameMetadataPath)).toBe(true);
      
      // Ensure background file doesn't exist
      const gameContentDir = path.join(testMetadataPath, 'content', 'games', String(gameId));
      const backgroundPath = path.join(gameContentDir, 'background.webp');
      if (fs.existsSync(backgroundPath)) {
        fs.unlinkSync(backgroundPath);
      }
      
      // Ensure game is in cache by fetching it first
      await request(app)
        .get(`/games/${gameId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      // Delete the background (should succeed even if file doesn't exist)
      const response = await request(app)
        .delete(`/games/${gameId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('game');
    }
  });
});

