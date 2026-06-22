const https = require("https");
const { loadItems, findById } = require("./collectionsShared");
const { formatIGDBDateWithFormat } = require("./dateUtils");
const { countryNameFromIso3166Numeric } = require("./iso3166NumericCountry");
const { resolveTwitchAppCredentials } = require("./twitchAppCredentials");

const LOG_PREFIX = "[igdb-company]";
const IGDB_COMPANY_FIELDS =
  "id,name,description,status.name,changed_company_id.id,changed_company_id.name,country,change_date,change_date_format,start_date,start_date_format,parent.id,parent.name,company_size.id,company_size.name,company_type_histories.company_type.name,company_type_histories.company.id,company_type_histories.company.name,company_type_histories.parent_company.id,company_type_histories.parent_company.name";

const FORMERLY_PREDECESSOR_STATUSES = new Set(["renamed", "merged"]);

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
    companySize: info.companySize ?? null,
    companySizeId: info.companySizeId ?? null,
    formerlyId: info.formerly?.id ?? null,
    formerlyName: info.formerly?.name ?? null,
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

function companyReferenceName(reference) {
  return reference && typeof reference.name === "string" ? reference.name.trim() : "";
}

const IGDB_COMPANY_TYPE_HISTORY_FIELDS =
  "company_type.name,company.id,company.name,parent_company.id,parent_company.name";

function companyTypeHistoryCompanyRef(history, mainCompanyId, typeName) {
  if (!isFormerlyCompanyType(typeName)) return null;

  const parent = history && history.parent_company;
  const relatedCompany = history && history.company;
  const mainId = mainCompanyId != null ? Number(mainCompanyId) : NaN;
  const parentId = parent && parent.id != null ? Number(parent.id) : NaN;
  const parentName = companyReferenceName(parent);
  const relatedId = relatedCompany && relatedCompany.id != null ? Number(relatedCompany.id) : NaN;
  const relatedName = companyReferenceName(relatedCompany);

  if (!Number.isNaN(mainId)) {
    if (!Number.isNaN(parentId) && parentId !== mainId && parentName) {
      return { id: parentId, name: parentName };
    }
    if (!Number.isNaN(relatedId) && relatedId !== mainId && relatedName) {
      return { id: relatedId, name: relatedName };
    }
  }

  if (!Number.isNaN(parentId) && parentName) {
    return { id: parentId, name: parentName };
  }
  if (!Number.isNaN(relatedId) && relatedName) {
    return { id: relatedId, name: relatedName };
  }

  return null;
}

function companyTypeHistoryValue(history, mainCompanyId, typeName) {
  const parentName = companyReferenceName(history && history.parent_company);
  const parentId =
    history && history.parent_company && history.parent_company.id != null
      ? Number(history.parent_company.id)
      : NaN;
  const relatedCompany = history && history.company;
  const relatedId = relatedCompany && relatedCompany.id != null ? Number(relatedCompany.id) : NaN;
  const relatedName = companyReferenceName(relatedCompany);
  const mainId = mainCompanyId != null ? Number(mainCompanyId) : NaN;

  if (isFormerlyCompanyType(typeName)) {
    if (!Number.isNaN(mainId)) {
      if (!Number.isNaN(parentId) && parentId !== mainId && parentName) return parentName;
      if (!Number.isNaN(relatedId) && relatedId !== mainId && relatedName) return relatedName;
    }
    return parentName || relatedName || null;
  }

  if (parentName) return parentName;
  if (
    relatedName &&
    (Number.isNaN(mainId) || Number.isNaN(relatedId) || relatedId !== mainId)
  ) {
    return relatedName;
  }

  return null;
}

function isFormerlyCompanyType(type) {
  return type === "formerly" || type === "former name" || type === "former" || type.startsWith("former");
}

function extractLegalNameFromDescription(description, displayName) {
  if (typeof description !== "string" || !description.trim()) return null;

  const match = description.trim().match(/^(.+?)\s+is\s+(?:a|an|the)\s+/i);
  if (!match) return null;

  const candidate = match[1].trim();
  if (!candidate) return null;

  const normalizedCandidate = normalizeCompanyName(candidate);
  const normalizedDisplay = normalizeCompanyName(displayName);
  if (normalizedDisplay && normalizedCandidate === normalizedDisplay) return null;

  return candidate;
}

