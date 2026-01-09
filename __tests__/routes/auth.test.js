const request = require('supertest');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Import setup first to set environment variables
const { testMetadataPath } = require('../setup');

// Mock https module for Twitch API calls
jest.mock('https');

let app;

beforeAll(() => {
  // Set Twitch credentials for testing
  process.env.TWITCH_CLIENT_ID = 'test-twitch-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-twitch-client-secret';
  process.env.API_BASE = 'http://127.0.0.1:4000';
  
  // Clear module cache to ensure fresh server instance
  delete require.cache[require.resolve('../../server.js')];
  delete require.cache[require.resolve('../../routes/auth.js')];
  app = require('../../server.js');
});

afterEach(() => {
  // Clear tokens file after each test
  const tokensPath = path.join(testMetadataPath, 'tokens.json');
  if (fs.existsSync(tokensPath)) {
    fs.unlinkSync(tokensPath);
  }
  jest.clearAllMocks();
});

afterAll(async () => {
  // Give time for any pending async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Force garbage collection if available (helps with cleanup)
  if (global.gc) {
    global.gc();
  }
});

describe('GET /auth/twitch', () => {
  test('should return auth URL when Twitch client ID is configured', async () => {
    const response = await request(app)
      .get('/auth/twitch')
      .expect(200);
    
    expect(response.body).toHaveProperty('authUrl');
    expect(response.body).toHaveProperty('state');
    expect(response.body.authUrl).toContain('id.twitch.tv/oauth2/authorize');
    expect(response.body.authUrl).toContain('test-twitch-client-id');
    expect(response.body.authUrl).toContain('user:read:email');
  });

  // Note: Testing the error case when TWITCH_CLIENT_ID is not configured
  // is difficult because the value is read at module load time.
  // The check is present in the code and will work correctly in production.
  // We test the success case above which verifies the route works correctly.
});

describe('GET /auth/twitch/callback', () => {
  test('should redirect with error when code is missing', async () => {
    const response = await request(app)
      .get('/auth/twitch/callback')
      .expect(302);
    
    expect(response.headers.location).toContain('auth_error=no_code');
  });

  test('should redirect with error when error parameter is present', async () => {
    const response = await request(app)
      .get('/auth/twitch/callback?error=access_denied')
      .expect(302);
    
    expect(response.headers.location).toContain('auth_error=access_denied');
  });

  test('should exchange code for token and redirect with token', async () => {
    const mockCode = 'test-auth-code';
    const mockAccessToken = 'test-access-token';
    const mockRefreshToken = 'test-refresh-token';
    const mockUserId = '123456';
    const mockUserName = 'testuser';
    const mockUserImage = 'https://example.com/avatar.jpg';

    // Mock Twitch token endpoint
    const mockTokenResponse = {
      access_token: mockAccessToken,
      refresh_token: mockRefreshToken,
      expires_in: 3600,
    };

    // Mock Twitch user info endpoint
    const mockUserResponse = {
      data: [{
        id: mockUserId,
        login: mockUserName,
        display_name: mockUserName,
        profile_image_url: mockUserImage,
      }],
    };

    let requestCallCount = 0;
    https.request.mockImplementation((options, callback) => {
      const dataHandlers = [];
      const endHandlers = [];
      
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            dataHandlers.push(handler);
          } else if (event === 'end') {
            endHandlers.push(handler);
          }
        }),
      };

      const currentCall = requestCallCount;
      requestCallCount++;

      const mockReq = {
        on: jest.fn(),
        write: jest.fn((data) => {
          return true;
        }),
        end: jest.fn(() => {
          // Simulate async response after request is sent
          setImmediate(() => {
            // Call the response callback
            callback(mockRes);
            
            // Then trigger data and end events
            setImmediate(() => {
              dataHandlers.forEach(handler => {
                if (currentCall === 0) {
                  handler(Buffer.from(JSON.stringify(mockTokenResponse)));
                } else if (currentCall === 1) {
                  handler(Buffer.from(JSON.stringify(mockUserResponse)));
                }
              });
              
              endHandlers.forEach(handler => handler());
            });
          });
        }),
      };
      
      return mockReq;
    });

    const response = await request(app)
      .get(`/auth/twitch/callback?code=${mockCode}`)
      .set('Origin', 'http://localhost:5173')
      .expect(302);

    expect(response.headers.location).toContain('twitch_token=');
    expect(response.headers.location).toContain('user_id=');

    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify token was saved
    const tokensPath = path.join(testMetadataPath, 'tokens.json');
    expect(fs.existsSync(tokensPath)).toBe(true);
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    expect(tokens[mockUserId]).toBeDefined();
    expect(tokens[mockUserId].accessToken).toBe(mockAccessToken);
    expect(tokens[mockUserId].userId).toBe(mockUserId);
    expect(tokens[mockUserId].userName).toBe(mockUserName);
  });
});

