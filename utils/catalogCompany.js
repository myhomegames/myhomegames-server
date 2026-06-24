const https = require("https");
const { loadItems, findById } = require("./collectionsShared");
const { formatIGDBDateWithFormat } = require("./dateUtils");
const { resolveTwitchAppCredentials } = require("./twitchAppCredentials");
const { attachFetchedCompanyProfileFields, pickCompanyProfileFields } = require("./companyProfileFields");
const { syncParentCompanyChildLink } = require("./companyStorage");

const LOG_PREFIX = "[catalog-company]";
const CATALOG_COMPANY_API_FIELDS =
  "id,name,description,logo.image_id,status.name,changed_company_id.id,changed_company_id.name,country,change_date,change_date_format,start_date,start_date_format,parent.id,parent.name,company_size.id,company_size.name,company_type_histories.company_type.name,company_type_histories.company.id,company_type_histories.company.name,company_type_histories.parent_company.id,company_type_histories.parent_company.name";

const FORMERLY_PREDECESSOR_STATUSES = new Set(["renamed", "merged", "defunct"]);

function logWarn(message, extra) {
  if (extra !== undefined) {
    console.warn(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.warn(`${LOG_PREFIX} ${message}`);
  }
}

function normalizeCompanyTypeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function companyReferenceName(reference) {
  return reference && typeof reference.name === "string" ? reference.name.trim() : "";
}

const CATALOG_COMPANY_TYPE_HISTORY_FIELDS =
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

function companyDisplayName(company) {
  return company && typeof company.name === "string" ? company.name.trim() : "";
}

function catalogCompanyLogoUrl(company) {
  const imageId = company && company.logo && company.logo.image_id;
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.png`;
}

function mapCatalogCompanyStoragePatch(company, profileInfo) {
  if (!company || company.id == null) return null;

  const title = companyDisplayName(company);
  const summary = typeof company.description === "string" ? company.description.trim() : "";
  const externalCoverUrl = catalogCompanyLogoUrl(company);
  const patch = {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(externalCoverUrl ? { externalCoverUrl } : {}),
    ...(profileInfo && typeof profileInfo === "object" ? profileInfo : {}),
  };

  return Object.keys(patch).length > 0 ? patch : null;
}

async function fetchRemoteCompanyStoragePatch(companyId, fallbackName, accessToken, clientId) {
  const postData = `fields ${CATALOG_COMPANY_API_FIELDS}; where id = ${companyId};`;
  return runCatalogCompaniesQuery(postData, accessToken, clientId, `storage-patch:${companyId}`).then(
    async (companies) => {
      const company = companies.length > 0 ? companies[0] : null;
      if (!company) {
        return null;
      }

      const profileInfo = await enrichCompanyProfile(company, accessToken, clientId);
      const normalizedProfile = profileInfo ? normalizeStoredCompanyProfile(profileInfo) : null;
      const patch = mapCatalogCompanyStoragePatch(company, normalizedProfile);
      if (!patch && fallbackName) {
        return { title: fallbackName };
      }
      if (patch && !patch.title && fallbackName) {
        patch.title = fallbackName;
      }
      return patch;
    },
  );
}

async function syncParentCompanyChildLinkFromCatalog(
  metadataPath,
  roleFolder,
  childEntry,
  accessToken,
  clientId,
) {
  if (!childEntry || childEntry.id == null) return false;

  const parentRef = pickCompanyProfileFields(childEntry).parentCompany;
  if (!parentRef || parentRef.id == null) return false;

  const parentId = Number(parentRef.id);
  const parentName =
    typeof parentRef.name === "string" && parentRef.name.trim()
      ? parentRef.name.trim()
      : String(parentRef.id);

  let parentProfilePatch = null;
  try {
    parentProfilePatch = await fetchRemoteCompanyStoragePatch(parentId, parentName, accessToken, clientId);
  } catch (err) {
    logWarn(
      `parent storage-patch failed for id=${parentId}`,
      err instanceof Error ? err.message : err,
    );
  }

  return syncParentCompanyChildLink(metadataPath, roleFolder, childEntry, {
    parentProfilePatch: parentProfilePatch || { title: parentName },
  });
}

async function ensureParentCompanyLinksForItems(metadataPath, roleFolder, items, req) {
  if (!items || !Array.isArray(items) || items.length === 0) return;

  const creds = resolveTwitchAppCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    logWarn(`parent link skip ${roleFolder}: Twitch credentials unavailable`);
    return;
  }

  let accessToken;
  try {
    const { getIGDBAccessToken } = require("../routes/igdb");
    accessToken = await getIGDBAccessToken(creds.clientId, creds.clientSecret);
  } catch (err) {
    logWarn(`parent link skip ${roleFolder}: token error`, err instanceof Error ? err.message : err);
    return;
  }

  const { loadRoleItemById } = require("./companyStorage");

  for (const item of items) {
    const id = typeof item === "object" && item && item.id != null ? Number(item.id) : NaN;
    if (Number.isNaN(id) || id < 1) continue;

    const entry = loadRoleItemById(metadataPath, roleFolder, id);
    const childEntry = entry || (typeof item === "object" ? item : null);
    if (!childEntry || !pickCompanyProfileFields(childEntry).parentCompany) continue;

    try {
      await syncParentCompanyChildLinkFromCatalog(
        metadataPath,
        roleFolder,
        childEntry,
        accessToken,
        creds.clientId,
      );
    } catch (err) {
      logWarn(`parent link failed ${roleFolder}/${id}`, err instanceof Error ? err.message : err);
      syncParentCompanyChildLink(metadataPath, roleFolder, childEntry);
    }
  }
}

function mapCatalogCompanyToInfo(company) {
  if (!company || company.id == null) return null;

  const info = {};
  if (company.status && company.status.name) {
    const status = normalizeCompanyStatus(company.status.name);
    if (status) info.status = status;
  }
  if (company.changed_company_id && company.changed_company_id.id && company.changed_company_id.name) {
    info.updatedTo = {
      id: company.changed_company_id.id,
      name: company.changed_company_id.name,
    };
  }
  if (company.country != null && company.country !== "") {
    const countryCode =
      typeof company.country === "number" ? company.country : parseInt(String(company.country), 10);
    if (!Number.isNaN(countryCode)) {
      info.countryCode = countryCode;
    }
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

function runCatalogCompaniesQuery(postData, accessToken, clientId, context) {
  return runIgdbApiQuery("/v4/companies", postData, accessToken, clientId, context);
}

function fetchCompanyTypeHistoriesForCompany(companyId, accessToken, clientId) {
  const postData = `fields ${CATALOG_COMPANY_TYPE_HISTORY_FIELDS}; where company = ${companyId}; limit 50;`;
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
  return runCatalogCompaniesQuery(postData, accessToken, clientId, `renamed-of:${successorCompanyId}`).then(
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

async function enrichCompanyProfile(company, accessToken, clientId) {
  if (!company || company.id == null) return null;

  let info = mapCatalogCompanyToInfo(company);

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

function fetchRemoteCompanyProfile(companyId, accessToken, clientId) {
  const postData = `fields ${CATALOG_COMPANY_API_FIELDS}; where id = ${companyId};`;
  return runCatalogCompaniesQuery(postData, accessToken, clientId, `by-id:${companyId}`).then(async (companies) => {
    const company = companies.length > 0 ? companies[0] : null;
    if (!company) {
      return null;
    }
    const info = await enrichCompanyProfile(company, accessToken, clientId);
    if (!info) {
      logWarn(`IGDB by-id ${companyId}: company found but no display fields`, {
        catalogName: company.name ?? null,
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

function searchCatalogCompaniesByName(name, accessToken, clientId, limit = 10) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return Promise.resolve([]);
  const escapedName = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const postData = `fields ${CATALOG_COMPANY_API_FIELDS}; search "${escapedName}"; limit ${limit};`;
  return runCatalogCompaniesQuery(postData, accessToken, clientId, `by-name:"${trimmed}"`);
}

async function resolveCompanyProfileForEntry(entry, accessToken, clientId) {
  const id = entry && entry.id != null ? Number(entry.id) : NaN;
  const title = entry && typeof entry.title === "string" ? entry.title.trim() : "";

  if (!Number.isNaN(id) && id >= 1) {
    try {
      const byId = await fetchRemoteCompanyProfile(id, accessToken, clientId);
      if (byId) {
        return byId;
      }
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
    const candidates = await searchCatalogCompaniesByName(title, accessToken, clientId);
    const match = pickCompanyByTitle(candidates, title);
    if (!match) {
      logWarn(`lookup by name "${title}": no exact match`, {
        candidateNames: candidates.map((c) => c.name),
      });
      return null;
    }
    const info = await enrichCompanyProfile(match, accessToken, clientId);
    if (!info) {
      logWarn(`lookup by name "${title}": match id=${match.id} but no display fields`);
      return null;
    }
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

function mergeCompanyProfile(local, remote) {
  if (!remote || typeof remote !== "object") {
    const existing = local && typeof local === "object" ? { ...local } : null;
    return { info: existing, changed: false };
  }

  const merged = local && typeof local === "object" ? { ...local } : {};
  let changed = false;

  for (const key of ["status", "countryCode", "changedOn", "started", "knownAs", "legalName", "companySize", "companySizeId"]) {
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

const CATALOG_COMPANY_SIZE_NAMES = {
  1: "0-1 employees",
  2: "2-10 employees",
  3: "11-50 employees",
  4: "51-200 employees",
  5: "201-500 employees",
  6: "501-1000 employees",
  7: "1001-5000 employees",
  8: "5000+ employees",
};

const CATALOG_COMPANY_STATUS_VALUES = new Set(["active", "defunct", "merge", "merged", "renamed"]);

function normalizeOptionalString(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCompanyReference(ref) {
  if (ref == null) return null;
  if (typeof ref !== "object") return null;
  const name = normalizeOptionalString(ref.name);
  if (!name) return null;
  const idRaw = ref.id;
  if (idRaw == null || idRaw === "") {
    return { name };
  }
  const id = Number(idRaw);
  if (Number.isNaN(id)) return { name };
  return { id, name };
}

function normalizeCountryCode(value) {
  if (value == null || value === "") return null;
  const code = Number(value);
  if (Number.isNaN(code) || code < 1) return null;
  return code;
}

function normalizeCompanySizeId(value) {
  if (value == null || value === "") return null;
  const id = Number(value);
  if (Number.isNaN(id) || !CATALOG_COMPANY_SIZE_NAMES[id]) return null;
  return id;
}

function normalizeCompanyStatus(value) {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return null;
  let key = trimmed.toLowerCase();
  if (key === "merged") key = "merge";
  if (!CATALOG_COMPANY_STATUS_VALUES.has(key)) return null;
  if (key === "merge") return "Merge";
  if (key === "renamed") return "Renamed";
  if (key === "defunct") return "Defunct";
  return "Active";
}

/** Normalize user-edited company metadata before persisting on developer/publisher items. */
function normalizeStoredCompanyProfile(input) {
  if (input == null) return null;
  if (typeof input !== "object") return null;

  const info = {};
  const status = normalizeCompanyStatus(input.status);
  if (status) info.status = status;

  const countryCode = normalizeCountryCode(input.countryCode);
  if (countryCode != null) info.countryCode = countryCode;

  const started = normalizeOptionalString(input.started);
  if (started) info.started = started;

  const changedOn = normalizeOptionalString(input.changedOn);
  if (changedOn) info.changedOn = changedOn;

  const knownAs = normalizeOptionalString(input.knownAs);
  if (knownAs) info.knownAs = knownAs;

  const legalName = normalizeOptionalString(input.legalName);
  if (legalName) info.legalName = legalName;

  const companySizeId = normalizeCompanySizeId(input.companySizeId);
  if (companySizeId != null) {
    info.companySizeId = companySizeId;
    info.companySize = CATALOG_COMPANY_SIZE_NAMES[companySizeId];
  }

  const formerly = normalizeCompanyReference(input.formerly);
  if (formerly) info.formerly = formerly;

  const parentCompany = normalizeCompanyReference(input.parentCompany);
  if (parentCompany) info.parentCompany = parentCompany;

  const updatedTo = normalizeCompanyReference(input.updatedTo);
  if (updatedTo) info.updatedTo = updatedTo;

  return Object.keys(info).length > 0 ? info : null;
}

/** @deprecated Prefer client/importer flow: GET /igdb/company/:id then POST merge-company-profile. */
async function attachCompanyProfileForNewItems(metadataPath, contentFolder, items, req) {
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
      const info = await fetchRemoteCompanyProfile(id, accessToken, creds.clientId);
      if (info && typeof item === "object" && item) {
        attachFetchedCompanyProfileFields(item, info);
      }
    } catch (err) {
      logWarn(`attach failed ${contentFolder}/${id}`, err instanceof Error ? err.message : err);
    }
  }
}

module.exports = {
  mapCatalogCompanyToInfo,
  mapCatalogCompanyStoragePatch,
  pickRenamedPredecessorCompany,
  fetchRemoteCompanyProfile,
  fetchRemoteCompanyStoragePatch,
  normalizeCompanyName,
  pickCompanyByTitle,
  isMissingLocalValue,
  mergeCompanyProfile,
  normalizeStoredCompanyProfile,
  resolveCompanyProfileForEntry,
  attachCompanyProfileForNewItems,
  syncParentCompanyChildLinkFromCatalog,
  ensureParentCompanyLinksForItems,
};
