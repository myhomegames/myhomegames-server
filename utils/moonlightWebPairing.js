"use strict";

const { requestJson, postJson } = require("./moonlightWebCredentials");
const {
  DEFAULT_USERNAME: DEFAULT_SUNSHINE_USERNAME,
  DEFAULT_PASSWORD: DEFAULT_SUNSHINE_PASSWORD,
} = require("./sunshineCredentials");

const DEFAULT_SUNSHINE_HTTP_PORT = 47989;
const DEFAULT_SUNSHINE_HTTPS_PORT = 47990;
const DEFAULT_CLIENT_NAME = "MyHomeGames";

function resolveSunshineAddressForMoonlight({ kind, env = process.env, lanIp = null } = {}) {
  const override = env.MOONLIGHT_WEB_SUNSHINE_ADDRESS?.trim();
  if (override) return override;
  // From inside Docker/Colima, prefer the host LAN IP: host.docker.internal often
  // resolves to IPv6-only on Colima and breaks Sunshine GameStream pairing.
  if (kind === "docker") {
    const fromEnv = env.MOONLIGHT_WEB_DOCKER_HOST?.trim() || env.WEBRTC_NAT_1TO1_HOST?.trim();
    if (fromEnv) return fromEnv;
    if (lanIp) return lanIp;
    return "host.docker.internal";
  }
  return "127.0.0.1";
}

function resolveSunshineHttpPort(env = process.env) {
  const port = Number(env.SUNSHINE_HTTP_PORT || DEFAULT_SUNSHINE_HTTP_PORT);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_SUNSHINE_HTTP_PORT;
}

function resolveSunshineHttpsPort(env = process.env) {
  const port = Number(env.SUNSHINE_HTTPS_PORT || DEFAULT_SUNSHINE_HTTPS_PORT);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_SUNSHINE_HTTPS_PORT;
}

function resolveSunshineAdminCredentials(env = process.env) {
  const username = (env.SUNSHINE_USERNAME || DEFAULT_SUNSHINE_USERNAME).trim() || DEFAULT_SUNSHINE_USERNAME;
  const password = (env.SUNSHINE_PASSWORD || DEFAULT_SUNSHINE_PASSWORD).trim() || DEFAULT_SUNSHINE_PASSWORD;
  return { username, password };
}

function parseNdjson(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractPin(message) {
  if (!message || typeof message !== "object") return null;
  if (typeof message.Pin === "string") return message.Pin;
  if (typeof message.pin === "string") return message.pin;
  return null;
}

function isPairedStatus(value) {
  return value === "Paired" || value?.Paired != null || value === true;
}

function hostLooksPaired(host) {
  if (!host) return false;
  return host.paired === "Paired" || isPairedStatus(host.paired);
}

function addressesMatch(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  return loopback.has(a) && loopback.has(b);
}

async function listMoonlightHosts(baseUrl, cookie) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/hosts`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/hosts failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }

  const lines = parseNdjson(response.body);
  const first = lines[0] || {};
  const hosts = Array.isArray(first.hosts) ? first.hosts : [];
  // Later NDJSON lines refresh undetailed host rows (still without address).
  for (const line of lines.slice(1)) {
    if (line && typeof line.host_id === "number") {
      const idx = hosts.findIndex((host) => host.host_id === line.host_id);
      if (idx >= 0) hosts[idx] = { ...hosts[idx], ...line };
      else hosts.push(line);
    }
  }
  return hosts;
}

async function getMoonlightHost(baseUrl, cookie, hostId) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/host?host_id=${encodeURIComponent(hostId)}`,
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET /api/host failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return parsed.host || parsed;
}

