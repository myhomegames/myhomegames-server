"use strict";

const fs = require("fs");
const path = require("path");
const { readJsonFile, ensureDirectoryExists, writeJsonFile, removeDirectoryIfEmpty } = require("./fileUtils");
const { normalizeId, normalizeChildIds, findById } = require("./collectionsShared");
const { getTitleForSort } = require("./sortUtils");
const {
  pickFromFlat,
  pickCompanyProfileFields,
  COMPANY_PROFILE_FIELD_KEYS,
} = require("./companyProfileFields");

const COMPANIES_FOLDER = "companies";
const ROLE_FOLDERS = new Set(["developers", "publishers"]);

function isCompanyRoleFolder(contentFolder) {
  return ROLE_FOLDERS.has(contentFolder);
}

function otherRoleFolder(roleFolder) {
  return roleFolder === "developers" ? "publishers" : "developers";
}

function getCompanyDir(metadataPath, companyId) {
  return path.join(metadataPath, "content", COMPANIES_FOLDER, String(companyId));
}

function getCompanyMetadataPath(metadataPath, companyId) {
  return path.join(getCompanyDir(metadataPath, companyId), "metadata.json");
}

function getRoleDir(metadataPath, roleFolder, companyId) {
  return path.join(metadataPath, "content", roleFolder, String(companyId));
}

function getRoleMetadataPath(metadataPath, roleFolder, companyId) {
  return path.join(getRoleDir(metadataPath, roleFolder, companyId), "metadata.json");
}

function storedExternalCoverUrl(entry) {
  const u = entry && entry.externalCoverUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function storedExternalBackgroundUrl(entry) {
  const u = entry && entry.externalBackgroundUrl;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function isLegacyRoleMetadata(meta) {
  if (!meta || typeof meta !== "object") return false;
  return (
    typeof meta.title === "string" ||
    typeof meta.summary === "string" ||
    meta.showTitle !== undefined ||
    meta.externalCoverUrl !== undefined ||
    meta.externalBackgroundUrl !== undefined ||
    Array.isArray(meta.childs)
  );
}

function extractCompanyProfile(meta, companyId) {
  return {
    title: typeof meta.title === "string" ? meta.title.trim() : "",
    summary: typeof meta.summary === "string" ? meta.summary.trim() : "",
    showTitle: meta.showTitle !== false,
    childs: normalizeChildIds(meta.childs, companyId),
    externalCoverUrl: storedExternalCoverUrl(meta),
    externalBackgroundUrl: storedExternalBackgroundUrl(meta),
    ...pickFromFlat(meta),
  };
}

function isEmptyCompanyProfileValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object") {
    if (value.id != null && typeof value.name === "string" && value.name.trim() !== "") {
      return false;
    }
    return true;
  }
  return false;
}

function mergeParentCompanyProfiles(existing, incoming) {
  const merged = { ...existing };
  for (const key of COMPANY_PROFILE_FIELD_KEYS) {
    if (isEmptyCompanyProfileValue(existing[key]) && !isEmptyCompanyProfileValue(incoming[key])) {
      merged[key] = incoming[key];
    }
  }
  if (isEmptyCompanyProfileValue(existing.title) && incoming.title) {
    merged.title = incoming.title;
  }
  if (isEmptyCompanyProfileValue(existing.summary) && incoming.summary) {
    merged.summary = incoming.summary;
  }
  if (isEmptyCompanyProfileValue(existing.externalCoverUrl) && incoming.externalCoverUrl) {
    merged.externalCoverUrl = incoming.externalCoverUrl;
  }
  if (isEmptyCompanyProfileValue(existing.externalBackgroundUrl) && incoming.externalBackgroundUrl) {
    merged.externalBackgroundUrl = incoming.externalBackgroundUrl;
  }
  return merged;
}

function companyHasRoleLink(metadataPath, companyId) {
  return (
    roleLinkExists(metadataPath, "developers", companyId) ||
    roleLinkExists(metadataPath, "publishers", companyId)
  );
}

