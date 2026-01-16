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

describe('GET /collections', () => {
  test('should return list of collections', async () => {
    const response = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('collections');
    expect(Array.isArray(response.body.collections)).toBe(true);
  });

  test('should return collections with correct structure', async () => {
    const response = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (response.body.collections.length > 0) {
      const collection = response.body.collections[0];
      expect(collection).toHaveProperty('id');
      expect(collection).toHaveProperty('title');
      // cover is optional - only present if file exists
      if (collection.cover) {
        expect(collection.cover).toContain('/collection-covers/');
      }
    }
  });

  test('should require authentication', async () => {
    const response = await request(app)
      .get('/collections')
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('GET /collections/:id', () => {
  test('should return a single collection by ID', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .get(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('id', collectionId);
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('summary');
      // cover is optional - only present if file exists
      if (response.body.cover) {
        expect(response.body.cover).toContain('/collection-covers/');
      }
    }
  });

  test('should return collection with correct structure', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .get(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      const collection = response.body;
      expect(collection).toHaveProperty('id');
      expect(collection).toHaveProperty('title');
      expect(collection).toHaveProperty('summary');
      // cover is optional - only present if file exists
      if (collection.cover) {
        expect(collection.cover).toContain('/collection-covers/');
      }
      expect(collection).toHaveProperty('gameCount');
      expect(typeof collection.gameCount).toBe('number');
    }
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .get('/collections/non-existent-collection-id')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .get(`/collections/${collectionId}`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle URL-encoded collection IDs', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const encodedCollectionId = encodeURIComponent(collectionId);
      
      const response = await request(app)
        .get(`/collections/${encodedCollectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('id', collectionId);
    }
  });
});

describe('GET /collections/:id/games', () => {
  test('should return games for a valid collection', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Games' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(response.body).toHaveProperty('games');
    expect(Array.isArray(response.body.games)).toBe(true);
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .get('/collections/nonexistent/games')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should return games with correct structure', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Games Structure' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .get(`/collections/${collectionId}/games`)
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

  test('should require authentication', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Auth Games' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .get(`/collections/${collectionId}/games`)
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });
});

describe('PUT /collections/:id', () => {
  test('should update a single field', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Update' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Updated Title' })
      .expect(200);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.collection).toHaveProperty('id', collectionId);
    expect(response.body.collection).toHaveProperty('title', 'Updated Title');
  });

  test('should update multiple fields', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Multiple Update' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const updates = { title: 'Updated Title', summary: 'Updated Summary' };
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .set('X-Auth-Token', 'test-token')
      .send(updates)
      .expect(200);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.collection).toHaveProperty('id', collectionId);
    expect(response.body.collection).toHaveProperty('title', 'Updated Title');
    expect(response.body.collection).toHaveProperty('summary', 'Updated Summary');
  });

  test('should ignore non-allowed fields', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Ignore Fields' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const updates = { title: 'New Title', unknownField: 'value' };
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .set('X-Auth-Token', 'test-token')
      .send(updates)
      .expect(200);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.collection).toHaveProperty('title', 'New Title');
    expect(response.body.collection).not.toHaveProperty('unknownField');
  });

  test('should return 400 when no valid fields provided', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for 400' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .set('X-Auth-Token', 'test-token')
      .send({ unknownField: 'value' })
      .expect(400);

    expect(response.body).toHaveProperty('error', 'No valid fields to update');
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .put('/collections/non-existent-collection-id')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'New Title' })
      .expect(404);

    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Auth' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .send({ title: 'New Title' })
      .expect(401);

    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should return updated collection data', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Updated Data' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .put(`/collections/${collectionId}`)
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Updated Title' })
      .expect(200);

    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.collection).toHaveProperty('title', 'Updated Title');
    expect(response.body.collection).toHaveProperty('gameCount');
  });
});

describe('DELETE /collections/:id', () => {
  test('should delete a collection', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      // Delete the collection
      const deleteResponse = await request(app)
        .delete(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(deleteResponse.body).toHaveProperty('status', 'success');
      
      // Verify collection is deleted by trying to get it
      const getResponse = await request(app)
        .get(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(404);
      
      expect(getResponse.body).toHaveProperty('error', 'Collection not found');
    }
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .delete('/collections/non-existent-collection-id')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .delete(`/collections/${collectionId}`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should delete collection content directory when deleting collection', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Create a test content directory for the collection
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      
      // Create a test file in the directory
      const testFile = path.join(collectionContentDir, 'test.txt');
      fs.writeFileSync(testFile, 'test content');
      
      // Verify the directory exists before deletion
      expect(fs.existsSync(collectionContentDir)).toBe(true);
      
      // Delete the collection
      const response = await request(app)
        .delete(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify the directory was deleted (along with the collection)
      expect(fs.existsSync(collectionContentDir)).toBe(false);
    }
  });

  test('should handle URL-encoded collection IDs', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const encodedCollectionId = encodeURIComponent(collectionId);
      
      // Delete the collection
      const deleteResponse = await request(app)
        .delete(`/collections/${encodedCollectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(deleteResponse.body).toHaveProperty('status', 'success');
    }
  });
});

describe('POST /collections/:id/reload', () => {
  test('should reload metadata for a single collection', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .post(`/collections/${collectionId}/reload`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'reloaded');
      expect(response.body).toHaveProperty('collection');
      expect(response.body.collection).toHaveProperty('id', collectionId);
      expect(response.body.collection).toHaveProperty('title');
      expect(response.body.collection).toHaveProperty('summary');
      expect(response.body.collection).toHaveProperty('cover');
    }
  });

  test('should return collection with correct structure after reload', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .post(`/collections/${collectionId}/reload`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      const collection = response.body.collection;
      expect(collection).toHaveProperty('id');
      expect(collection).toHaveProperty('title');
      expect(collection).toHaveProperty('summary');
      expect(collection).toHaveProperty('cover');
      expect(collection.cover).toContain('/collection-covers/');
    }
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .post('/collections/non-existent-collection-id/reload')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .post(`/collections/${collectionId}/reload`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });
});

describe('DELETE /collections/:id/delete-cover', () => {
  test('should delete cover image for a collection', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Create a test cover file
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      const coverPath = path.join(collectionContentDir, 'cover.webp');
      fs.writeFileSync(coverPath, 'fake cover content');
      
      // Verify cover file exists
      expect(fs.existsSync(coverPath)).toBe(true);
      
      // Delete the cover
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('collection');
      expect(response.body.collection).toHaveProperty('id', collectionId);
      
      // Verify cover file was deleted
      expect(fs.existsSync(coverPath)).toBe(false);
      
      // Verify cover field in response is null or undefined
      expect(response.body.collection.cover).toBeFalsy();
      
      // Verify directory still exists (because metadata.json is still there)
      expect(fs.existsSync(collectionContentDir)).toBe(true);
    }
  });

  test('should not delete directory when deleting cover if metadata.json exists', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify collection metadata exists
      const collectionMetadataPath = path.join(testMetadataPath, 'content', 'collections', String(collectionId), 'metadata.json');
      expect(fs.existsSync(collectionMetadataPath)).toBe(true);
      
      // Create a test cover file
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      const coverPath = path.join(collectionContentDir, 'cover.webp');
      fs.writeFileSync(coverPath, 'fake cover content');
      
      // Delete the cover
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify cover file was deleted
      expect(fs.existsSync(coverPath)).toBe(false);
      
      // Verify directory still exists because metadata.json is still there
      expect(fs.existsSync(collectionContentDir)).toBe(true);
      expect(fs.existsSync(collectionMetadataPath)).toBe(true);
    }
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .delete('/collections/non-existent-collection-id/delete-cover')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-cover`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle collection without cover file gracefully', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Ensure cover file doesn't exist
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      const coverPath = path.join(collectionContentDir, 'cover.webp');
      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
      }
      
      // Delete the cover (should succeed even if file doesn't exist)
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-cover`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('collection');
    }
  });
});

