# IGDB catalog integration

MyHomeGames uses the [IGDB API](https://www.igdb.com/api) (via Twitch Developer Services) to enrich your personal library: search, covers, descriptions, similar games, and related metadata. Data is cached locally for your own use; MyHomeGames does not redistribute IGDB content as a public API or dataset.

IGDB access requires **Twitch application credentials** (Client ID and Client Secret). These are *not* a user login: the server uses the Twitch `client_credentials` flow only. No Twitch account sign-in is involved.

## Two ways to connect

### 1. Automatic credentials (Cloudflare Tunnel + proxy)

This is the default setup when you use the hosted tunnel and API gateway:

1. Connect **Cloudflare Tunnel** from the web app (Settings → Cloudflare profile).
2. The Cloudflare Worker on your public hostname injects `X-Twitch-Client-Id` and `X-Twitch-Client-Secret` on `/igdb/*` requests before they reach your local server.
3. In the web app, open **Settings → IGDB / Twitch**, enable **IGDB API**, and save.

You do **not** enter Client ID or Client Secret in the app. Credentials live on the API gateway (Worker secrets), not in your browser or in server settings.

See [myhomegames-proxy](https://github.com/myhomegames/myhomegames-proxy) for how `/igdb/*` forwarding and credential injection work.

### 2. Manual credentials (self-hosted / no proxy)

Use this if you run the server locally (or without the Cloudflare IGDB proxy) and want to supply your own Twitch application credentials.

#### Register a Twitch application

1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and sign in (or [create a Twitch account](https://www.twitch.tv/signup) first).
2. Click **Register Your Application** (or **+ Create**).
3. Fill in:
   - **Name**: e.g. `MyHomeGames`
   - **OAuth redirect URLs**: not used for IGDB catalog search. You may enter a placeholder (e.g. `http://localhost`) if the console requires at least one URL.
   - **Category**: Application Integration
4. After creating the app, open **Manage** → copy the **Client ID**.
5. Under **Manage** → **New Secret**, generate a **Client Secret** and store it safely.

#### Configure MyHomeGames

Choose one of these (in order of precedence when the tunnel/proxy is **disabled**):

| Method | Where |
|--------|--------|
| Web UI | **Settings → IGDB / Twitch** — enable IGDB API, enter Client ID and Client Secret |
| Server `.env` | `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` |
| Metadata file | `${METADATA_PATH}/tokens/twitch-app-credentials.json` (written when you save from Settings) |

Then enable **IGDB API** in Settings so the app calls `/igdb/*` endpoints.

For local development without the tunnel, the web build must **not** set `VITE_CLOUDFLARE_TUNNEL_ENABLED=true`; otherwise the Settings page hides the Client ID / Secret fields and expects the gateway to inject credentials.

## Enable IGDB in the app

Regardless of automatic or manual credentials:

1. Open **Settings**.
2. Find **IGDB / Twitch**.
3. Turn on **Enable IGDB API** (or **Enable Client ID / Secret (IGDB)** when configuring credentials locally).
4. Save if prompted.

You can then use catalog search, IGDB game details, and metadata import features that depend on IGDB.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| IGDB search returns “credentials not available” (tunnel mode) | Worker secrets `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`; IGDB enabled in Settings |
| Same error (local / manual mode) | Client ID and Secret in Settings or `.env`; IGDB API enabled |
| Settings show no Client ID / Secret fields | `VITE_CLOUDFLARE_TUNNEL_ENABLED=true` — credentials are expected from the gateway |
| 401/403 from Twitch | Regenerate Client Secret in Developer Console and update configuration |

## Related documentation

- [Server README](../README.md) — API overview
- [DEVELOPMENT.md](../DEVELOPMENT.md) — local development setup
- [myhomegames-proxy](https://github.com/myhomegames/myhomegames-proxy) — IGDB credential injection on `/igdb/*`
