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

  test('should delete only metadata.json and remove directory only if empty', async () => {
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
      const metadataFile = path.join(collectionContentDir, 'metadata.json');
      if (!fs.existsSync(collectionContentDir)) {
        fs.mkdirSync(collectionContentDir, { recursive: true });
      }
      
      // Verify metadata.json exists before deletion
      expect(fs.existsSync(metadataFile)).toBe(true);
      
      // Delete the collection
      const response = await request(app)
        .delete(`/collections/${collectionId}`)
        .set('X-Auth-Token', 'test-token')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'success');
      
      // Verify metadata.json was deleted
      expect(fs.existsSync(metadataFile)).toBe(false);
      
      // If directory is empty, it should be removed
      // If directory has other files, it should remain
      if (fs.existsSync(collectionContentDir)) {
        const remainingFiles = fs.readdirSync(collectionContentDir);
        // Directory still exists because it has other files (not empty)
        expect(remainingFiles.length).toBeGreaterThan(0);
      } else {
        // Directory was removed because it was empty after metadata.json deletion
        expect(true).toBe(true);
      }
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

describe('PUT /collections/:id/games/order', () => {
  test('should remove duplicate game IDs', async () => {
    // First get some games from the library
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
      .send({ title: 'Test Collection for Duplicate Removal' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add game with duplicates (same ID multiple times)
    const gameIdsWithDuplicates = [gameId, gameId, gameId];
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: gameIdsWithDuplicates })
      .expect(200);
    
    // Verify only one game is in the collection
    const gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(1);
    expect(gamesResponseAfter.body.games[0].id).toBe(gameId);
    
    // Verify gameCount is 1
    const collectionsResponse = await request(app)
      .get('/collections')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    const collection = collectionsResponse.body.collections.find(c => c.id === collectionId);
    expect(collection).toBeDefined();
    expect(collection.gameCount).toBe(1);
  });

  test('should remove duplicate game IDs and sort by release date', async () => {
    // First get some games from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length < 2) {
      // Need at least 2 games for this test
      return;
    }
    
    const gameId1 = gamesResponse.body.games[0].id;
    const gameId2 = gamesResponse.body.games[1].id;
    
    // Create a collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Duplicate Order' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add games with duplicates (gameId1 appears twice, gameId2 appears once)
    const gameIdsWithDuplicates = [gameId1, gameId2, gameId1];
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: gameIdsWithDuplicates })
      .expect(200);
    
    // Verify duplicates are removed and games are sorted by release date
    const gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(2);
    // Verify both games are present (duplicates removed)
    const gameIds = gamesResponseAfter.body.games.map(g => g.id);
    expect(gameIds).toContain(gameId1);
    expect(gameIds).toContain(gameId2);
    // Verify games are sorted by release date (oldest first)
    const game1 = gamesResponse.body.games.find(g => g.id === gameId1);
    const game2 = gamesResponse.body.games.find(g => g.id === gameId2);
    if (game1 && game2 && game1.year && game2.year) {
      if (game1.year < game2.year || (game1.year === game2.year && (game1.month || 0) < (game2.month || 0))) {
        expect(gameIds[0]).toBe(gameId1);
        expect(gameIds[1]).toBe(gameId2);
      } else {
        expect(gameIds[0]).toBe(gameId2);
        expect(gameIds[1]).toBe(gameId1);
      }
    }
  });

  test('should require authentication', async () => {
    // First create a collection to get a valid ID
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Auth Games Order' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    const response = await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .send({ gameIds: [] })
      .expect(401);
    
    expect(response.body).toHaveProperty('error', 'Unauthorized');
  });

  test('should sort games by release date when adding multiple games', async () => {
    // First get some games from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length < 3) {
      // Need at least 3 games for this test
      return;
    }
    
    // Find games with different release dates
    const gamesWithDates = gamesResponse.body.games.filter(g => g.year);
    if (gamesWithDates.length < 3) {
      return; // Skip if not enough games with dates
    }
    
    // Sort games by release date to get expected order
    const sortedGames = [...gamesWithDates].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if ((a.month || 0) !== (b.month || 0)) return (a.month || 0) - (b.month || 0);
      return (a.day || 0) - (b.day || 0);
    });
    
    const gameId1 = sortedGames[0].id; // Oldest
    const gameId2 = sortedGames[1].id; // Middle
    const gameId3 = sortedGames[2].id; // Newest
    
    // Create a collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Release Date Sorting' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add games in reverse order (newest first)
    const gameIdsInReverseOrder = [gameId3, gameId1, gameId2];
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: gameIdsInReverseOrder })
      .expect(200);
    
    // Verify games are sorted by release date (oldest first)
    const gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(3);
    expect(gamesResponseAfter.body.games[0].id).toBe(gameId1); // Oldest first
    expect(gamesResponseAfter.body.games[1].id).toBe(gameId2); // Middle
    expect(gamesResponseAfter.body.games[2].id).toBe(gameId3); // Newest last
  });

  test('should insert new game in correct position when adding to existing collection', async () => {
    // First get some games from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length < 3) {
      // Need at least 3 games for this test
      return;
    }
    
    // Find games with different release dates
    const gamesWithDates = gamesResponse.body.games.filter(g => g.year);
    if (gamesWithDates.length < 3) {
      return; // Skip if not enough games with dates
    }
    
    // Sort games by release date to get expected order
    const sortedGames = [...gamesWithDates].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if ((a.month || 0) !== (b.month || 0)) return (a.month || 0) - (b.month || 0);
      return (a.day || 0) - (b.day || 0);
    });
    
    const gameId1 = sortedGames[0].id; // Oldest
    const gameId2 = sortedGames[1].id; // Middle
    const gameId3 = sortedGames[2].id; // Newest
    
    // Create a collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Insert Position' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // First add gameId1 and gameId3 (oldest and newest, skipping middle)
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [gameId1, gameId3] })
      .expect(200);
    
    // Verify initial order
    let gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(2);
    expect(gamesResponseAfter.body.games[0].id).toBe(gameId1); // Oldest first
    expect(gamesResponseAfter.body.games[1].id).toBe(gameId3); // Newest last
    
    // Now add gameId2 (middle) - it should be inserted between gameId1 and gameId3
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [gameId1, gameId3, gameId2] })
      .expect(200);
    
    // Verify gameId2 was inserted in the correct position
    gamesResponseAfter = await request(app)
      .get(`/collections/${collectionId}/games`)
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    expect(gamesResponseAfter.body.games.length).toBe(3);
    expect(gamesResponseAfter.body.games[0].id).toBe(gameId1); // Oldest first
    expect(gamesResponseAfter.body.games[1].id).toBe(gameId2); // Middle inserted correctly
    expect(gamesResponseAfter.body.games[2].id).toBe(gameId3); // Newest last
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

