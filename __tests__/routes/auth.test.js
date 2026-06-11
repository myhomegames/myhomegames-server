const request = require('supertest');

const { testMetadataPath } = require('../setup');

let app;

beforeAll(() => {
  process.env.API_BASE = 'http://127.0.0.1:4000';
  delete require.cache[require.resolve('../../server.js')];
  delete require.cache[require.resolve('../../routes/auth.js')];
  app = require('../../server.js');
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (global.gc) global.gc();
});

describe('GET /auth/me', () => {
  test('should return dev user when API_TOKEN matches', async () => {
    const response = await request(app)
      .get('/auth/me')
      .set('X-Auth-Token', 'test-token')
      .expect(200);

    expect(response.body).toMatchObject({
      userId: 'dev',
      userName: 'Development User',
      isDev: true,
    });
  });

  test('should return 401 without token', async () => {
    const response = await request(app).get('/auth/me').expect(401);
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should return 401 for invalid token', async () => {
    const response = await request(app)
      .get('/auth/me')
      .set('X-Auth-Token', 'invalid-token')
      .expect(401);
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('POST /auth/logout', () => {
  test('should return success', async () => {
    const response = await request(app).post('/auth/logout').expect(200);
    expect(response.body).toHaveProperty('status', 'success');
  });
});