describe('DELETE /collections/:id/delete-background', () => {
  test('should delete background image for a collection', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Create a test background file
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      const backgroundPath = path.join(collectionContentDir, 'background.webp');
      fs.writeFileSync(backgroundPath, 'fake background content');
      
      // Verify background file exists
      expect(fs.existsSync(backgroundPath)).toBe(true);
      
      // Delete the background
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('collection');
      expect(response.body.collection).toHaveProperty('id', collectionId);
      
      // Verify background file was deleted
      expect(fs.existsSync(backgroundPath)).toBe(false);
      
      // Verify background field in response is null or undefined
      expect(response.body.collection.background).toBeFalsy();
      
      // Verify directory still exists (because metadata.json is still there)
      expect(fs.existsSync(collectionContentDir)).toBe(true);
    }
  });

  test('should not delete directory when deleting background if metadata.json exists', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Verify collection metadata exists
      const collectionMetadataPath = path.join(testMetadataPath, 'content', 'collections', String(collectionId), 'metadata.json');
      expect(fs.existsSync(collectionMetadataPath)).toBe(true);
      
      // Create a test background file
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      const backgroundPath = path.join(collectionContentDir, 'background.webp');
      fs.writeFileSync(backgroundPath, 'fake background content');
      
      // Delete the background
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify background file was deleted
      expect(fs.existsSync(backgroundPath)).toBe(false);
      
      // Verify directory still exists because metadata.json is still there
      expect(fs.existsSync(collectionContentDir)).toBe(true);
      expect(fs.existsSync(collectionMetadataPath)).toBe(true);
    }
  });

  test('should return 404 for non-existent collection', async () => {
    const response = await request(app)
      .delete('/collections/non-existent-collection-id/delete-background')
      .set('X-Auth-Token', 'test-token')
      .expect(404);
    
    expect(response.body).toHaveProperty('error', 'Collection not found');
  });

  test('should require authentication', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-background`)
        .expect(401);
      
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    }
  });

  test('should handle collection without background file gracefully', async () => {
    // First get a collection ID from the list
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (collectionsResponse.body.collections.length > 0) {
      const collectionId = collectionsResponse.body.collections[0].id;
      const { testMetadataPath } = require('../setup');
      const fs = require('fs');
      const path = require('path');
      
      // Ensure background file doesn't exist
      const collectionContentDir = path.join(testMetadataPath, 'content', 'collections', String(collectionId));
      const backgroundPath = path.join(collectionContentDir, 'background.webp');
      if (fs.existsSync(backgroundPath)) {
        fs.unlinkSync(backgroundPath);
      }
      
      // Delete the background (should succeed even if file doesn't exist)
      const response = await request(app)
        .delete(`/collections/${collectionId}/delete-background`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('collection');
    }
  });
});

describe('GameCount calculation', () => {
  test('should calculate gameCount correctly excluding deleted games', async () => {
    // First get some games from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length < 2) {
      // Need at least 2 games for this test
      return;
    }
    
    const games = gamesResponse.body.games;
    const gameIds = [games[0].id, games[1].id];
    
    // Create a collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for GameCount' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add games to the collection
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds })
      .expect(200);
    
    // Verify gameCount is 2
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const collection = collectionsResponse.body.collections.find(c => c.id === collectionId);
    expect(collection).toBeDefined();
    expect(collection.gameCount).toBe(2);
    
    // Delete one of the games
    await request(app)
      .delete(`/games/${gameIds[0]}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Verify gameCount is now 1 (excludes deleted game)
    const collectionsResponseAfter = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const collectionAfter = collectionsResponseAfter.body.collections.find(c => c.id === collectionId);
    expect(collectionAfter).toBeDefined();
    expect(collectionAfter.gameCount).toBe(1);
    
    // Verify that the remaining game is the one that wasn't deleted
    const gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(1);
    expect(gamesResponseAfter.body.games[0].id).toBe(gameIds[1]);
  });
  
  test('should calculate gameCount as 0 when all games are deleted', async () => {
    // First get a game from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length < 1) {
      // Need at least 1 game for this test
      return;
    }
    
    const gameId = gamesResponse.body.games[0].id;
    
    // Create a collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Empty GameCount' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add game to the collection
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [gameId] })
      .expect(200);
    
    // Verify gameCount is 1
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const collection = collectionsResponse.body.collections.find(c => c.id === collectionId);
    expect(collection).toBeDefined();
    expect(collection.gameCount).toBe(1);
    
    // Delete the game
    await request(app)
      .delete(`/games/${gameId}`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    // Verify gameCount is now 0
    const collectionsResponseAfter = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const collectionAfter = collectionsResponseAfter.body.collections.find(c => c.id === collectionId);
    expect(collectionAfter).toBeDefined();
    expect(collectionAfter.gameCount).toBe(0);
    
    // Verify that no games are returned
    const gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(0);
  });
});
