const https = require("https");
const { loadItems, findById } = require("./collectionsShared");
const { formatIGDBDateWithFormat } = require("./dateUtils");
const { countryNameFromIso3166Numeric } = require("./iso3166NumericCountry");
const { resolveTwitchAppCredentials } = require("./twitchAppCredentials");

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

  return Object.keys(info).length > 0 ? info : null;
}

function fetchIgdbCompanyInfo(companyId, accessToken, clientId) {
  const postData =
    "fields id,name,status.name,changed_company_id.id,changed_company_id.name,country,change_date,change_date_format;" +
    ` where id = ${companyId};`;

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
            reject(new Error(`IGDB API error ${igdbRes.statusCode}: ${data}`));
            return;
          }
          const parsed = JSON.parse(data);
          const company = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null;
          if (!company) {
            resolve(null);
            return;
          }
          resolve(mapIgdbCompanyToInfo(company));
        } catch (e) {
          reject(e);
        }
      });
    });
    igdbReq.on("error", reject);
    igdbReq.write(postData);
    igdbReq.end();
  });
}

/** Fetch IGDB company info for new developer/publisher items during game import. */
async function attachIgdbCompanyInfoForNewItems(metadataPath, contentFolder, items, req) {
  if (!items || !Array.isArray(items) || items.length === 0) return;

  const creds = resolveTwitchAppCredentials(req);
  if (!creds.clientId || !creds.clientSecret) return;

  let accessToken;
  try {
    const { getIGDBAccessToken } = require("../routes/igdb");
    accessToken = await getIGDBAccessToken(creds.clientId, creds.clientSecret);
  } catch {
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
      }
    } catch {
      // skip failed company fetch
    }
  }
}

module.exports = {
  mapIgdbCompanyToInfo,
  fetchIgdbCompanyInfo,
  attachIgdbCompanyInfoForNewItems,
};
