# MyHomeGames Server

Express.js server for the MyHomeGames application.

## Installation

```bash
npm install
```

## First Time Setup (For End Users)

If you've installed MyHomeGames from the `.pkg` installer, follow these steps to get started:

### 1. Start the Application

Launch the MyHomeGames application from your Applications folder. The server will automatically start and generate SSL certificates on first run.

### 2. Accept the SSL Certificate

When you first access the web interface, your browser will show a security warning because the application uses a self-signed SSL certificate. This is normal and safe for local use.

**To fix this:**

1. Open your browser and navigate to `https://localhost:41440`
2. You'll see a security warning (e.g., "Your connection is not private" or "ERR_CERT_AUTHORITY_INVALID")
3. Click **"Advanced"** or **"Show Details"**
4. Click **"Proceed to localhost"** or **"Accept the Risk and Continue"**

After accepting the certificate, the browser will trust it and you can use the application normally.

**Note:** You only need to do this once per browser. The certificate will be trusted for future sessions.

### 3. Alternative: Use Trusted Certificates (Optional)

If you want to avoid the security warning, you can use `mkcert` to generate trusted certificates:

```bash
# Install mkcert (macOS)
brew install mkcert
mkcert -install

# Generate trusted certificates
cd ~/Library/Application\ Support/MyHomeGames/certs
mkcert localhost 127.0.0.1
mv localhost+1.pem cert.pem
mv localhost+1-key.pem key.pem
```

Then restart the MyHomeGames application. With `mkcert`, certificates are trusted by your system and no warnings will appear.

## Configuration

The server can be configured using environment variables. 

For development setup instructions, see [DEVELOPMENT.md](DEVELOPMENT.md).

### Production Setup

For production, copy `.env.production.example` to `.env`:

```bash
cp .env.production.example .env
```

Then edit `.env` and configure required variables (e.g. `API_BASE`, `METADATA_PATH`).

MyHomeGames uses the IGDB API (via Twitch Developer Services) solely to enrich the user’s personal library experience. Data is cached locally for personal use and not redistributed as a public API or dataset. See [docs/IGDB.md](docs/IGDB.md) for automatic (proxy) vs manual Twitch Developer Console setup.

**Important**: Do not use `API_TOKEN` in production.

### Environment Variables

