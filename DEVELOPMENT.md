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

**Automatic Certificate Generation**: SSL certificates are automatically generated in the `metadata_path/certs/` directory on first startup when HTTPS is enabled. The server will create self-signed certificates (`key.pem` and `cert.pem`) if they don't already exist. On systems without `openssl` in `PATH` (typical on Windows), certificates are generated with Node.js via the `selfsigned` package—no OpenSSL install required.

**Manual Certificate Generation** (optional): If you need to manually generate certificates, you can do so:

```bash
# In metadata_path/certs/ (default: ~/Library/Application Support/MyHomeGames/certs/)
mkdir -p "${METADATA_PATH}/certs"
openssl genrsa -out "${METADATA_PATH}/certs/key.pem" 2048
openssl req -new -x509 -key "${METADATA_PATH}/certs/key.pem" -out "${METADATA_PATH}/certs/cert.pem" -days 365 -subj "/CN=localhost"
```

**Note**: These are self-signed certificates. Browsers will show a security warning when accessing the site. For production/public access, use proper SSL certificates or a **Cloudflare Tunnel** (see below).

## Cloudflare Tunnel (public HTTPS without local certificates)

The server can start **cloudflared** automatically (npm package `cloudflared`) and expose the local HTTP API on your Cloudflare hostname (e.g. `https://myhomegames-server.vige.it`). TLS terminates at Cloudflare; locally you only need HTTP on `127.0.0.1` — no self-signed certs and no browser warnings for remote access.

**Prerequisites**

1. Deploy `myhomegames-proxy` tunnel manager (`GET /api/get-token` after Cloudflare Access login).
2. Enable tunnel mode on the server and web (see below).

**`.env` example (server)**

```env
CLOUDFLARE_TUNNEL_ENABLED=true
API_BASE=https://your-user.myhomegames-server.vige.it
HTTPS_ENABLED=false
HTTP_PORT=4000
```

The run token is **not** in `.env`. On startup the web app fetches a per-user token from the tunnel manager (Cloudflare Access) and `POST`s it to `http://localhost:4000/tunnel/connect`, or reconnects with stored credentials via `POST /tunnel/reconnect`. The server stores the token under `METADATA_PATH/cloudflared/tunnel-credentials.json` and starts `cloudflared` on boot when present.

On first start the `cloudflared` binary is downloaded automatically. Set `CLOUDFLARE_TUNNEL_VERBOSE=true` to print tunnel logs.

**Twitch OAuth**: register redirect URI `https://<your-user>.myhomegames-server.vige.it/auth/twitch/callback` (must match `API_BASE` after connect).

**Web client**: keep `VITE_API_BASE=http://localhost:4000` for local control; set `VITE_TUNNEL_MANAGER_URL=https://myhomegames-server.vige.it`. After connect, API calls use your per-user hostname (saved in `localStorage`).

### Browser Security Warning

When using self-signed certificates, your browser will show a security warning (e.g., `ERR_CERT_AUTHORITY_INVALID`). This is normal for development:

1. Open `https://localhost:41440` (or your configured HTTPS port) in your browser
2. Click "Advanced" or "Show Details"
3. Click "Proceed to localhost" or "Accept the Risk and Continue"

After accepting the certificate, the browser will trust it for that session and API requests from the client will work correctly.

For a better development experience without warnings, you can use `mkcert` to generate trusted certificates:

```bash
# Install mkcert (macOS)
brew install mkcert
mkcert -install

# Generate trusted certificates in metadata_path/certs/
cd ~/Library/Application\ Support/MyHomeGames/certs
mkcert localhost 127.0.0.1
mv localhost+1.pem cert.pem
mv localhost+1-key.pem key.pem
```

