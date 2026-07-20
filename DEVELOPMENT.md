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

The server can start **cloudflared** automatically and expose the local HTTP API on your Cloudflare hostname (e.g. `https://myhomegames-server.vige.it`). TLS terminates at Cloudflare; locally you only need HTTP on `127.0.0.1` — no self-signed certs and no browser warnings for remote access.

**Two different “versions”**

| What | Example | Where |
|------|---------|--------|
| **npm wrapper** (`cloudflared` dependency in `package.json`) | `0.7.1` | Node API (`Tunnel`, `install`, …) |
| **Cloudflare CLI binary** (downloaded at runtime) | `2026.6.1` | `METADATA_PATH/bin/cloudflared` |

The npm package version is **not** the tunnel release. The executable is fetched from [Cloudflare releases](https://github.com/cloudflare/cloudflared/releases).

**Prerequisites**

1. Deploy `myhomegames-proxy` tunnel manager (`GET /api/get-token` after Cloudflare Access login).
2. Enable tunnel mode on the server and web (see below).

**`.env` example (server)**

```env
CLOUDFLARE_TUNNEL_ENABLED=true
API_BASE=https://your-user-myhomegames-server.vige.it
HTTPS_ENABLED=false
HTTP_PORT=4000
```

The run token is **not** in `.env`. On startup the web app fetches a per-user token from the tunnel manager (Cloudflare Access) and `POST`s it to `http://localhost:4000/tunnel/connect`, or reconnects with stored credentials via `POST /tunnel/reconnect`. The server stores the run token under `METADATA_PATH/tokens/cloudflare-tunnel-run.json` and starts `cloudflared` on boot when present.

**Realtime TURN (browser remote play)** is also **not** in `.env`. The long-term TURN key is a Worker secret on the tunnel manager; the home server calls `POST https://myhomegames-server.vige.it/api/turn-ice-servers` and only receives short-lived ICE credentials for Moonlight Web.

**Binary install and updates**

When the tunnel starts, `ensureCloudflaredBinary` (`utils/cloudflaredBinary.js`):

1. Ensures `METADATA_PATH/bin/cloudflared` exists (creates the directory if needed).
2. Copies a **newer** bundled binary from the app package into metadata, if the release ships one (macOS `.app`, Windows/Linux install dir).
3. Downloads or updates the Cloudflare CLI:
   - **Missing binary** → downloads `latest` from GitHub.
   - **Existing binary older than latest release** → overwrites the same file with `latest` (no separate old copy is kept).
   - **Already up to date** → no download.

To pin or disable auto-update:

```env
# Optional — pin a specific Cloudflare release (e.g. 2026.6.1)
# CLOUDFLARED_VERSION=2026.6.1

# Optional — only download when the binary is missing (legacy behaviour)
# CLOUDFLARED_SKIP_UPDATE=true

# Optional — use an external executable instead of metadata/bin (advanced)
# CLOUDFLARED_BIN=/opt/homebrew/bin/cloudflared
```

Set `CLOUDFLARE_TUNNEL_VERBOSE=true` to print tunnel logs.

**Manual binary refresh (development)**

After `npm install`, the wrapper may place a copy under `node_modules/cloudflared/bin/`. To refresh it to the latest Cloudflare release:

```bash
node node_modules/cloudflared/lib/cloudflared.js bin install latest
node_modules/cloudflared/bin/cloudflared --version
```

Packaged builds (`npm run build`) also copy that binary into the app bundle for offline first run.

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

**Important**: HTTPS in development is optional. The server always provides HTTP access. Use HTTPS when testing self-signed certificate acceptance or mixed-content scenarios.

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
  - Optional dev token for `GET /auth/me` only
- `API_BASE` - Base URL of the API server (optional for development)
- `METADATA_PATH` - Path where game metadata are stored
  - Default: `$HOME/Library/Application Support/MyHomeGames`
- `DEFAULT_SKIN_URL` - Optional zip URL for first-run default skin installation
  - Default: `plex-<version>.mhg-skin.zip` from the latest GitHub Release of `myhomegames/myhomegames-skins` (override repo with `MHG_SKINS_GITHUB_REPO`)
  - Applied only when `METADATA_PATH/skins` has no installed skins; the installed skin is also selected as active

## Development Authentication

In development mode, you can set `API_TOKEN` so `GET /auth/me` returns a dev user profile.

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
- Verify `API_TOKEN` is set correctly in `.env` (development only, for `/auth/me`)
- Review server logs for API errors

### HTTPS issues
- **HTTPS server not starting**: Check that `HTTPS_ENABLED=true` in `.env`
- **Browser security warning**: This is normal with self-signed certificates. Accept the exception or use `mkcert` for trusted certificates
- **Port conflicts**: Ensure ports 4000 (HTTP) and 41440 (HTTPS) are available, or change them via `HTTP_PORT` and `HTTPS_PORT`

## Creating Releases

The project uses `release-it` to automate GitHub releases. To create a release:

```bash
npm run release
```

Requires `GITHUB_TOKEN` in `.env` (or `.env.local`). Without it, `release-it` falls back to the GitHub “new release” page in the browser. A long changelog in the URL may fail with **“Your request URL is too long”**, and build artifacts are **not** uploaded automatically in that mode.

`npm run release` uses `scripts/run-release.mjs`, which sets `NODE_DEBUG=release-it:config` to work around a release-it/Octokit bug (`log: null` → *Cannot read properties of null (reading 'debug')*). GitHub config uses `skipChecks: true` for the same compatibility reason.

This will:
1. Build packages for macOS, Linux, and Windows (`npm run build`)
2. Create a Git tag with the current version
3. Create a GitHub release with the changelog
4. Attach release assets (`.pkg`, `.deb`, `.rpm`, `.tar.gz`, `.zip`)
5. Run **`scripts/publish-package-repos.js`** and **`scripts/publish-msstore.js`** (optional; see below)
6. GitHub Actions **`msstore-release.yml`** builds MSIX and submits to the Microsoft Store when the release is published (requires repository secrets)

### Package repositories (APT / YUM / Homebrew)

After the GitHub release, `after:release` runs `publish-package-repos.js`. Each target is **skipped** unless configured.

| Target | Env vars | Docs |
|--------|----------|------|
| APT | `CLOUDSMITH_API_KEY`, `CLOUDSMITH_OWNER`, `CLOUDSMITH_REPO` | [docs/install-apt.md](docs/install-apt.md) |
| YUM/DNF | same as APT | [docs/install-yum.md](docs/install-yum.md) |
| Homebrew tap | `HOMEBREW_TAP_REPO` | [docs/install-homebrew.md](docs/install-homebrew.md) |

Example (add to `.env.local`, not committed):

```bash
export CLOUDSMITH_API_KEY=cs_api_xxxxxxxx
export CLOUDSMITH_OWNER=myhomegames
export CLOUDSMITH_REPO=myhomegames-server
export HOMEBREW_TAP_REPO=git@github.com:myhomegames/myhomegames-homebrewtap.git
```

See [docs/install-cloudsmith.md](docs/install-cloudsmith.md) for Cloudsmith setup.

Test publish without a full release:

```bash
npm run build
npm run publish:repos
```

### Microsoft Store (Windows MSIX)

After the GitHub release is published, [`.github/workflows/msstore-release.yml`](.github/workflows/msstore-release.yml) runs on `windows-latest`: builds the unified `.exe`, packs **`MyHomeGames-<version>-win-x64.msix`**, and runs **`msstore publish`**.

Configure **`MSSTORE_*` secrets** in the GitHub repository (see [docs/install-msstore.md](docs/install-msstore.md)). On macOS, `publish-msstore.js` only logs that the workflow handles Store submission.

Local test on Windows (SDK MakeAppx + Store CLI):

```bash
npm run build:win-unified
npm run build:msix
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

A **GitHub Personal Access Token** with `repo` scope is **recommended** for automated releases (not required — `npm run release` warns and falls back to the web UI).

1. Create a token at [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)** → scope **`repo`**.
2. Add it to `.env` (or `.env.local` — see `.env.example`; never commit the token). `npm run release` loads both automatically.

```bash
# .env
GITHUB_TOKEN=ghp_your_token_here
```

#### Token troubleshooting

If release fails with authentication or Octokit errors:

1. **Classic PAT** — scope **`repo`** must be enabled.
2. **Organization SSO** — if `myhomegames` uses SAML SSO, open the token → **Configure SSO** → **Authorize** for the org.
3. **Fine-grained PAT** — select repository `myhomegames-server` and grant **Contents: Read and write** + **Metadata: Read**.
4. Verify the token (loads `GITHUB_TOKEN` from `.env`):

```bash
set -a && source .env && set +a
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user
```

A valid response includes your `"login"`.

**Security Note:** Never commit your `GITHUB_TOKEN` to the repository. The `.gitignore` file already excludes `.env`, `.env.local`, and `.env.*.local`.