function mergeCompanyProfiles(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (key === "childs") {
      const normalized = normalizeChildIds(value);
      const existingChilds = normalizeChildIds(existing.childs);
      if (normalized.length === 0 && existingChilds.length > 0) {
        continue;
      }
      merged.childs = normalized;
      continue;
    }
    if (value === null) {
      delete merged[key];
      continue;
    }
    if (typeof value === "string" && value.trim() === "" && key !== "title") {
      merged[key] = key === "summary" ? "" : null;
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function saveCompanyProfile(metadataPath, companyId, profile) {
  const dir = getCompanyDir(metadataPath, companyId);
  ensureDirectoryExists(dir);
  const toSave = { ...profile };
  delete toSave.id;
  delete toSave.games;
  delete toSave.parentCompany;
  toSave.childs = normalizeChildIds(toSave.childs, companyId);
  writeJsonFile(getCompanyMetadataPath(metadataPath, companyId), toSave);
}

function loadCompanyProfile(metadataPath, companyId) {
  const metaPath = getCompanyMetadataPath(metadataPath, companyId);
  if (!fs.existsSync(metaPath)) return null;
  const meta = readJsonFile(metaPath, null);
  if (!meta || typeof meta.title !== "string" || !meta.title.trim()) return null;
  if (meta.parentCompany !== undefined) {
    delete meta.parentCompany;
    writeJsonFile(metaPath, meta);
  }
  return {
    title: meta.title.trim(),
    summary: typeof meta.summary === "string" ? meta.summary : "",
    showTitle: meta.showTitle !== false,
    childs: normalizeChildIds(meta.childs, companyId),
    externalCoverUrl: storedExternalCoverUrl(meta),
    externalBackgroundUrl: storedExternalBackgroundUrl(meta),
    ...pickFromFlat(meta),
  };
}

function saveRoleGames(metadataPath, roleFolder, companyId, games) {
  const dir = getRoleDir(metadataPath, roleFolder, companyId);
  ensureDirectoryExists(dir);
  const normalizedGames = Array.isArray(games) ? games : [];
  writeJsonFile(getRoleMetadataPath(metadataPath, roleFolder, companyId), { games: normalizedGames });
}

function migrateRoleMediaToCompany(metadataPath, roleFolder, companyId) {
  const roleDir = getRoleDir(metadataPath, roleFolder, companyId);
  const companyDir = getCompanyDir(metadataPath, companyId);
  if (!fs.existsSync(roleDir)) return;
  ensureDirectoryExists(companyDir);
  for (const fileName of ["cover.webp", "background.webp"]) {
    const sourcePath = path.join(roleDir, fileName);
    const targetPath = path.join(companyDir, fileName);
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
    if (fs.existsSync(sourcePath)) {
      fs.unlinkSync(sourcePath);
    }
  }
  removeDirectoryIfEmpty(roleDir);
}

function migrateLegacyRoleMetadata(metadataPath, roleFolder, companyId, legacyMeta) {
  const profile = extractCompanyProfile(legacyMeta, companyId);
  const games = Array.isArray(legacyMeta.games) ? legacyMeta.games : [];
  const existingProfile = loadCompanyProfile(metadataPath, companyId);
  saveCompanyProfile(
    metadataPath,
    companyId,
    existingProfile ? mergeCompanyProfiles(existingProfile, profile) : profile,
  );
  saveRoleGames(metadataPath, roleFolder, companyId, games);
  migrateRoleMediaToCompany(metadataPath, roleFolder, companyId);
}

function readRoleMetadata(metadataPath, roleFolder, companyId) {
  const metaPath = getRoleMetadataPath(metadataPath, roleFolder, companyId);
  if (!fs.existsSync(metaPath)) return null;
  const meta = readJsonFile(metaPath, null);
  if (!meta || typeof meta !== "object") return null;
  if (isLegacyRoleMetadata(meta)) {
    migrateLegacyRoleMetadata(metadataPath, roleFolder, companyId, meta);
    return { games: Array.isArray(meta.games) ? meta.games : [] };
  }
  return { games: Array.isArray(meta.games) ? meta.games : [] };
}

function roleLinkExists(metadataPath, roleFolder, companyId) {
  return fs.existsSync(getRoleMetadataPath(metadataPath, roleFolder, companyId));
}

function listRoleCompanyIds(metadataPath, roleFolder) {
  const dir = path.join(metadataPath, "content", roleFolder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function buildMergedEntry(metadataPath, roleFolder, companyId) {
  const normalizedId = normalizeId(companyId);
  if (normalizedId == null) return null;
  const roleMeta = readRoleMetadata(metadataPath, roleFolder, normalizedId);
  if (!roleMeta) return null;

  const profile = loadCompanyProfile(metadataPath, normalizedId);
  if (!profile) return null;

  return {
    id: normalizedId,
    ...profile,
    games: roleMeta.games,
  };
}

function pruneInvalidCompanyChildLinks(metadataPath, entries) {
  let changed = false;
  for (const entry of entries) {
    const before = Array.isArray(entry.childs) ? entry.childs : [];
    const pruned = normalizeChildIds(before, entry.id).filter((id) =>
      companyHasRoleLink(metadataPath, id),
    );
    if (before.length !== pruned.length || before.some((id, idx) => String(id) !== String(pruned[idx]))) {
      entry.childs = pruned;
      saveCompanyProfile(metadataPath, entry.id, entry);
      changed = true;
    }
  }
  return changed;
}

function loadRoleItems(metadataPath, roleFolder) {
  const items = [];
  for (const folderName of listRoleCompanyIds(metadataPath, roleFolder)) {
    const id = /^\d+$/.test(folderName) ? Number(folderName) : folderName;
    const entry = buildMergedEntry(metadataPath, roleFolder, id);
    if (entry) {
      items.push(entry);
    }
  }

  pruneInvalidCompanyChildLinks(metadataPath, items);

  return items.sort((a, b) =>
    getTitleForSort(a.title).localeCompare(getTitleForSort(b.title)),
  );
}

function loadRoleItemById(metadataPath, roleFolder, companyId) {
  return buildMergedEntry(metadataPath, roleFolder, companyId);
}

function saveRoleItem(metadataPath, roleFolder, entry) {
  const companyId = normalizeId(entry.id);
  if (companyId == null) return;

  const profile = extractCompanyProfile(entry, companyId);
  const existingProfile = loadCompanyProfile(metadataPath, companyId);
  saveCompanyProfile(
    metadataPath,
    companyId,
    existingProfile ? mergeCompanyProfiles(existingProfile, profile) : profile,
  );
  saveRoleGames(metadataPath, roleFolder, companyId, entry.games || []);
}

function removeChildLinksFromCompanies(metadataPath, companyId) {
  const companyDir = path.join(metadataPath, "content", COMPANIES_FOLDER);
  if (!fs.existsSync(companyDir)) return;
  for (const folderName of fs.readdirSync(companyDir, { withFileTypes: true })) {
    if (!folderName.isDirectory()) continue;
    const id = /^\d+$/.test(folderName.name) ? Number(folderName.name) : folderName.name;
    const profile = loadCompanyProfile(metadataPath, id);
    if (!profile) continue;
    const before = Array.isArray(profile.childs) ? profile.childs : [];
    const after = before.filter((childId) => String(childId) !== String(companyId));
    if (after.length !== before.length) {
      profile.childs = after;
      saveCompanyProfile(metadataPath, id, profile);
    }
  }
}

function deleteCompanyIfOrphaned(metadataPath, companyId) {
  if (roleLinkExists(metadataPath, "developers", companyId)) return false;
  if (roleLinkExists(metadataPath, "publishers", companyId)) return false;

  const companyDir = getCompanyDir(metadataPath, companyId);
  const metaPath = getCompanyMetadataPath(metadataPath, companyId);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  if (fs.existsSync(companyDir)) {
    for (const fileName of fs.readdirSync(companyDir)) {
      const filePath = path.join(companyDir, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }
    removeDirectoryIfEmpty(companyDir);
  }
  return true;
}

function deleteRoleItem(metadataPath, roleFolder, companyId) {
  const roleDir = getRoleDir(metadataPath, roleFolder, companyId);
  const metaPath = getRoleMetadataPath(metadataPath, roleFolder, companyId);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  if (fs.existsSync(roleDir)) {
    removeDirectoryIfEmpty(roleDir);
    if (fs.existsSync(roleDir)) {
      fs.rmSync(roleDir, { recursive: true, force: true });
    }
  }
  if (deleteCompanyIfOrphaned(metadataPath, companyId)) {
    removeChildLinksFromCompanies(metadataPath, companyId);
  }
}

function ensureCompanyRoleEntry(metadataPath, roleFolder, companyId, profilePatch = {}, options = {}) {
  const normalizedId = normalizeId(companyId);
  if (normalizedId == null) return null;

  let profile = loadCompanyProfile(metadataPath, normalizedId);
  if (!profile) {
    profile = extractCompanyProfile(profilePatch, normalizedId);
    if (!profile.title) return null;
    saveCompanyProfile(metadataPath, normalizedId, profile);
  } else if (Object.keys(profilePatch).length > 0) {
    const merged = options.fillGapsOnly
      ? mergeParentCompanyProfiles(profile, profilePatch)
      : mergeCompanyProfiles(profile, profilePatch);
    saveCompanyProfile(metadataPath, normalizedId, merged);
    profile = loadCompanyProfile(metadataPath, normalizedId);
  }

  if (!roleLinkExists(metadataPath, roleFolder, normalizedId)) {
    saveRoleGames(metadataPath, roleFolder, normalizedId, []);
  }

  return buildMergedEntry(metadataPath, roleFolder, normalizedId);
}

function getCompanyContentDir(metadataPath, companyId) {
  return getCompanyDir(metadataPath, companyId);
}

function hasLocalCompanyCover(metadataPath, companyId) {
  return fs.existsSync(path.join(getCompanyDir(metadataPath, companyId), "cover.webp"));
}

function addChildToRoleItem(metadataPath, roleFolder, parentId, childId) {
  const items = loadRoleItems(metadataPath, roleFolder);
  const parent = findById(items, parentId);
  const child = findById(items, childId);
  if (!parent || !child) return false;
  const normalizedChildId = normalizeId(child.id);
  const childs = normalizeChildIds(parent.childs, parent.id);
  if (childs.some((id) => String(id) === String(normalizedChildId))) return false;
  parent.childs = [...childs, normalizedChildId];
  saveRoleItem(metadataPath, roleFolder, parent);
  return true;
}

function removeChildFromRoleItem(metadataPath, roleFolder, parentId, childId) {
  const items = loadRoleItems(metadataPath, roleFolder);
  const parent = findById(items, parentId);
  if (!parent) return false;
  const before = normalizeChildIds(parent.childs, parent.id);
  const after = before.filter((id) => String(id) !== String(normalizeId(childId)));
  if (after.length === before.length) return false;
  parent.childs = after;
  saveRoleItem(metadataPath, roleFolder, parent);
  return true;
}

function unlinkChildFromOtherParents(metadataPath, roleFolder, childId, keepParentId) {
  const normalizedChildId = normalizeId(childId);
  const normalizedKeepParentId = normalizeId(keepParentId);
  if (normalizedChildId == null || normalizedKeepParentId == null) return;

  const items = loadRoleItems(metadataPath, roleFolder);
  for (const item of items) {
    if (String(item.id) === String(normalizedKeepParentId)) continue;
    const childs = Array.isArray(item.childs) ? item.childs : [];
    if (!childs.some((id) => String(id) === String(normalizedChildId))) continue;
    removeChildFromRoleItem(metadataPath, roleFolder, item.id, normalizedChildId);
  }
}

/** Child ids that still have a role link in the same folder (orphan prune is per-role). */
function childIdsLinkedInRole(metadataPath, roleFolder, childIds, parentId) {
  return normalizeChildIds(childIds, parentId).filter((id) =>
    roleLinkExists(metadataPath, roleFolder, id),
  );
}

function removeChildIdFromInMemoryItems(items, removedId) {
  if (!items || !Array.isArray(items)) return;
  const removedKey = String(normalizeId(removedId));
  for (const item of items) {
    if (!Array.isArray(item.childs)) continue;
    const next = item.childs.filter((id) => String(id) !== removedKey);
    if (next.length !== item.childs.length) {
      item.childs = next;
    }
  }
}

function pruneOrphanRoleItems(metadataPath, roleFolder, items) {
  if (!items || !Array.isArray(items)) return;
  let removedSomething = true;
  while (removedSomething) {
    pruneInvalidCompanyChildLinks(metadataPath, items);
    removedSomething = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const games = Array.isArray(item.games) ? item.games : [];
      if (games.length > 0) continue;
      const childsInRole = childIdsLinkedInRole(metadataPath, roleFolder, item.childs, item.id);
      if (childsInRole.length > 0) continue;
      if (hasLocalCompanyCover(metadataPath, item.id)) continue;
      const removedId = item.id;
      deleteRoleItem(metadataPath, roleFolder, removedId);
      items.splice(i, 1);
      removeChildIdFromInMemoryItems(items, removedId);
      removedSomething = true;
    }
  }
}

function removeGameFromAllRoleItems(metadataPath, roleFolder, gameId, updateCacheCallback, cache) {
  const items = cache && Array.isArray(cache) ? cache : loadRoleItems(metadataPath, roleFolder);
  let count = 0;

  for (const item of items) {
    const games = item.games || [];
    const idx = games.findIndex((g) => Number(g) === Number(gameId));
    if (idx !== -1) {
      games.splice(idx, 1);
      item.games = games;
      saveRoleItem(metadataPath, roleFolder, item);
      count++;
      if (updateCacheCallback) updateCacheCallback(item);
    }
  }

  pruneOrphanRoleItems(metadataPath, roleFolder, items);

  return count;
}

/**
 * Ensure the parent exists in the same role and link the child under it (parent.childs).
 * Parent reference comes from IGDB during import only; it is not stored on the child profile.
 */
function linkCompanyUnderParent(metadataPath, roleFolder, childId, parentRef, options = {}) {
  if (!isCompanyRoleFolder(roleFolder) || childId == null || !parentRef || parentRef.id == null) {
    return false;
  }

  const parentId = normalizeId(parentRef.id);
  const normalizedChildId = normalizeId(childId);
  if (parentId == null || normalizedChildId == null || String(parentId) === String(normalizedChildId)) {
    return false;
  }

  const parentName =
    typeof parentRef.name === "string" && parentRef.name.trim()
      ? parentRef.name.trim()
      : String(parentId);

  const parentProfilePatch =
    options.parentProfilePatch && typeof options.parentProfilePatch === "object"
      ? options.parentProfilePatch
      : null;
  const existingParent = loadCompanyProfile(metadataPath, parentId);
  const patch = {
    title: parentName,
    ...(parentProfilePatch || {}),
  };
  if (!patch.title) patch.title = parentName;

  ensureCompanyRoleEntry(metadataPath, roleFolder, parentId, patch, {
    fillGapsOnly: Boolean(existingParent && parentProfilePatch),
  });

  if (!roleLinkExists(metadataPath, roleFolder, normalizedChildId)) {
    return false;
  }

  unlinkChildFromOtherParents(metadataPath, roleFolder, normalizedChildId, parentId);
  return addChildToRoleItem(metadataPath, roleFolder, parentId, normalizedChildId);
}

module.exports = {
  COMPANIES_FOLDER,
  isCompanyRoleFolder,
  otherRoleFolder,
  getCompanyDir,
  getCompanyMetadataPath,
  getRoleDir,
  getRoleMetadataPath,
  getCompanyContentDir,
  loadRoleItems,
  loadRoleItemById,
  saveRoleItem,
  deleteRoleItem,
  ensureCompanyRoleEntry,
  hasLocalCompanyCover,
  mergeParentCompanyProfiles,
  removeGameFromAllRoleItems,
  pruneOrphanRoleItems,
  addChildToRoleItem,
  removeChildFromRoleItem,
  unlinkChildFromOtherParents,
  linkCompanyUnderParent,
  migrateLegacyRoleMetadata,
  isLegacyRoleMetadata,
};