Then restart the server. With `mkcert`, certificates are trusted by your system and no warnings will appear.

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
- `DEFAULT_SKIN_URL` - Optional zip URL for first-run default skin installation
  - Default: `https://myhomegamesskins.vige.it/zips/plex.mhg-skin.zip`
  - Applied only when `METADATA_PATH/skins` has no installed skins; the installed skin is also selected as active

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
1. Build packages for macOS, Linux, and Windows (`npm run build`)
2. Create a Git tag with the current version
3. Create a GitHub release with the changelog
4. Attach release assets (`.pkg`, `.deb`, `.rpm`, `.tar.gz`, `.zip`)
5. Run **`scripts/publish-package-repos.js`** (optional steps below)

### Package repositories (APT / YUM / Homebrew)

After the GitHub release, `after:release` runs `publish-package-repos.js`. Each target is **skipped** unless configured.

| Target | Env vars | Docs |
|--------|----------|------|
| APT | `PACKAGE_REPO_SSH`, `PACKAGE_REPO_APT_ROOT` | [docs/install-apt.md](docs/install-apt.md) |
| YUM/DNF | `PACKAGE_REPO_SSH`, `PACKAGE_REPO_YUM_ROOT` | [docs/install-yum.md](docs/install-yum.md) |
| Homebrew tap | `HOMEBREW_TAP_REPO` | [docs/install-homebrew.md](docs/install-homebrew.md) |

Example (add to `.env.local`, not committed):

```bash
export PACKAGE_REPO_SSH=deploy@packages.myhomegames.vige.it
export PACKAGE_REPO_APT_ROOT=/var/www/packages/apt
export PACKAGE_REPO_YUM_ROOT=/var/www/packages/yum/el9/x86_64
export HOMEBREW_TAP_REPO=git@github.com:myhomegames/homebrew-tap.git
```

Test publish without a full release:

```bash
npm run build
npm run publish:repos
```

### Build prerequisites

The full build (`npm run build`) produces packages for multiple platforms. Requirements:

- **macOS (.pkg):** Xcode Command Line Tools (for `swiftc` to compile the app wrapper). The script builds both x64 and arm64 `.pkg` installers.
- **Linux (.tar.gz):** No extra tools; Node and npm only.
- **Linux (.deb):** No extra tools; the build uses `deboa` (npm dependency).
- **Linux (.rpm):** Requires `rpmbuild` on the machine. On macOS you can install it with `brew install rpm`; on Linux it is usually available from the system package manager. If `rpmbuild` is not available, the build completes but skips generating the `.rpm` file.
- **Windows:** Node and npm; **`npm run build:win-unified`** and the full **`npm run build`** need **Go 1.21+** on `PATH`. The Windows release artifact is **`MyHomeGames-<ver>-win-x64.zip`**, a zip containing **`MyHomeGames-<ver>-win-x64.exe`**: a single executable that **embeds** the `pkg` server binary, tray PowerShell script, `.env`, `server-info.json`, optional `MyHomeGames-Tray.png`, and `README-WINDOWS.txt`. On first run it extracts to `%LOCALAPPDATA%\MyHomeGames\server-runtime\<version>\` and starts the tray. **`npm run build:win-unified`** runs **`pkg`** if the Windows server exe is missing from `build/`. Full **`npm run build`** produces the `.exe` and `.zip` after the macOS icon step so `MyHomeGames-Tray.png` can be included in the embedded payload when the icon is generated.

**Windows releases (unsigned binaries):** End users may see **SmartScreen** (e.g. *Consenti sull'app* / Run anyway) or **Defender** prompts on first run. This is expected for unsigned `.exe` files; **`scripts/README-WINDOWS.txt`** explains **Allow on device** / **Run anyway** so users can proceed safely when installing from official releases.

**Windows tray script (`windows-tray-launcher.ps1`):** Saved as **UTF-8 with BOM** so **Windows PowerShell 5.1** parses strings correctly. Prefer **ASCII** in quoted strings (e.g. `-` not em dash `—`) to avoid parser errors if the BOM is ever stripped.

Temporary build files (including RPM working directory) are created under `build/` and removed at the end; only the final packages remain in `build/`.

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
