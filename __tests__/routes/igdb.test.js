// __tests__/routes/igdb.test.js
// Tests for IGDB API routes

const request = require('supertest');

// Import setup first to set environment variables
const { testMetadataPath } = require('../setup');

// Import server after setting up environment
let app;

beforeAll(() => {
  // Clear module cache to ensure fresh server instance
  delete require.cache[require.resolve('../../server.js')];
  
  // Clear IGDB credentials for tests (we're not testing actual IGDB API calls)
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  
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

describe('GET /igdb/search', () => {
  test('should return 400 if query is missing', async () => {
    const response = await request(app)
      .get('/igdb/search')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Missing search query');
  });

  test('should return 400 if query is empty', async () => {
    const response = await request(app)
      .get('/igdb/search?q=')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Missing search query');
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/igdb/search?q=test')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  // Note: Full IGDB integration tests would require mocking HTTP requests
  // This is left as a placeholder for future implementation
});

describe('GET /igdb/game/:igdbId', () => {
  test('should return 400 for invalid IGDB game ID', async () => {
    const response = await request(app)
      .get('/igdb/game/invalid-id')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Invalid IGDB game ID');
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/igdb/game/12345')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  // Note: Full IGDB integration tests would require mocking HTTP requests
  // This is left as a placeholder for future implementation
});

