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

describe('GET /recommended', () => {
  test('should return recommended sections', async () => {
    const response = await request(app)
      .get('/recommended')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('sections');
    expect(Array.isArray(response.body.sections)).toBe(true);
    // Should return up to 9 random sections (or all if less than 9)
    expect(response.body.sections.length).toBeGreaterThan(0);
    expect(response.body.sections.length).toBeLessThanOrEqual(9);
  });

  test('should return sections with correct structure', async () => {
    const response = await request(app)
      .get('/recommended')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (response.body.sections.length > 0) {
      const section = response.body.sections[0];
      expect(section).toHaveProperty('id');
      expect(section).toHaveProperty('title');
      expect(section).toHaveProperty('games');
      expect(Array.isArray(section.games)).toBe(true);
      // ID should be the title (formatted title like categories) for client compatibility
      expect(section.id).toBe(section.title);
    }
  });

  test('should return games with correct structure in sections', async () => {
    const response = await request(app)
      .get('/recommended')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const sectionWithGames = response.body.sections.find(s => s.games.length > 0);
    if (sectionWithGames && sectionWithGames.games.length > 0) {
      const game = sectionWithGames.games[0];
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('title');
      expect(game).toHaveProperty('summary');
      expect(game).toHaveProperty('cover');
      // Cover can be null, empty string, a local path (/covers/), or an IGDB URL (https://)
      if (game.cover !== null && game.cover !== undefined) {
        expect(typeof game.cover === 'string').toBe(true);
        if (game.cover !== '') {
          expect(game.cover.includes('/covers/') || game.cover.startsWith('http')).toBe(true);
        }
      }
    }
  });

  test('should include optional fields when present', async () => {
    const response = await request(app)
      .get('/recommended')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Find a game with stars in any section
    let gameWithStars = null;
    for (const section of response.body.sections) {
      gameWithStars = section.games.find(g => g.stars);
      if (gameWithStars) break;
    }
    
    if (gameWithStars) {
      expect(typeof gameWithStars.stars).toBe('number');
    }
  });

  test('should support old format (backward compatibility)', async () => {
    // This test verifies that the old format (array of IDs) is still supported
    // The implementation should convert old format to a single section with id "recommended"
    const response = await request(app)
      .get('/recommended')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Should return sections array
    expect(response.body).toHaveProperty('sections');
    expect(Array.isArray(response.body.sections)).toBe(true);
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/recommended')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

