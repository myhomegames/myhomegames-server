/**
 * Upload .deb / .rpm packages to Cloudsmith via the REST API.
 *
 * Env:
 *   CLOUDSMITH_API_KEY
 *   CLOUDSMITH_OWNER          namespace (e.g. myhomegames)
 *   CLOUDSMITH_REPO           repository slug (e.g. myhomegames-server)
 *   CLOUDSMITH_DEB_DISTRO     default: any-distro
 *   CLOUDSMITH_DEB_VERSION    default: any-version
 *   CLOUDSMITH_RPM_DISTRO     default: el
 *   CLOUDSMITH_RPM_VERSION    default: 9
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.cloudsmith.io/v1';

function cloudsmithConfig() {
  const apiKey = process.env.CLOUDSMITH_API_KEY;
  const owner = process.env.CLOUDSMITH_OWNER;
  const repo = process.env.CLOUDSMITH_REPO;
  if (!apiKey || !owner || !repo) return null;
  return {
    apiKey,
    owner,
    repo,
    debDistro: process.env.CLOUDSMITH_DEB_DISTRO || 'any-distro',
    debVersion: process.env.CLOUDSMITH_DEB_VERSION || 'any-version',
    rpmDistro: process.env.CLOUDSMITH_RPM_DISTRO || 'el',
    rpmVersion: process.env.CLOUDSMITH_RPM_VERSION || '9',
  };
}

function md5File(filePath) {
  const hash = crypto.createHash('md5');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function apiJson(method, apiPath, { apiKey, body }) {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${apiPath} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function requestFileUpload(config, filePath) {
  const filename = path.basename(filePath);
  const md5Checksum = md5File(filePath);
  const { owner, repo, apiKey } = config;

  return apiJson('POST', `/files/${owner}/${repo}/`, {
    apiKey,
    body: { filename, md5_checksum: md5Checksum, method: 'post' },
  });
}

async function uploadFileToStorage(filePath, uploadInfo) {
  const { upload_url: uploadUrl, upload_fields: uploadFields = {} } = uploadInfo;
  const form = new FormData();

  for (const [key, value] of Object.entries(uploadFields)) {
    form.append(key, String(value));
  }

  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer]);
  form.append('file', blob, path.basename(filePath));

  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`file upload to storage failed (${res.status}): ${text}`);
  }
}

async function createPackage(config, format, filePath, distro, version) {
  const { owner, repo, apiKey } = config;
  const uploadInfo = await requestFileUpload(config, filePath);
  await uploadFileToStorage(filePath, uploadInfo);

  const distribution = `${distro}/${version}`;
  return apiJson('POST', `/packages/${owner}/${repo}/upload/${format}/`, {
    apiKey,
    body: {
      distribution,
      package_file: uploadInfo.identifier,
      republish: true,
    },
  });
}

async function publishDeb(config, debPath) {
  const { debDistro, debVersion } = config;
  return createPackage(config, 'deb', debPath, debDistro, debVersion);
}

async function publishRpm(config, rpmPath) {
  const { rpmDistro, rpmVersion } = config;
  return createPackage(config, 'rpm', rpmPath, rpmDistro, rpmVersion);
}

module.exports = {
  cloudsmithConfig,
  publishDeb,
  publishRpm,
};