function needsCompanyTypeHistoryEnrichment(info) {
  if (!info) return true;
  return (
    isMissingLocalValue(info.knownAs) ||
    isMissingLocalValue(info.legalName) ||
    isMissingLocalValue(info.formerly) ||
    isMissingLocalValue(info.parentCompany)
  );
}

function applyCompanyTypeHistories(info, histories, mainCompanyId) {
  if (!Array.isArray(histories) || histories.length === 0) return;

  const knownAs = [];

  for (const history of histories) {
    const type = normalizeCompanyTypeName(history && history.company_type && history.company_type.name);
    if (!type) continue;

    if (type === "known as") {
      const value = companyTypeHistoryValue(history, mainCompanyId, type);
      if (value) knownAs.push(value);
    } else if (type === "legal name") {
      const value = companyTypeHistoryValue(history, mainCompanyId, type);
      if (value) info.legalName = value;
    } else if (isFormerlyCompanyType(type) && !info.formerly) {
      const ref = companyTypeHistoryCompanyRef(history, mainCompanyId, type);
      if (ref) info.formerly = ref;
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
  if (company.company_size && company.company_size.name) {
    info.companySize = company.company_size.name;
    if (company.company_size.id != null) {
      info.companySizeId = company.company_size.id;
    }
  }

  applyCompanyTypeHistories(info, company.company_type_histories, company.id);
  if (!info.legalName) {
    const legalName = extractLegalNameFromDescription(company.description, company.name);
    if (legalName) info.legalName = legalName;
  }
  if (!info.parentCompany && company.parent && company.parent.id != null && company.parent.name) {
    info.parentCompany = {
      id: company.parent.id,
      name: company.parent.name,
    };
  }

  return Object.keys(info).length > 0 ? info : null;
}

function runIgdbApiQuery(path, postData, accessToken, clientId, context) {
  log(`IGDB request (${context})`, { clientId: maskClientId(clientId), query: postData.trim() });

  const options = {
    hostname: "api.igdb.com",
    path,
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
          const rows = Array.isArray(parsed) ? parsed : [];
          log(`IGDB response (${context})`, { count: rows.length });
          resolve(rows);
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

function runIgdbCompaniesQuery(postData, accessToken, clientId, context) {
  return runIgdbApiQuery("/v4/companies", postData, accessToken, clientId, context).then((companies) => {
    log(`IGDB companies (${context})`, {
      ids: companies.map((c) => c.id),
      names: companies.map((c) => c.name),
    });
    return companies;
  });
}

function fetchCompanyTypeHistoriesForCompany(companyId, accessToken, clientId) {
  const postData = `fields ${IGDB_COMPANY_TYPE_HISTORY_FIELDS}; where company = ${companyId}; limit 50;`;
  return runIgdbApiQuery(
    "/v4/company_type_histories",
    postData,
    accessToken,
    clientId,
    `type-histories:${companyId}`
  );
}

function pickRenamedPredecessorCompany(predecessors) {
  if (!Array.isArray(predecessors) || predecessors.length === 0) return null;

  const eligible = predecessors
    .filter((company) =>
      FORMERLY_PREDECESSOR_STATUSES.has(
        normalizeCompanyTypeName(company && company.status && company.status.name)
      )
    )
    .sort((a, b) => Number(b.change_date || 0) - Number(a.change_date || 0));

  const company = eligible.length > 0 ? eligible[0] : null;
  if (!company || company.id == null) return null;
  const name = companyReferenceName(company);
  return name ? { id: company.id, name } : null;
}

function fetchRenamedPredecessorCompany(successorCompanyId, accessToken, clientId) {
  const postData = `fields id,name,status.name,change_date; where changed_company_id = ${successorCompanyId}; sort change_date desc; limit 20;`;
  return runIgdbCompaniesQuery(postData, accessToken, clientId, `renamed-of:${successorCompanyId}`).then(
    pickRenamedPredecessorCompany
  );
}

function applyFormerlyFallback(info, formerlyCompany) {
  if (!formerlyCompany || formerlyCompany.id == null || !formerlyCompany.name) {
    return info;
  }
  if (info && !isMissingLocalValue(info.formerly)) {
    return info;
  }

  const next = info && typeof info === "object" ? { ...info } : {};
  next.formerly = { id: formerlyCompany.id, name: formerlyCompany.name };
  return next;
}

async function enrichIgdbCompanyInfo(company, accessToken, clientId) {
  if (!company || company.id == null) return null;

  let info = mapIgdbCompanyToInfo(company);

  if (needsCompanyTypeHistoryEnrichment(info)) {
    try {
      const histories = await fetchCompanyTypeHistoriesForCompany(company.id, accessToken, clientId);
      const base = info && typeof info === "object" ? { ...info } : {};
      applyCompanyTypeHistories(base, histories, company.id);
      if (!base.legalName) {
        const legalName = extractLegalNameFromDescription(company.description, company.name);
        if (legalName) base.legalName = legalName;
      }
      info = Object.keys(base).length > 0 ? base : info;
    } catch (err) {
      logWarn(`company_type_histories lookup failed for id=${company.id}`, err instanceof Error ? err.message : err);
    }
  }

  if (!info || isMissingLocalValue(info.formerly)) {
    try {
      const renamedFormerly = await fetchRenamedPredecessorCompany(company.id, accessToken, clientId);
      info = applyFormerlyFallback(info, renamedFormerly);
    } catch (err) {
      logWarn(`renamed predecessor lookup failed for id=${company.id}`, err instanceof Error ? err.message : err);
    }
  }

  return info && Object.keys(info).length > 0 ? info : null;
}

function fetchIgdbCompanyInfo(companyId, accessToken, clientId) {
  const postData = `fields ${IGDB_COMPANY_FIELDS}; where id = ${companyId};`;
  return runIgdbCompaniesQuery(postData, accessToken, clientId, `by-id:${companyId}`).then(async (companies) => {
    const company = companies.length > 0 ? companies[0] : null;
    if (!company) {
      log(`IGDB by-id ${companyId}: no company returned`);
      return null;
    }
    const info = await enrichIgdbCompanyInfo(company, accessToken, clientId);
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
    const info = await enrichIgdbCompanyInfo(match, accessToken, clientId);
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
  if (typeof value === "object") {
    if (value.id != null && typeof value.name === "string" && value.name.trim() !== "") {
      return false;
    }
    return true;
  }
  return false;
}

function mergeIgdbCompanyInfo(local, remote) {
  if (!remote || typeof remote !== "object") {
    const existing = local && typeof local === "object" ? { ...local } : null;
    return { info: existing, changed: false };
  }

  const merged = local && typeof local === "object" ? { ...local } : {};
  let changed = false;

  for (const key of ["status", "country", "changedOn", "started", "knownAs", "legalName", "companySize", "companySizeId"]) {
    if (!isMissingLocalValue(remote[key]) && isMissingLocalValue(merged[key])) {
      merged[key] = remote[key];
      changed = true;
    }
  }

  if (remote.formerly && typeof remote.formerly === "object") {
    if (isMissingLocalValue(merged.formerly)) {
      merged.formerly = { ...remote.formerly };
      changed = true;
    } else if (typeof merged.formerly === "object") {
      const formerly = { ...merged.formerly };
      let formerlyChanged = false;
      if (isMissingLocalValue(formerly.id) && remote.formerly.id != null) {
        formerly.id = remote.formerly.id;
        formerlyChanged = true;
      }
      if (isMissingLocalValue(formerly.name) && !isMissingLocalValue(remote.formerly.name)) {
        formerly.name = remote.formerly.name;
        formerlyChanged = true;
      }
      if (formerlyChanged) {
        merged.formerly = formerly;
        changed = true;
      }
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
  pickRenamedPredecessorCompany,
  fetchIgdbCompanyInfo,
  normalizeCompanyName,
  pickCompanyByTitle,
  isMissingLocalValue,
  mergeIgdbCompanyInfo,
  resolveIgdbCompanyInfoForEntry,
  attachIgdbCompanyInfoForNewItems,
};
