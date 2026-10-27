// shared/storage.js
// Promise-based config store backed by chrome.storage.local.
// All keys are namespaced with STORAGE_PREFIX ("cfg.") so raw values
// never collide with legacy keys or other extension data.

import {
  buildDefaults,
  STORAGE_PREFIX,
  getFieldDef,
  coerceValue,
  LEGACY_KEY_PRECEDENCE,
} from './config.js';

const MIGRATION_FLAG = 'cfg_migrated_v1';

/**
 * In-memory mirror of the config. Populated by loadConfig().
 */
let cache = null;
let loadPromise = null;

function unprefix(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith(STORAGE_PREFIX)) out[k.slice(STORAGE_PREFIX.length)] = v;
  }
  return out;
}

function assertKnownPath(path) {
  if (!getFieldDef(path)) {
    console.warn(`[storage] unknown config path "${path}" (not in DEFAULT_CONFIG)`);
  }
}

/**
 * Load config from chrome.storage.local, merging over built-in defaults.
 * Coerces every stored value through the schema so callers always get
 * type-correct values. Concurrent callers share one in-flight promise.
 */
export async function loadConfig() {
  if (cache) return cache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const all = await chrome.storage.local.get(null);
    const stored = unprefix(all);
    const defaults = buildDefaults();
    const merged = { ...defaults };

    for (const [path, raw] of Object.entries(stored)) {
      // Coerce against the schema; unknown paths are kept as-is so
      // forward-compat values from a newer build aren't dropped.
      merged[path] = getFieldDef(path) ? coerceValue(path, raw) : raw;
    }

    cache = merged;
    return cache;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getConfigSync() {
  return cache || buildDefaults();
}

/**
 * Read a single config value (async), coerced through the schema.
 */
export async function getConfig(path) {
  const cfg = await loadConfig();
  const def = getFieldDef(path);
  const raw = cfg[path];
  return def ? coerceValue(path, raw) : raw;
}

/**
 * Write a single config value. Coerces first; updates the cache only
 * after the storage write succeeds, so cache can't diverge on failure.
 */
export async function setConfig(path, value) {
  assertKnownPath(path);
  const def = getFieldDef(path);
  const coerced = def ? coerceValue(path, value) : value;

  await chrome.storage.local.set({ [STORAGE_PREFIX + path]: coerced });

  if (!cache) cache = buildDefaults();
  cache[path] = coerced;
}

/**
 * Write many config values in one round-trip. Coerces each.
 */
export async function setMany(pathsToValues) {
  const payload = {};
  const coercedEntries = [];

  for (const [path, value] of Object.entries(pathsToValues)) {
    assertKnownPath(path);
    const def = getFieldDef(path);
    const coerced = def ? coerceValue(path, value) : value;
    payload[STORAGE_PREFIX + path] = coerced;
    coercedEntries.push([path, coerced]);
  }

  await chrome.storage.local.set(payload);

  if (!cache) cache = buildDefaults();
  for (const [path, coerced] of coercedEntries) cache[path] = coerced;
}

/**
 * One-time migration from old flat key names to cfg.* namespaced keys.
 *
 * - Uses LEGACY_KEY_PRECEDENCE so multiple legacy keys targeting the same
 *   new path resolve deterministically (first existing wins).
 * - Never overwrites a cfg.* key the user has already set.
 * - Removes the legacy keys after copying.
 */
export async function migrateLegacy() {
  const flag = await chrome.storage.local.get(MIGRATION_FLAG);
  if (flag[MIGRATION_FLAG]) return;

  const all = await chrome.storage.local.get(null);
  const updates = {};
  const consumedLegacyKeys = [];

  // Group legacy keys by target path, preserving precedence order.
  const byTarget = new Map();
  for (const [oldKey, newPath] of LEGACY_KEY_PRECEDENCE) {
    if (!byTarget.has(newPath)) byTarget.set(newPath, []);
    byTarget.get(newPath).push(oldKey);
  }

  for (const [newPath, oldKeys] of byTarget.entries()) {
    const newKey = STORAGE_PREFIX + newPath;

    // Don't clobber an already-configured new key.
    if (all[newKey] !== undefined) {
      // Still consume the legacy keys so they don't linger.
      for (const k of oldKeys) if (all[k] !== undefined) consumedLegacyKeys.push(k);
      continue;
    }

    // First existing legacy key wins (precedence order).
    let value;
    let found = false;
    for (const oldKey of oldKeys) {
      if (all[oldKey] !== undefined) {
        value = all[oldKey];
        found = true;
        break;
      }
    }
    if (!found) continue;

    // Normalize drugsWatched (old shape: JSON array or number).
    if (newPath === 'notifications.xanax-watch.drugsWatched') {
      try {
        const arr = typeof value === 'string' ? JSON.parse(value) : value;
        if (Array.isArray(arr)) value = arr.join(',');
        else if (typeof arr === 'number') value = String(arr);
      } catch {
        // leave as-is; module coerces
      }
    }

    // Coerce to the schema's expected type.
    const def = getFieldDef(newPath);
    updates[newKey] = def ? coerceValue(newPath, value) : value;

    for (const k of oldKeys) if (all[k] !== undefined) consumedLegacyKeys.push(k);
  }

  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
    console.log('[storage] migrated legacy keys:', Object.keys(updates));
  }

  if (consumedLegacyKeys.length) {
    await chrome.storage.local.remove(consumedLegacyKeys);
    console.log('[storage] removed legacy keys:', consumedLegacyKeys);
  }

  await chrome.storage.local.set({ [MIGRATION_FLAG]: true });
}

/**
 * Wipe all cfg.* keys. Leaves alerts, migration flag, etc. alone.
 */
export async function resetConfig() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((k) => k.startsWith(STORAGE_PREFIX));
  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
  cache = null;
  loadPromise = null;
}

/**
 * Keep the in-memory cache in sync when any extension context writes.
 * This is the ONLY place cache is mutated after load, so cache and
 * storage cannot diverge.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !cache) return;
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    const path = k.slice(STORAGE_PREFIX.length);
    const def = getFieldDef(path);
    if (newValue === undefined) {
      delete cache[path];
      if (def) cache[path] = def.default;
    } else {
      cache[path] = def ? coerceValue(path, newValue) : newValue;
    }
  }
});