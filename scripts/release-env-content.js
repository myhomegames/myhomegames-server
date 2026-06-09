/** Default .env baked into release packages (macOS .pkg, Linux, Windows). */
module.exports = `HTTP_PORT=4000
HTTPS_ENABLED=false
API_BASE=https://myhomegames-server.vige.it
FRONTEND_URL=https://myhomegames.vige.it/app/
COVER_TAG_URL=https://myhomegames.vige.it
CLOUDFLARE_TUNNEL_ENABLED=true
`;