async function addMoonlightHost(baseUrl, cookie, { address, httpPort }) {
  const response = await postJson(
    `${baseUrl}/api/host`,
    { address, http_port: httpPort },
    30_000,
    { headers: cookie ? { Cookie: cookie } : {} },
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`POST /api/host failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(response.body || "{}");
  return parsed.host || parsed;
}

async function deleteMoonlightHost(baseUrl, cookie, hostId) {
  const response = await requestJson({
    urlString: `${baseUrl}/api/host?host_id=${encodeURIComponent(hostId)}`,
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
    timeoutMs: 30_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`DELETE /api/host failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
}

async function findHostByAddress(baseUrl, cookie, address) {
  const hosts = await listMoonlightHosts(baseUrl, cookie);
  for (const summary of hosts) {
    if (summary?.host_id == null) continue;
    try {
      const detailed = await getMoonlightHost(baseUrl, cookie, summary.host_id);
      const merged = { ...summary, ...detailed };
      if (
        addressesMatch(merged.address, address) ||
        addressesMatch(merged.local_ip, address)
      ) {
        return merged;
      }
    } catch {
      // Host may be offline; keep looking.
    }
  }
  return null;
}

function resolveSunshinePinUrl(env = process.env) {
  const override = env.SUNSHINE_API_BASE?.trim();
  if (override) {
    return `${override.replace(/\/$/, "")}/api/pin`;
  }
  const host = String(env.SUNSHINE_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const port = resolveSunshineHttpsPort(env);
  return `https://${host}:${port}/api/pin`;
}

async function submitSunshinePin({ pin, name, env = process.env }) {
  const auth = resolveSunshineAdminCredentials(env);
  const response = await postJson(
    resolveSunshinePinUrl(env),
    { pin: String(pin), name: name || DEFAULT_CLIENT_NAME },
    30_000,
    { auth },
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Sunshine /api/pin failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
  }
  return response;
}

/**
 * Start Moonlight pairing and feed the PIN into Sunshine automatically.
 * Pair endpoint returns NDJSON: first line Pin, later line Paired/PairError.
 */
async function pairMoonlightHost(baseUrl, cookie, hostId, env = process.env) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/pair`);
    const lib = url.protocol === "https:" ? require("https") : require("http");
    const payload = Buffer.from(JSON.stringify({ host_id: hostId }), "utf8");
    const headers = {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json",
      "Content-Length": payload.length,
    };
    if (cookie) headers.Cookie = cookie;

    let buffer = "";
    let pinSent = false;
    let settled = false;
    let pinPromise = Promise.resolve();
    let pairedPayload = null;
    const clientName = env.MOONLIGHT_WEB_CLIENT_NAME?.trim() || DEFAULT_CLIENT_NAME;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const maybeFinishSuccess = () => {
      if (!pairedPayload || !pinSent) return;
      pinPromise
        .then(() => finish(null, { paired: true, host: pairedPayload }))
        .catch((error) => finish(error));
    };

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
        rejectUnauthorized: false,
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            finish(
              new Error(
                `POST /api/pair failed (${res.statusCode}): ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`,
              ),
            );
          });
          return;
        }

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;
            let message;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }

            const pin = extractPin(message);
            if (pin && !pinSent) {
              pinSent = true;
              // Sunshine must see the GameStream pair request before /api/pin is accepted.
              pinPromise = new Promise((resolveDelay) => setTimeout(resolveDelay, 1500))
                .then(() => submitSunshinePin({ pin, name: clientName, env }))
                .then(() => {
                  console.log(`Sunshine accepted Moonlight Web pairing PIN (${pin}).`);
                });
              maybeFinishSuccess();
              continue;
            }

            if (message?.Paired || message?.paired) {
              pairedPayload = message.Paired || message.paired;
              maybeFinishSuccess();
              continue;
            }
            if (
              message === "PairError" ||
              message?.PairError != null ||
              message?.pairError ||
              message === "InternalServerError"
            ) {
              finish(new Error("Moonlight Web reported PairError"));
              return;
            }
          }
        });
        res.on("end", () => {
          if (settled) return;
          if (pairedPayload && pinSent) {
            maybeFinishSuccess();
            return;
          }
          finish(new Error("Moonlight Web pairing stream ended before confirmation"));
        });
      },
    );

    req.on("error", finish);
    req.on("timeout", () => {
      req.destroy();
      finish(new Error("Timed out pairing Moonlight Web with Sunshine"));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Ensure Sunshine host exists in Moonlight Web and is paired.
 */
async function ensureMoonlightWebSunshinePairing({
  baseUrl,
  cookie,
  kind = null,
  env = process.env,
  lanIp = null,
} = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalized) throw new Error("Moonlight Web URL is required for pairing");
  if (!cookie) throw new Error("Moonlight Web session cookie is required for pairing");

  const address = resolveSunshineAddressForMoonlight({ kind, env, lanIp });
  const httpPort = resolveSunshineHttpPort(env);

  let host = await findHostByAddress(normalized, cookie, address);

  if (!host) {
    // Drop unpaired hosts that point at the wrong address (e.g. IPv6-only host.docker.internal).
    const summaries = await listMoonlightHosts(normalized, cookie);
    for (const summary of summaries) {
      if (summary?.host_id == null || hostLooksPaired(summary)) continue;
      try {
        const detailed = await getMoonlightHost(normalized, cookie, summary.host_id);
        if (!addressesMatch(detailed.address, address)) {
          console.log(
            `Removing unpaired Moonlight host ${summary.host_id} (${detailed.address}) before re-adding ${address}`,
          );
          await deleteMoonlightHost(normalized, cookie, summary.host_id);
        } else {
          host = { ...summary, ...detailed };
        }
      } catch {
        // ignore offline/detail errors
      }
    }
  }

  if (!host) {
    // Prefer an already-paired host (e.g. added manually with a different address alias).
    const summaries = await listMoonlightHosts(normalized, cookie);
    const pairedSummary = summaries.find((item) => hostLooksPaired(item));
    if (pairedSummary?.host_id != null) {
      try {
        host = await getMoonlightHost(normalized, cookie, pairedSummary.host_id);
      } catch {
        host = pairedSummary;
      }
    }
  }

  if (!host) {
    console.log(`Adding Sunshine host to Moonlight Web (${address}:${httpPort})...`);
    host = await addMoonlightHost(normalized, cookie, { address, httpPort });
  }

  if (hostLooksPaired(host)) {
    console.log("Moonlight Web is already paired with Sunshine.");
    return { paired: true, hostId: host.host_id, alreadyPaired: true };
  }

  const hostId = host.host_id;
  if (hostId == null) {
    throw new Error("Moonlight Web host_id missing after add");
  }

  console.log(`Pairing Moonlight Web host ${hostId} with Sunshine...`);
  const result = await pairMoonlightHost(normalized, cookie, hostId, env);
  console.log("Moonlight Web ↔ Sunshine pairing complete.");
  return { paired: true, hostId, alreadyPaired: false, host: result.host || null };
}

module.exports = {
  DEFAULT_CLIENT_NAME,
  resolveSunshineAddressForMoonlight,
  resolveSunshineHttpPort,
  ensureMoonlightWebSunshinePairing,
  listMoonlightHosts,
  getMoonlightHost,
  addMoonlightHost,
  deleteMoonlightHost,
  findHostByAddress,
  extractPin,
  parseNdjson,
  hostLooksPaired,
  addressesMatch,
};
