const https = require('https');
const fs = require('fs');

/**
 * HTTP utility functions
 */

/**
 * Download an image from a URL and save it to a file path
 * @param {string} imageUrl - URL of the image to download
 * @param {string} filePath - Local file path where to save the image
 * @param {string} resourceId - ID of the resource (game, collection, etc.) for logging
 * @param {string} imageType - Type of image (e.g., "cover", "background") for logging
 * @returns {Promise<boolean>} - True if download succeeded, false otherwise
 */
function downloadImage(imageUrl, filePath, resourceId, imageType = "image") {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      resolve(false);
      return;
    }

    try {
      const file = fs.createWriteStream(filePath);
      let requestCompleted = false;
      
      const cleanup = () => {
        if (!requestCompleted) {
          requestCompleted = true;
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        }
      };
      
      const req = https.get(imageUrl, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            if (!requestCompleted) {
              requestCompleted = true;
              resolve(true);
            }
          });
          file.on('error', (err) => {
            file.close();
            cleanup();
            console.warn(`Failed to save ${imageType} file for ${resourceId}:`, err.message);
            resolve(false);
          });
        } else {
          response.resume(); // Consume response to free up memory
          file.close();
          cleanup();
          resolve(false);
        }
      });
      
      req.on('error', (err) => {
        cleanup();
        console.warn(`Failed to download ${imageType} for ${resourceId}:`, err.message);
        resolve(false);
      });
      
      req.setTimeout(30000, () => {
        req.destroy();
        cleanup();
        console.warn(`Timeout downloading ${imageType} for ${resourceId}`);
        resolve(false);
      });
    } catch (error) {
      console.warn(`Failed to download ${imageType} for ${resourceId}:`, error.message);
      resolve(false);
    }
  });
}

module.exports = {
  downloadImage,
};