- `PORT` (default: `4000`) - Port on which the server will listen
- `API_TOKEN` - Optional dev token for `GET /auth/me` (development only)
- `FRONTEND_URL` - Frontend application URL (optional, rarely needed)
  - **When is it needed?** Only when the `Origin` header is not available in requests
  - **Normal case:** The browser always sends the `Origin` header, so this is not needed
  - **When to use:** 
    - Testing with `curl` or Postman (which don't send `Origin`)
    - If a proxy/CDN filters or modifies the `Origin` header
  - **Fallback behavior:** If not set and `Origin` is missing, the server will attempt to derive the frontend URL from `API_BASE` (replacing port 4000 with 5173 for development)
- `COVER_TAG_URL` - Base URL used for tag cover failover redirects (optional)
  - Used by tag cover endpoint (`/:tagId/cover.webp`) when no local `cover.webp` exists
  - Example: `https://myhomegames.vige.it` (without `/app`)
- `API_BASE` - Base URL of the API server (public hostname when using Cloudflare Tunnel)
- `CLOUDFLARE_TUNNEL_ENABLED` - Enable automatic `cloudflared` tunnel (see [DEVELOPMENT.md](DEVELOPMENT.md#cloudflare-tunnel-public-https-without-local-certificates))
- `CLOUDFLARED_VERSION` - Pin Cloudflare CLI release (e.g. `2026.6.1`); unset = auto-update to latest on tunnel start
- `CLOUDFLARED_SKIP_UPDATE` - Set to `true` to download the binary only when missing (skip version checks)
- `CLOUDFLARED_BIN` - Optional path to an external `cloudflared` executable (advanced; default is `METADATA_PATH/bin/cloudflared`)
- `METADATA_PATH` - Path where game metadata (covers, descriptions, etc.) are stored
- `DEFAULT_SKIN_URL` (optional) - URL of the default skin archive on first startup when no skins are present (default: `plex-<version>.mhg-skin.zip` from the **latest** [myhomegames-skins](https://github.com/myhomegames/myhomegames-skins/releases) GitHub release)
- `MHG_SKINS_GITHUB_REPO` (optional) - `owner/repo` for that lookup (default: `myhomegames/myhomegames-skins`)

### Metadata Path

The `METADATA_PATH` environment variable specifies the directory where all persistent data files are stored. This includes game metadata, cover images, settings, and game library data.

**Default values** (when `METADATA_PATH` is unset):

- **macOS**: `~/Library/Application Support/MyHomeGames`
- **Windows**: `%APPDATA%\MyHomeGames` (e.g. `C:\Users\<you>\AppData\Roaming\MyHomeGames`)
- **Linux**: `$XDG_DATA_HOME/MyHomeGames` or `~/.local/share/MyHomeGames`

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
├── bin/
│   └── cloudflared                  # Cloudflare tunnel CLI (downloaded/updated automatically)
├── tokens/
│   └── cloudflare-tunnel-run.json   # Per-user tunnel run token (when using Cloudflare Tunnel)
├── skins/                           # Web UI themes (zip-installed or manual)
│   └── ${uuid}/                     # id folder name is the skin id
│       ├── skin.json                # { "name", "web": { persistentLibraryShell, collectionsShortcutList, libraryPagesVerticalList, headerTitleFilter, disableAlphabetNavigator } }
│       └── bundle.css               # Full theme CSS (or multiple .css files; see SKINS.md in myhomegames-skins)
└── content/                         # Game and library content metadata
    ├── games/
    │   └── ${gameId}/              # Per-game content directories
    │       ├── metadata.json       # Game metadata (without id field)
    │       ├── cover.webp          # Game cover image
    │       ├── background.webp     # Game background image
    │       └── scripts/            # Executable scripts (.sh / .bat)
    │           └── *.sh, *.bat     # Game launcher script(s) (optional)
    ├── collections/
    │   └── ${collectionId}/        # Per-collection content directories
    │       ├── metadata.json       # Collection metadata (without id field)
    │       ├── cover.webp          # Collection cover image
    │       └── background.webp     # Collection background image
    ├── categories/
    │   └── ${categoryId}/          # Per-category content directories (numeric ID)
    │       ├── metadata.json       # Category metadata with title field
    │       └── cover.webp          # Category cover image (optional)
    ├── companies/
    │   └── ${companyId}/           # Shared IGDB company profile (developers & publishers)
    │       ├── metadata.json       # title, summary, childs, company profile fields, external URLs, …
    │       ├── cover.webp          # Company cover image (optional)
    │       └── background.webp     # Company background image (optional)
    ├── developers/
    │   └── ${companyId}/           # Developer role link for a company
    │       └── metadata.json       # { "games": [ … ] } only
    ├── publishers/
    │   └── ${companyId}/           # Publisher role link for a company
    │       └── metadata.json       # { "games": [ … ] } only
    └── recommended/
        └── ${sectionId}/           # Per-section content directories
            └── metadata.json       # Section metadata with games array (without id field)
```

#### Persistent Data Files

All JSON files and settings are stored outside the codebase in the metadata path. These files are not part of the repository and should be managed separately:

- **`settings.json`**: Application settings (language preference, etc.)
- **`content/games/${gameId}/metadata.json`**: Game metadata files. Each game has its own folder with a metadata.json file containing game properties like `title`, `summary`, `year`, `stars`, etc. (the `id` field is derived from the folder name). Optional fallback image URLs when no local `cover.webp` / `background.webp` exist: `externalCoverUrl`, `externalBackgroundUrl`. Executable scripts are stored in **`content/games/${gameId}/scripts/`** as `.sh` or `.bat` files. Script order is defined by a numeric prefix in the filename: `01-label.sh`, `02-another-1.sh` (the number followed by a hyphen; the optional `-1` is the platform id).
- **`content/collections/${collectionId}/metadata.json`**: Collection metadata files. Each collection has its own folder with a metadata.json file containing collection properties like `title`, `summary`, `games` array, etc. (the `id` field is derived from the folder name).
- **`content/categories/${categoryId}/metadata.json`**: Category metadata files. Each category has its own folder (named with a numeric ID derived from the title) with a metadata.json file containing a `title` field.
- **`content/companies/${companyId}/metadata.json`**: Shared company profile (title, summary, IGDB metadata, hierarchy). Developer and publisher lists store only `{ "games": [...] }` under `content/developers/` and `content/publishers/` with the same numeric IGDB company id.
- **`content/recommended/${sectionId}/metadata.json`**: Recommended section metadata files. Each section has its own folder with a metadata.json file containing a `games` array (the `id` field is derived from the folder name).
- **`skins/${uuid}/`**: Optional web UI skins. Installed via the web app (Settings) as a zip, or placed manually. Uploading a zip whose resolved display name matches an existing skin’s `skin.json` **name** replaces that folder in place (same UUID, so the active theme stays valid). See **`SKINS.md`** in the **myhomegames-skins** repository for archive format and API.

#### Initial Setup

On first run, you may need to create the metadata directory structure:

```bash
mkdir -p "${METADATA_PATH}/content/games"
mkdir -p "${METADATA_PATH}/content/collections"
mkdir -p "${METADATA_PATH}/content/categories"
mkdir -p "${METADATA_PATH}/content/recommended"
mkdir -p "${METADATA_PATH}/skins"
```

Then create the required JSON files or copy them from a backup. The server will create default settings if `settings.json` doesn't exist.

On first run, if `METADATA_PATH/skins` has no installed skins, the server automatically installs the archive from `DEFAULT_SKIN_URL` (Plex by default) and sets it as `activeSkinId` in `settings.json`.

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

- `GET /auth/me` - Dev user profile when `API_TOKEN` matches (optional)
- `POST /auth/logout` - No-op logout (client clears local state)
- `GET /libraries` - Get list of game libraries
- `GET /games/:library` - Get games for a specific library
- `GET /launcher` - Launch a game
- `GET /igdb/*` - IGDB catalog search (requires Twitch app credentials for IGDB API)
- `GET /covers/:gameId` - Get game cover image (public)

API routes are open by default. Set `API_TOKEN` in development only if you need `GET /auth/me` to return a dev user.

## Authentication

The server does not require authentication for normal use. For development, optional `API_TOKEN` enables `GET /auth/me` — see [DEVELOPMENT.md](DEVELOPMENT.md).

IGDB API access uses Twitch **application** credentials (`X-Twitch-Client-Id`, `X-Twitch-Client-Secret`) for catalog search. With Cloudflare Tunnel, credentials are injected by the API gateway (e.g. Cloudflare Worker), not stored in `.env` or settings. Without the proxy, register your own app in the Twitch Developer Console — see [docs/IGDB.md](docs/IGDB.md).

## Troubleshooting

### SSL Certificate Errors

If you see errors like `ERR_CERT_AUTHORITY_INVALID` or "Your connection is not private" when accessing the application:

1. This is normal on first launch - the application uses self-signed certificates for local HTTPS
2. Follow the steps in the [First Time Setup](#first-time-setup-for-end-users) section above to accept the certificate
3. You only need to do this once per browser

If the server logs `"openssl" is not recognized` on Windows: current builds generate certificates with Node.js when `openssl` is not installed—rebuild from the latest server sources, or install OpenSSL / Git for Windows and add it to `PATH`, or set `HTTPS_ENABLED=false` to use HTTP only (see `.env.example`).

### Application Won't Start

- Check that ports 4000 (HTTP) and 41440 (HTTPS) are available
- Verify that the application has proper permissions to create files in the metadata directory (see [Metadata Path](#metadata-path) for defaults per OS)
- Check the console logs for error messages

### Authentication Issues

- Verify that IGDB credentials (Twitch Client ID/Secret) are configured in Settings or via the API gateway
- Check that `API_BASE` is set correctly in the environment variables
- Review server logs for authentication errors

For more troubleshooting information, see [DEVELOPMENT.md](DEVELOPMENT.md).
