# MyHomeGames Server

Express.js server for the MyHomeGames application.

## Installation

```bash
npm install
```

## Configuration

The server can be configured using environment variables. 

For development setup instructions, see [DEVELOPMENT.md](DEVELOPMENT.md).

### Production Setup

For production, copy `.env.production.example` to `.env`:

```bash
cp .env.production.example .env
```

Then edit `.env` and configure all required variables (Twitch OAuth credentials, API_BASE, etc.).

**Important**: Do not use `API_TOKEN` in production. Use Twitch OAuth instead.

### Environment Variables

- `PORT` (default: `4000`) - Port on which the server will listen
- `API_TOKEN` - Authentication token for API requests (development only, optional)
- `FRONTEND_URL` - Frontend application URL (optional, rarely needed)
  - **When is it needed?** Only when the `Origin` header is not available in OAuth callback requests
  - **Normal case:** The browser always sends the `Origin` header, so this is not needed
  - **When to use:** 
    - Testing OAuth with `curl` or Postman (which don't send `Origin`)
    - If a proxy/CDN filters or modifies the `Origin` header
    - In production, only if you have a specific infrastructure setup that requires it
  - **Fallback behavior:** If not set and `Origin` is missing, the server will attempt to derive the frontend URL from `API_BASE` (replacing port 4000 with 5173 for development)
- `API_BASE` - Base URL of the API server (used for OAuth redirects, required if using Twitch OAuth)
- **Note:** `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are no longer required in `.env`. They are now provided by users during login through the frontend.
- `METADATA_PATH` - Path where game metadata (covers, descriptions, etc.) are stored

### Metadata Path

The `METADATA_PATH` environment variable specifies the directory where all persistent data files are stored. This includes game metadata, cover images, settings, and game library data.

**Default value**: `$HOME/Library/Application Support/MyHomeGames`

**Example configuration in `.env` file**:
```
METADATA_PATH=/path/to/your/metadata
```

If `METADATA_PATH` is not set, the server will use the default path based on the user's home directory.

#### Directory Structure

The server expects the following directory structure under `METADATA_PATH`:

```
${METADATA_PATH}/
├── settings.json                    # Application settings (language, etc.)
└── content/                         # All content and metadata
    ├── games/
    │   └── ${gameId}/              # Per-game content directories
    │       ├── metadata.json       # Game metadata (without id field)
    │       ├── cover.webp          # Game cover image
    │       ├── background.webp     # Game background image
    │       └── script.sh           # Game launcher script (optional)
    ├── collections/
    │   └── ${collectionId}/        # Per-collection content directories
    │       ├── metadata.json       # Collection metadata (without id field)
    │       ├── cover.webp          # Collection cover image
    │       └── background.webp     # Collection background image
    ├── categories/
    │   └── ${categoryId}/          # Per-category content directories (numeric ID)
    │       ├── metadata.json       # Category metadata with title field
    │       └── cover.webp          # Category cover image (optional)
    └── recommended/
        └── ${sectionId}/           # Per-section content directories
            └── metadata.json       # Section metadata with games array (without id field)
```

#### Persistent Data Files

All JSON files and settings are stored outside the codebase in the metadata path. These files are not part of the repository and should be managed separately:

- **`settings.json`**: Application settings (language preference, etc.)
- **`content/games/${gameId}/metadata.json`**: Game metadata files. Each game has its own folder with a metadata.json file containing game properties like `title`, `summary`, `year`, `stars`, etc. (the `id` field is derived from the folder name).
- **`content/collections/${collectionId}/metadata.json`**: Collection metadata files. Each collection has its own folder with a metadata.json file containing collection properties like `title`, `summary`, `games` array, etc. (the `id` field is derived from the folder name).
- **`content/categories/${categoryId}/metadata.json`**: Category metadata files. Each category has its own folder (named with a numeric ID derived from the title) with a metadata.json file containing a `title` field.
- **`content/recommended/${sectionId}/metadata.json`**: Recommended section metadata files. Each section has its own folder with a metadata.json file containing a `games` array (the `id` field is derived from the folder name).

#### Initial Setup

On first run, you may need to create the metadata directory structure:

```bash
mkdir -p "${METADATA_PATH}/content/games"
mkdir -p "${METADATA_PATH}/content/collections"
mkdir -p "${METADATA_PATH}/content/categories"
mkdir -p "${METADATA_PATH}/content/recommended"
```

Then create the required JSON files or copy them from a backup. The server will create default settings if `settings.json` doesn't exist.

**Note**: If you're migrating from an older version, you'll need to migrate from the old monolithic JSON files (`games-library.json`, `games-collections.json`, etc.) to the new directory-per-item structure. Each game, collection, category, and recommended section should have its own directory under the appropriate `content/` subdirectory.

## Running the Server

For development mode instructions, see [DEVELOPMENT.md](DEVELOPMENT.md).

### Production Mode

```bash
npm start
```

## Testing

The server includes a comprehensive test suite using Jest and Supertest to ensure all functionality works correctly.

**Note**: Test files and dependencies are excluded from production deployments:
- Test files (`__tests__/`) are not included when publishing to npm (via `.npmignore`)
- Test dependencies (`jest`, `supertest`) are in `devDependencies` and won't be installed with `npm install --production`
- Tests are only needed during development and CI/CD pipelines

For running tests, see [DEVELOPMENT.md](DEVELOPMENT.md).

### Test Coverage

The test suite covers:
- **Authentication**: Token validation via headers, query parameters, and Authorization header
- **API Endpoints**: All GET, POST, and PUT endpoints
  - `/libraries` - Library listing
  - `/libraries/:id/games` - Game listing by library
  - `/covers/:gameId` - Cover image serving
  - `/launcher` - Game launching
  - `/reload-games` - Game reloading
  - `/settings` - Settings management
  - `/igdb/search` - IGDB game search
- **Helper Functions**: Game loading, settings reading, data structure validation

### Test Structure

Tests are organized in the `__tests__` directory. See [DEVELOPMENT.md](DEVELOPMENT.md) for details on running and writing tests.

## API Endpoints

- `GET /auth/twitch` - Initiate Twitch OAuth flow
- `GET /auth/twitch/callback` - Twitch OAuth callback
- `GET /auth/me` - Get current user information (requires authentication)
- `POST /auth/logout` - Logout (requires authentication)
- `GET /libraries` - Get list of game libraries (requires authentication)
- `GET /games/:library` - Get games for a specific library (requires authentication)
- `POST /launch/:gameId` - Launch a game (requires authentication)
- `GET /search` - Search games via IGDB API (requires authentication)
- `GET /covers/:gameId` - Get game cover image (public, no authentication required)

All authenticated endpoints require the `X-Auth-Token` header with a valid token.

## Authentication

The server supports two authentication methods:

For development authentication setup, see [DEVELOPMENT.md](DEVELOPMENT.md).

### Production Mode (Twitch OAuth)

For production, users authenticate via Twitch OAuth. To enable this:

1. Create a Twitch application at https://dev.twitch.tv/console/apps
2. Set the OAuth redirect URL to: `http://your-api-domain:4000/auth/twitch/callback`
3. Set environment variables:
   - `API_BASE` - Your API base URL (e.g., `https://api.example.com`)

**Note:** `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are no longer required in `.env`. Users provide these credentials through the login page in the frontend. The server does not store or require these credentials in environment variables.

Users will authenticate via Twitch, and their access tokens will be stored in `${METADATA_PATH}/tokens.json`.

### Authentication Endpoints

- `GET /auth/twitch` - Initiate Twitch OAuth flow (returns `authUrl`)
- `GET /auth/twitch/callback` - Twitch OAuth callback (handles redirect)
- `GET /auth/me` - Get current user information (requires valid token)
- `POST /auth/logout` - Logout (clears token on client side)

All authenticated endpoints require the `X-Auth-Token` header with either:
- The development token (value from `API_TOKEN` environment variable, if set)
- A valid Twitch OAuth access token

