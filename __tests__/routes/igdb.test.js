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

describe('GET /igdb/game-names-by-ids', () => {
  test('should return 400 if ids query is missing', async () => {
    const response = await request(app)
      .get('/igdb/game-names-by-ids')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'test-client-id')
      .set('X-Twitch-Client-Secret', 'test-client-secret')
      .expect(400);

    expect(response.body).toHaveProperty('error', 'Missing query parameter: ids (comma-separated IGDB game IDs)');
  });

  test('should return 200 with empty names and covers when ids parse to empty', async () => {
    // ids=invalid yields [] after parseInt/filter, so we return early without calling IGDB
    const response = await request(app)
      .get('/igdb/game-names-by-ids?ids=invalid,notanumber')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'test-client-id')
      .set('X-Twitch-Client-Secret', 'test-client-secret')
      .expect(200);

    expect(response.body).toHaveProperty('names');
    expect(response.body.names).toEqual({});
    expect(response.body).toHaveProperty('covers');
    expect(response.body.covers).toEqual({});
  });

  test('should return 400 if more than 500 ids', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1).join(',');
    const response = await request(app)
      .get(`/igdb/game-names-by-ids?ids=${ids}`)
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'test-client-id')
      .set('X-Twitch-Client-Secret', 'test-client-secret')
      .expect(400);

    expect(response.body).toHaveProperty('error', 'At most 500 ids allowed');
  });

  test('should return 400 if Twitch credentials are missing', async () => {
    const response = await request(app)
      .get('/igdb/game-names-by-ids?ids=1,2,3')
      .set('X-Auth-Token', 'test-token')
      .expect(400);

    expect(response.body).toHaveProperty('error', 'Twitch Client ID and Client Secret are required (X-Twitch-Client-Id, X-Twitch-Client-Secret).');
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/igdb/game-names-by-ids?ids=1,2,3')
      .set('X-Twitch-Client-Id', 'test-client-id')
      .set('X-Twitch-Client-Secret', 'test-client-secret')
      .expect(401);

    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
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

describe('GET /igdb/games-by-genre/:tagId', () => {
  test('should return 400 for invalid tag ID', async () => {
    const response = await request(app)
      .get('/igdb/games-by-genre/0')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Invalid tag ID');
  });

  test('should require authentication', async () => {
    await request(app)
      .get('/igdb/games-by-genre/1')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(401);
  });

  test('should return 400 if Twitch credentials are missing', async () => {
    const response = await request(app)
      .get('/igdb/games-by-genre/1')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Twitch Client ID and Client Secret are required');
  });
});

describe('POST /igdb/games-by-genre-by-name', () => {
  test('should return 400 if name is missing', async () => {
    const response = await request(app)
      .post('/igdb/games-by-genre-by-name')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({})
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Tag name is required');
  });

  test('should require authentication', async () => {
    await request(app)
      .post('/igdb/games-by-genre-by-name')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({ name: 'RPG' })
      .expect(401);
  });
});

describe('GET /igdb/games-by-developer/:companyId', () => {
  test('should return 400 for invalid company ID', async () => {
    const response = await request(app)
      .get('/igdb/games-by-developer/0')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Invalid company ID');
  });

  test('should require authentication', async () => {
    await request(app)
      .get('/igdb/games-by-developer/1')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(401);
  });

  test('should return 400 if Twitch credentials are missing', async () => {
    const response = await request(app)
      .get('/igdb/games-by-developer/1')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Twitch Client ID and Client Secret are required');
  });
});

describe('POST /igdb/games-by-developer-by-name', () => {
  test('should return 400 if name is missing', async () => {
    const response = await request(app)
      .post('/igdb/games-by-developer-by-name')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({})
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Company name is required');
  });

  test('should require authentication', async () => {
    await request(app)
      .post('/igdb/games-by-developer-by-name')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({ name: 'Nintendo' })
      .expect(401);
  });
});

describe('GET /igdb/games-by-publisher/:companyId', () => {
  test('should return 400 for invalid company ID', async () => {
    const response = await request(app)
      .get('/igdb/games-by-publisher/invalid')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Invalid company ID');
  });

  test('should require authentication', async () => {
    await request(app)
      .get('/igdb/games-by-publisher/1')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .expect(401);
  });

  test('should return 400 if Twitch credentials are missing', async () => {
    const response = await request(app)
      .get('/igdb/games-by-publisher/1')
      .set('X-Auth-Token', 'test-token')
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Twitch Client ID and Client Secret are required');
  });
});

describe('POST /igdb/games-by-publisher-by-name', () => {
  test('should return 400 if name is missing', async () => {
    const response = await request(app)
      .post('/igdb/games-by-publisher-by-name')
      .set('X-Auth-Token', 'test-token')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({})
      .expect(400);
    expect(response.body).toHaveProperty('error', 'Company name is required');
  });

  test('should require authentication', async () => {
    await request(app)
      .post('/igdb/games-by-publisher-by-name')
      .set('X-Twitch-Client-Id', 'id')
      .set('X-Twitch-Client-Secret', 'secret')
      .send({ name: 'Nintendo' })
      .expect(401);
  });
});