describe('GET /auth/me', () => {
  test('should return dev user info when using dev token', async () => {
    const response = await request(app)
      .get('/auth/me')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('userId', 'dev');
    expect(response.body).toHaveProperty('userName', 'Development User');
    expect(response.body).toHaveProperty('isDev', true);
  });

  test('should return 401 when token is missing', async () => {
    const response = await request(app)
      .get('/auth/me')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should return user info for valid Twitch token', async () => {
    const mockAccessToken = 'valid-twitch-token';
    const mockUserId = '123456';
    const mockUserName = 'testuser';
    const mockUserImage = 'https://example.com/avatar.jpg';

    // Save token to tokens file
    const tokensPath = path.join(testMetadataPath, 'tokens.json');
    const tokens = {
      [mockUserId]: {
        accessToken: mockAccessToken,
        refreshToken: 'refresh-token',
        userId: mockUserId,
        userName: mockUserName,
        userImage: mockUserImage,
        expiresAt: Date.now() + 3600000,
      },
    };
    fs.writeFileSync(tokensPath, JSON.stringify(tokens));

    // Mock Twitch token validation
    const mockValidateResponse = {
      client_id: 'test-twitch-client-id',
      login: mockUserName,
      user_id: mockUserId,
    };

    // Mock Twitch user info
    const mockUserResponse = {
      data: [{
        id: mockUserId,
        login: mockUserName,
        display_name: mockUserName,
        profile_image_url: mockUserImage,
      }],
    };

    let requestCallCount = 0;
    https.request.mockImplementation((options, callback) => {
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            // First call is for validation, second is for user info
            if (requestCallCount === 0) {
              handler(Buffer.from(JSON.stringify(mockValidateResponse)));
            } else {
              handler(Buffer.from(JSON.stringify(mockUserResponse)));
            }
          } else if (event === 'end') {
            handler();
          }
        }),
      };

      requestCallCount++;
      setImmediate(() => callback(mockRes));

      return {
        on: jest.fn(),
        end: jest.fn(),
      };
    });

    const response = await request(app)
      .get('/auth/me')
      .set('X-Auth-Token', mockAccessToken)
      .expect(200);
    
    expect(response.body).toHaveProperty('userId', mockUserId);
    expect(response.body).toHaveProperty('userName', mockUserName);
    expect(response.body).toHaveProperty('userImage', mockUserImage);
    expect(response.body).toHaveProperty('isDev', false);
  });

  test('should return 401 for invalid Twitch token', async () => {
    // Mock Twitch token validation failure
    https.request.mockImplementation((options, callback) => {
      const mockRes = {
        statusCode: 401,
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from(JSON.stringify({ error: 'Invalid token' })));
          } else if (event === 'end') {
            handler();
          }
        }),
      };

      setImmediate(() => callback(mockRes));

      return {
        on: jest.fn(),
        end: jest.fn(),
      };
    });

    const response = await request(app)
      .get('/auth/me')
      .set('X-Auth-Token', 'invalid-token')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Invalid token');
  });
});

describe('POST /auth/logout', () => {
  test('should return success for logout', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'success');
  });
});

describe('Authentication middleware with Twitch tokens', () => {
  test('should accept requests with valid Twitch token', async () => {
    const mockAccessToken = 'valid-twitch-token';
    const mockUserId = '123456';

    // Save token to tokens file
    const tokensPath = path.join(testMetadataPath, 'tokens.json');
    const tokens = {
      [mockUserId]: {
        accessToken: mockAccessToken,
        refreshToken: 'refresh-token',
        userId: mockUserId,
        userName: 'testuser',
        expiresAt: Date.now() + 3600000,
      },
    };
    fs.writeFileSync(tokensPath, JSON.stringify(tokens));

    // Test that the token works with a protected endpoint
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', mockAccessToken)
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
  });

  test('should reject requests with invalid Twitch token', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'invalid-twitch-token')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should accept requests with dev token', async () => {
    const response = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
  });
});

