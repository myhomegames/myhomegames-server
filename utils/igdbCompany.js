const https = require("https");
const { loadItems, findById } = require("./collectionsShared");
const { formatIGDBDateWithFormat } = require("./dateUtils");
const { countryNameFromIso3166Numeric } = require("./iso3166NumericCountry");
const { resolveTwitchAppCredentials } = require("./twitchAppCredentials");

const LOG_PREFIX = "[igdb-company]";
const IGDB_COMPANY_FIELDS =
  "id,name,status.name,changed_company_id.id,changed_company_id.name,country,change_date,change_date_format,start_date,start_date_format,parent.id,parent.name,company_type_histories.company_type.name,company_type_histories.parent_company.id,company_type_histories.parent_company.name";

function log(message, extra) {
  if (extra !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function logWarn(message, extra) {
  if (extra !== undefined) {
    console.warn(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.warn(`${LOG_PREFIX} ${message}`);
  }
}

function maskClientId(clientId) {
  const id = String(clientId || "").trim();
  if (!id) return "(empty)";
  if (id.length <= 6) return "***";
  return `***${id.slice(-4)}`;
}

function summarizeLocalInfo(info) {
  if (!info || typeof info !== "object") return null;
  return {
    status: info.status ?? null,
    country: info.country ?? null,
    changedOn: info.changedOn ?? null,
    started: info.started ?? null,
    knownAs: info.knownAs ?? null,
    legalName: info.legalName ?? null,
    formerly: info.formerly ?? null,
    parentCompanyId: info.parentCompany?.id ?? null,
    parentCompanyName: info.parentCompany?.name ?? null,
    updatedToId: info.updatedTo?.id ?? null,
    updatedToName: info.updatedTo?.name ?? null,
  };
}

function normalizeCompanyTypeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function companyTypeHistoryValue(history) {
  const parent = history && history.parent_company;
  const value = parent && typeof parent.name === "string" ? parent.name.trim() : "";
  return value || null;
}

function applyCompanyTypeHistories(info, histories) {
  if (!Array.isArray(histories) || histories.length === 0) return;

  const knownAs = [];
  const formerly = [];

  for (const history of histories) {
    const type = normalizeCompanyTypeName(history && history.company_type && history.company_type.name);
    const value = companyTypeHistoryValue(history);
    if (!type || !value) continue;

    if (type === "known as") {
      knownAs.push(value);
    } else if (type === "legal name") {
      info.legalName = value;
    } else if (type === "formerly") {
      formerly.push(value);
    } else if (type === "parent company" && !info.parentCompany) {
      const parent = history.parent_company;
      if (parent && parent.id != null && parent.name) {
        info.parentCompany = { id: parent.id, name: parent.name };
      }
    }
  }

  if (knownAs.length > 0) {
    info.knownAs = knownAs.join(", ");
  }
  if (formerly.length > 0) {
    info.formerly = formerly.join(", ");
  }
}

function mapIgdbCompanyToInfo(company) {
  if (!company || company.id == null) return null;

  const info = {};
  if (company.status && company.status.name) {
    info.status = company.status.name;
  }
  if (company.changed_company_id && company.changed_company_id.id && company.changed_company_id.name) {
    info.updatedTo = {
      id: company.changed_company_id.id,
      name: company.changed_company_id.name,
    };
  }
  const countryName = countryNameFromIso3166Numeric(company.country);
  if (countryName) {
    info.country = countryName;
  }
  const changedOn = formatIGDBDateWithFormat(company.change_date, company.change_date_format);
  if (changedOn) {
    info.changedOn = changedOn;
  }
  const started = formatIGDBDateWithFormat(company.start_date, company.start_date_format);
  if (started) {
    info.started = started;
  }

  applyCompanyTypeHistories(info, company.company_type_histories);
  if (!info.parentCompany && company.parent && company.parent.id != null && company.parent.name) {
    info.parentCompany = {
      id: company.parent.id,
      name: company.parent.name,
    };
  }

  return Object.keys(info).length > 0 ? info : null;
}

function runIgdbCompaniesQuery(postData, accessToken, clientId, context) {
  log(`IGDB request (${context})`, { clientId: maskClientId(clientId), query: postData.trim() });

  const options = {
    hostname: "api.igdb.com",
    path: "/v4/companies",
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const igdbReq = https.request(options, (igdbRes) => {
      let data = "";
      igdbRes.on("data", (chunk) => {
        data += chunk;
      });
      igdbRes.on("end", () => {
        try {
          if (igdbRes.statusCode !== 200) {
            logWarn(`IGDB response error (${context})`, {
              statusCode: igdbRes.statusCode,
              body: data.slice(0, 500),
            });
            reject(new Error(`IGDB API error ${igdbRes.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          const companies = Array.isArray(parsed) ? parsed : [];
          log(`IGDB response (${context})`, {
            count: companies.length,
            ids: companies.map((c) => c.id),
            names: companies.map((c) => c.name),
          });
          resolve(companies);
        } catch (e) {
          logWarn(`IGDB parse error (${context})`, e.message);
          reject(e);
        }
      });
    });
    igdbReq.on("error", (err) => {
      logWarn(`IGDB network error (${context})`, err.message);
      reject(err);
    });
    igdbReq.write(postData);
    igdbReq.end();
  });
}

function fetchIgdbCompanyInfo(companyId, accessToken, clientId) {
  const postData = `fields ${IGDB_COMPANY_FIELDS}; where id = ${companyId};`;
  return runIgdbCompaniesQuery(postData, accessToken, clientId, `by-id:${companyId}`).then((companies) => {
    const company = companies.length > 0 ? companies[0] : null;
    if (!company) {
      log(`IGDB by-id ${companyId}: no company returned`);
      return null;
    }
    const info = mapIgdbCompanyToInfo(company);
    if (!info) {
      logWarn(`IGDB by-id ${companyId}: company found but no display fields`, {
        igdbName: company.name ?? null,
        rawStatus: company.status?.name ?? null,
        rawCountry: company.country ?? null,
      });
    }
    return info;
  });
}

function normalizeCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function pickCompanyByTitle(companies, title) {
  if (!companies || companies.length === 0) return null;
  const key = normalizeCompanyName(title);
  if (!key) return null;
  return companies.find((company) => normalizeCompanyName(company.name) === key) || null;
}

function searchIgdbCompaniesByName(name, accessToken, clientId, limit = 10) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return Promise.resolve([]);
  const escapedName = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const postData = `fields ${IGDB_COMPANY_FIELDS}; search "${escapedName}"; limit ${limit};`;
  return runIgdbCompaniesQuery(postData, accessToken, clientId, `by-name:"${trimmed}"`);
}

async function resolveIgdbCompanyInfoForEntry(entry, accessToken, clientId) {
  const id = entry && entry.id != null ? Number(entry.id) : NaN;
  const title = entry && typeof entry.title === "string" ? entry.title.trim() : "";

  if (!Number.isNaN(id) && id >= 1) {
    log(`lookup by id=${id} title="${title}"`);
    try {
      const byId = await fetchIgdbCompanyInfo(id, accessToken, clientId);
      if (byId) {
        log(`lookup by id=${id}: success`, summarizeLocalInfo(byId));
        return byId;
      }
      log(`lookup by id=${id}: no usable data, trying name search`);
    } catch (err) {
      logWarn(`lookup by id=${id} failed`, err instanceof Error ? err.message : err);
    }
  } else {
    logWarn("lookup skipped invalid id", { id: entry?.id ?? null, title });
  }

  if (!title) {
    logWarn("lookup by name skipped: empty title");
    return null;
  }

  try {
    const candidates = await searchIgdbCompaniesByName(title, accessToken, clientId);
    const match = pickCompanyByTitle(candidates, title);
    if (!match) {
      logWarn(`lookup by name "${title}": no exact match`, {
        candidateNames: candidates.map((c) => c.name),
      });
      return null;
    }
    const info = mapIgdbCompanyToInfo(match);
    if (!info) {
      logWarn(`lookup by name "${title}": match id=${match.id} but no display fields`);
      return null;
    }
    log(`lookup by name "${title}": success (igdb id=${match.id})`, summarizeLocalInfo(info));
    return info;
  } catch (err) {
    logWarn(`lookup by name "${title}" failed`, err instanceof Error ? err.message : err);
    return null;
  }
}

function isMissingLocalValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function mergeIgdbCompanyInfo(local, remote) {
  if (!remote || typeof remote !== "object") {
    const existing = local && typeof local === "object" ? { ...local } : null;
    return { info: existing, changed: false };
  }

  const merged = local && typeof local === "object" ? { ...local } : {};
  let changed = false;

  for (const key of ["status", "country", "changedOn", "started", "knownAs", "legalName", "formerly"]) {
    if (!isMissingLocalValue(remote[key]) && isMissingLocalValue(merged[key])) {
      merged[key] = remote[key];
      changed = true;
    }
  }

  if (remote.parentCompany && typeof remote.parentCompany === "object") {
    if (isMissingLocalValue(merged.parentCompany)) {
      merged.parentCompany = { ...remote.parentCompany };
      changed = true;
    } else if (typeof merged.parentCompany === "object") {
      const parentCompany = { ...merged.parentCompany };
      let parentCompanyChanged = false;
      if (isMissingLocalValue(parentCompany.id) && remote.parentCompany.id != null) {
        parentCompany.id = remote.parentCompany.id;
        parentCompanyChanged = true;
      }
      if (isMissingLocalValue(parentCompany.name) && !isMissingLocalValue(remote.parentCompany.name)) {
        parentCompany.name = remote.parentCompany.name;
        parentCompanyChanged = true;
      }
      if (parentCompanyChanged) {
        merged.parentCompany = parentCompany;
        changed = true;
      }
    }
  }

  if (remote.updatedTo && typeof remote.updatedTo === "object") {
    if (isMissingLocalValue(merged.updatedTo)) {
      merged.updatedTo = { ...remote.updatedTo };
      changed = true;
    } else if (typeof merged.updatedTo === "object") {
      const updatedTo = { ...merged.updatedTo };
      let updatedToChanged = false;
      if (isMissingLocalValue(updatedTo.id) && remote.updatedTo.id != null) {
        updatedTo.id = remote.updatedTo.id;
        updatedToChanged = true;
      }
      if (isMissingLocalValue(updatedTo.name) && !isMissingLocalValue(remote.updatedTo.name)) {
        updatedTo.name = remote.updatedTo.name;
        updatedToChanged = true;
      }
      if (updatedToChanged) {
        merged.updatedTo = updatedTo;
        changed = true;
      }
    }
  }

  const info = Object.keys(merged).length > 0 ? merged : null;
  return { info, changed };
}

/** Fetch IGDB company info for new developer/publisher items during POST /igdb/import-game. */
async function attachIgdbCompanyInfoForNewItems(metadataPath, contentFolder, items, req) {
  if (!items || !Array.isArray(items) || items.length === 0) return;

  const creds = resolveTwitchAppCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    logWarn(`attach skip ${contentFolder}: Twitch credentials unavailable on /igdb/* request`);
    return;
  }

  let accessToken;
  try {
    const { getIGDBAccessToken } = require("../routes/igdb");
    accessToken = await getIGDBAccessToken(creds.clientId, creds.clientSecret);
  } catch (err) {
    logWarn(`attach skip ${contentFolder}: token error`, err instanceof Error ? err.message : err);
    return;
  }

  const list = loadItems(metadataPath, contentFolder);

  for (const item of items) {
    const id = typeof item === "object" && item && item.id != null ? Number(item.id) : NaN;
    if (Number.isNaN(id) || id < 1 || findById(list, id)) continue;

    try {
      const info = await fetchIgdbCompanyInfo(id, accessToken, creds.clientId);
      if (info && typeof item === "object" && item) {
        item.igdbCompanyInfo = info;
        log(`attach ${contentFolder}/${id}`, summarizeLocalInfo(info));
      }
    } catch (err) {
      logWarn(`attach failed ${contentFolder}/${id}`, err instanceof Error ? err.message : err);
    }
  }
}

module.exports = {
  mapIgdbCompanyToInfo,
  fetchIgdbCompanyInfo,
  normalizeCompanyName,
  pickCompanyByTitle,
  isMissingLocalValue,
  mergeIgdbCompanyInfo,
  resolveIgdbCompanyInfoForEntry,
  attachIgdbCompanyInfoForNewItems,
};