describe('removeGameFromAllCollections and createCacheUpdater', () => {
  test('should remove game from collections and update cache via callback', async () => {
    const collectionsRoutes = require('../../routes/collections');
    const { testMetadataPath } = require('../setup');
    const fs = require('fs');
    const path = require('path');
    
    // Get a real game ID from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length === 0) {
      return; // Skip test if no games available
    }
    
    const testGameId = gamesResponse.body.games[0].id;
    
    // First, remove the game from all existing collections to ensure clean state
    collectionsRoutes.removeGameFromAllCollections(testMetadataPath, testGameId);
    
    // Create a test collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection for Cache Update' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add the game to the collection via API
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [testGameId] })
      .expect(200);
    
    // Load collection metadata to get the actual structure
    const collectionMetadataPath = path.join(testMetadataPath, 'content', 'collections', String(collectionId), 'metadata.json');
    const collectionMetadata = JSON.parse(fs.readFileSync(collectionMetadataPath, 'utf8'));
    
    // Verify game is in collection before removal
    expect(collectionMetadata.games).toContain(testGameId);
    
    // Ensure the collection ID matches (normalize to same type)
    collectionMetadata.id = collectionId;
    
    // Create a mock cache with a copy of the collection
    const mockCache = [JSON.parse(JSON.stringify(collectionMetadata))];
    
    // Verify the collection is in the cache before removal
    expect(mockCache.length).toBe(1);
    expect(mockCache[0].games).toContain(testGameId);
    
    // Create cache updater
    const updateCache = collectionsRoutes.createCacheUpdater(mockCache);
    
    // Remove game from collections with callback
    const updatedCount = collectionsRoutes.removeGameFromAllCollections(
      testMetadataPath,
      testGameId,
      updateCache
    );
    
    // Verify game was removed from collection
    expect(updatedCount).toBeGreaterThanOrEqual(1);
    
    // Verify cache was updated (game should be removed from cache)
    const updatedCollection = mockCache.find(c => {
      // Handle both number and string IDs
      const cacheId = typeof c.id === 'number' ? c.id : Number(c.id);
      const targetId = typeof collectionId === 'number' ? collectionId : Number(collectionId);
      return !isNaN(cacheId) && !isNaN(targetId) && cacheId === targetId;
    });
    expect(updatedCollection).toBeDefined();
    expect(updatedCollection.games).not.toContain(testGameId);
    
    // Verify file was updated
    const updatedMetadata = JSON.parse(fs.readFileSync(collectionMetadataPath, 'utf8'));
    expect(updatedMetadata.games).not.toContain(testGameId);
  });

  test('should handle multiple collections with same game', async () => {
    const collectionsRoutes = require('../../routes/collections');
    const { testMetadataPath } = require('../setup');
    const fs = require('fs');
    const path = require('path');
    
    // Get a real game ID from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length === 0) {
      return; // Skip test if no games available
    }
    
    const testGameId = gamesResponse.body.games[0].id;
    
    // Create two test collections
    const createResponse1 = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection 1 for Multi' })
      .expect(200);
    
    const createResponse2 = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection 2 for Multi' })
      .expect(200);
    
    const collectionId1 = createResponse1.body.collection.id;
    const collectionId2 = createResponse2.body.collection.id;
    
    // Add the game to both collections via API
    await request(app)
      .put(`/collections/${collectionId1}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [testGameId] })
      .expect(200);
    
    await request(app)
      .put(`/collections/${collectionId2}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [testGameId] })
      .expect(200);
    
    // Load collection metadata to get the actual structure
    const collectionMetadataPath1 = path.join(testMetadataPath, 'content', 'collections', String(collectionId1), 'metadata.json');
    const collectionMetadataPath2 = path.join(testMetadataPath, 'content', 'collections', String(collectionId2), 'metadata.json');
    
    const collectionMetadata1 = JSON.parse(fs.readFileSync(collectionMetadataPath1, 'utf8'));
    const collectionMetadata2 = JSON.parse(fs.readFileSync(collectionMetadataPath2, 'utf8'));
    
    // Verify games are in collections before removal
    expect(collectionMetadata1.games).toContain(testGameId);
    expect(collectionMetadata2.games).toContain(testGameId);
    
    // Ensure the collection IDs match (normalize to same type)
    collectionMetadata1.id = collectionId1;
    collectionMetadata2.id = collectionId2;
    
    // Create a mock cache with copies of the collections
    const mockCache = [
      JSON.parse(JSON.stringify(collectionMetadata1)),
      JSON.parse(JSON.stringify(collectionMetadata2))
    ];
    
    // Verify the collections are in the cache before removal
    expect(mockCache.length).toBe(2);
    expect(mockCache[0].games).toContain(testGameId);
    expect(mockCache[1].games).toContain(testGameId);
    
    // Create cache updater
    const updateCache = collectionsRoutes.createCacheUpdater(mockCache);
    
    // Remove game from collections with callback
    const updatedCount = collectionsRoutes.removeGameFromAllCollections(
      testMetadataPath,
      testGameId,
      updateCache
    );
    
    // Verify game was removed from both collections
    expect(updatedCount).toBe(2);
    
    // Verify cache was updated for both collections
    const updatedCollection1 = mockCache.find(c => {
      const cacheId = typeof c.id === 'number' ? c.id : Number(c.id);
      const targetId = typeof collectionId1 === 'number' ? collectionId1 : Number(collectionId1);
      return !isNaN(cacheId) && !isNaN(targetId) && cacheId === targetId;
    });
    const updatedCollection2 = mockCache.find(c => {
      const cacheId = typeof c.id === 'number' ? c.id : Number(c.id);
      const targetId = typeof collectionId2 === 'number' ? collectionId2 : Number(collectionId2);
      return !isNaN(cacheId) && !isNaN(targetId) && cacheId === targetId;
    });
    
    expect(updatedCollection1).toBeDefined();
    expect(updatedCollection2).toBeDefined();
    expect(updatedCollection1.games).not.toContain(testGameId);
    expect(updatedCollection2.games).not.toContain(testGameId);
    
    // Verify files were updated
    const updatedMetadata1 = JSON.parse(fs.readFileSync(collectionMetadataPath1, 'utf8'));
    const updatedMetadata2 = JSON.parse(fs.readFileSync(collectionMetadataPath2, 'utf8'));
    
    expect(updatedMetadata1.games).not.toContain(testGameId);
    expect(updatedMetadata2.games).not.toContain(testGameId);
  });

  test('should work without callback (backward compatibility)', async () => {
    const collectionsRoutes = require('../../routes/collections');
    const { testMetadataPath } = require('../setup');
    const fs = require('fs');
    const path = require('path');
    
    // Get a real game ID from the library
    const gamesResponse = await request(app)
      .get('/libraries/library/games')
      .set('X-Auth-Token', 'test-token')
      .expect(200);
    
    if (gamesResponse.body.games.length === 0) {
      return; // Skip test if no games available
    }
    
    const testGameId = gamesResponse.body.games[0].id;
    
    // Create a test collection
    const createResponse = await request(app)
      .post('/collections')
      .set('X-Auth-Token', 'test-token')
      .send({ title: 'Test Collection No Callback' })
      .expect(200);
    
    const collectionId = createResponse.body.collection.id;
    
    // Add the game to the collection via API
    await request(app)
      .put(`/collections/${collectionId}/games/order`)
      .set('X-Auth-Token', 'test-token')
      .send({ gameIds: [testGameId] })
      .expect(200);
    
    // Remove game from collections without callback
    const updatedCount = collectionsRoutes.removeGameFromAllCollections(
      testMetadataPath,
      testGameId
    );
    
    // Verify game was removed from collection
    expect(updatedCount).toBe(1);
    
    // Verify file was updated
    const collectionMetadataPath = path.join(testMetadataPath, 'content', 'collections', String(collectionId), 'metadata.json');
    const updatedMetadata = JSON.parse(fs.readFileSync(collectionMetadataPath, 'utf8'));
    expect(updatedMetadata.games).not.toContain(testGameId);
  });
});
