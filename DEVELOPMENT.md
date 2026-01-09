# Development Setup Guide - Server

This guide covers the development environment setup for MyHomeGames Server.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. The `.env` file contains `API_TOKEN=changeme` for development authentication.

4. Start the development server:
   ```bash
   npm run dev
   ```

   This uses `nodemon` to automatically restart the server when files change.

The server will be available at `http://127.0.0.1:4000` (or the port specified in `.env`).

## Running with HTTPS

For HTTPS support, the server can run both HTTP and HTTPS simultaneously.

### SSL Certificates

**Automatic Certificate Generation**: SSL certificates are automatically generated in the `metadata_path/certs/` directory on first startup when HTTPS is enabled. The server will create self-signed certificates (`key.pem` and `cert.pem`) if they don't already exist.

**Manual Certificate Generation** (optional): If you need to manually generate certificates, you can do so:

```bash
# In metadata_path/certs/ (default: ~/Library/Application Support/MyHomeGames/certs/)
mkdir -p "${METADATA_PATH}/certs"
openssl genrsa -out "${METADATA_PATH}/certs/key.pem" 2048
openssl req -new -x509 -key "${METADATA_PATH}/certs/key.pem" -out "${METADATA_PATH}/certs/cert.pem" -days 365 -subj "/CN=localhost"
```

**Note**: These are self-signed certificates. Browsers will show a security warning when accessing the site. For production/public access, use proper SSL certificates or a service like Cloudflare Tunnel.

### Configure Server for HTTPS

Add the following to your `.env` file:

```env
# HTTP server (always available)
HTTP_PORT=4000

# HTTPS server (optional)
HTTPS_ENABLED=true
HTTPS_PORT=41440
```

**Note**: Certificates are automatically generated in `metadata_path/certs/` on first startup. No additional configuration needed.

### Start the Server

Start the server as usual:

```bash
npm run dev
```

The server will start:
- **HTTP**: `http://localhost:4000` (always available)
- **HTTPS**: `https://localhost:41440` (if `HTTPS_ENABLED=true`)

**Important**: HTTPS in development is optional. The server always provides HTTP access. Use HTTPS only when testing features that require it (like Twitch OAuth callbacks in some scenarios).

## Development Configuration

### Environment Variables

For development, the server uses the following environment variables:

- `PORT` (default: `4000`) - Port on which the server will listen (used for HTTP if `HTTP_PORT` is not set)
- `HTTP_PORT` (default: `PORT` or `4000`) - Port for HTTP server (always available)
- `HTTPS_ENABLED` (default: `false`) - Enable HTTPS server (`true`/`false`)
  - When `true`, the server will also listen on HTTPS port
  - Certificates are automatically generated in `metadata_path/certs/` on first startup
  - **Development only**: Uses self-signed certificates (browsers will show security warnings)
  - **Production**: HTTPS is handled by your hosting provider/reverse proxy
- `HTTPS_PORT` (default: `41440`) - Port for HTTPS server (only if `HTTPS_ENABLED=true`)
- `API_TOKEN` - Authentication token for API requests (development only, optional)
  - Default: `changeme` (from `.env.example`)
  - Used for quick testing without setting up Twitch OAuth
- `API_BASE` - Base URL of the API server (optional for development)
- `METADATA_PATH` - Path where game metadata are stored
  - Default: `$HOME/Library/Application Support/MyHomeGames`

## Development Authentication

In development mode, you can use the `API_TOKEN` environment variable for quick testing without setting up Twitch OAuth.

Set `API_TOKEN` in your `.env` file:
```bash
API_TOKEN=changeme
API_BASE=http://127.0.0.1:4000
```

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch
```

The test suite covers:
- Authentication endpoints
- API endpoints (GET, POST, PUT)
- Helper functions
- Game loading and settings management

## Troubleshooting

### Server won't start
- Check that port 4000 is available
- Verify `.env` file exists and contains required variables
- Check console for error messages

### Authentication issues
- Verify `API_TOKEN` is set correctly in `.env` (if using development token)
- Check that Twitch OAuth is properly configured (for production)
- Review server logs for authentication errors

### HTTPS issues
- **HTTPS server not starting**: Check that `HTTPS_ENABLED=true` in `.env`
- **Browser security warning**: This is normal with self-signed certificates. Accept the exception or use `mkcert` for trusted certificates
- **Port conflicts**: Ensure ports 4000 (HTTP) and 41440 (HTTPS) are available, or change them via `HTTP_PORT` and `HTTPS_PORT`

## Creating Releases

The project uses `release-it` to automate GitHub releases. To create a release:

```bash
npm run release
```

This will:
1. Build the macOS `.app` bundle and `.pkg` installer
2. Create a Git tag with the current version
3. Create a GitHub release with the changelog
4. Attach the `.pkg` installer as a release asset

### GitHub Token Configuration

`release-it` requires a GitHub Personal Access Token to create releases automatically. Without it, you'll need to create the release manually through the web interface.

To configure the token:

1. **Create a GitHub Personal Access Token:**
   - Go to https://github.com/settings/tokens
   - Click "Generate new token" → "Generate new token (classic)"
   - Give it a name (e.g., "release-it")
   - Select the `repo` scope (required for creating releases and tags)
   - Click "Generate token" and copy the token

2. **Set the token as an environment variable:**
   
   **Option 1: Export in your shell (temporary):**
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```
   
   **Option 2: Add to `.env` file (persistent):**
   ```bash
   echo "GITHUB_TOKEN=ghp_your_token_here" >> .env
   ```
   
   **Option 3: Use a `.env.local` file (not committed to Git):**
   ```bash
   echo "GITHUB_TOKEN=ghp_your_token_here" >> .env.local
   ```

**Security Note:** Never commit your `GITHUB_TOKEN` to the repository. The `.gitignore` file already excludes `.env.local` and `.env.*.local` files.
