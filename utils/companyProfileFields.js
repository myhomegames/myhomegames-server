"use strict";

const COMPANY_PROFILE_SCALAR_KEYS = [
  "status",
  "countryCode",
  "started",
  "changedOn",
  "knownAs",
  "legalName",
  "companySize",
  "companySizeId",
];

const COMPANY_PROFILE_REFERENCE_KEYS = ["formerly", "parentCompany", "updatedTo"];

const COMPANY_PROFILE_FIELD_KEYS = [
  ...COMPANY_PROFILE_SCALAR_KEYS,
  ...COMPANY_PROFILE_REFERENCE_KEYS,
];

function pickFromFlat(source) {
  if (!source || typeof source !== "object") return {};
  const fields = {};
  for (const key of COMPANY_PROFILE_FIELD_KEYS) {
    if (source[key] !== undefined) {
      fields[key] = source[key];
    }
  }
  return fields;
}

function pickCompanyProfileFields(entry) {
  return pickFromFlat(entry);
}

function appendCompanyProfileFields(data, entry) {
  const fields = pickCompanyProfileFields(entry);
  for (const [key, value] of Object.entries(fields)) {
    data[key] = value;
  }
}

function clearCompanyProfileFields(entry) {
  if (!entry || typeof entry !== "object") return;
  for (const key of COMPANY_PROFILE_FIELD_KEYS) {
    delete entry[key];
  }
}

function applyNormalizedCompanyProfileFields(entry, normalized) {
  clearCompanyProfileFields(entry);
  if (normalized && typeof normalized === "object") {
    Object.assign(entry, normalized);
  }
}

function hasAnyCompanyProfileFieldInBody(body) {
  if (!body || typeof body !== "object") return false;
  return COMPANY_PROFILE_FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function extractCompanyProfileFieldsFromBody(body) {
  if (!body || typeof body !== "object") return undefined;
  const raw = {};
  let hasAny = false;
  for (const key of COMPANY_PROFILE_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      raw[key] = body[key];
      hasAny = true;
    }
  }
  return hasAny ? raw : undefined;
}

function attachFetchedCompanyProfileFields(item, fields) {
  if (!item || typeof item !== "object" || !fields || typeof fields !== "object") return;
  for (const key of COMPANY_PROFILE_FIELD_KEYS) {
    if (fields[key] !== undefined) {
      item[key] = fields[key];
    }
  }
}

module.exports = {
  COMPANY_PROFILE_FIELD_KEYS,
  COMPANY_PROFILE_SCALAR_KEYS,
  COMPANY_PROFILE_REFERENCE_KEYS,
  pickCompanyProfileFields,
  pickFromFlat,
  appendCompanyProfileFields,
  clearCompanyProfileFields,
  applyNormalizedCompanyProfileFields,
  hasAnyCompanyProfileFieldInBody,
  extractCompanyProfileFieldsFromBody,
  attachFetchedCompanyProfileFields,
};
