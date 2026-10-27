// Reads the alert logs from chrome.storage.local and exposes
// helpers the options page uses to list / mark-read / clear them.

import { ALERT_KEYS } from '../../shared/constants.js';

const MAX_ALERTS = 500;

// ---------------------------------------------------------------------------
// Storage representation note:
//   We do NOT know whether appendAlert() stores a raw array or a JSON string.
//   To be safe we accept both on read, and on write we preserve whichever
//   representation was already stored for that key. This prevents the
//   "double-encode -> parse fails -> log wiped" failure mode.
// ---------------------------------------------------------------------------

function parseLog(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function wasString(raw) {
  return typeof raw === 'string';
}

async function readOneRaw(key) {
  const obj = await chrome.storage.local.get(key);
  return obj[key];
}

async function readOne(key) {
  return parseLog(await readOneRaw(key));
}

// Preserve the original representation (string vs raw array) so we don't
// fight whatever appendAlert() uses.
async function writeOne(key, log, asString) {
  const trimmed = log.slice(-MAX_ALERTS);
  const value = asString ? JSON.stringify(trimmed) : trimmed;
  await chrome.storage.local.set({ [key]: value });
}

// Read + write the same key with representation preserved.
async function mutateOne(key, fn) {
  const raw = await readOneRaw(key);
  const asString = wasString(raw);
  const log = parseLog(raw);
  const next = fn(log) || log;
  await writeOne(key, next, asString);
}

// ---------------------------------------------------------------------------
// Serialization lock: prevents markAllRead/clearAll from racing appendAlert
// within THIS context. (Cross-context writes from content scripts still need
// their own care, but this at least stops the options page from self-clobbering
// and stops two quick button clicks from interleaving.)
// ---------------------------------------------------------------------------
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  // Swallow rejections in the chain so one failure doesn't poison the next.
  lockChain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------

export async function getAll() {
  const entries = Object.entries(ALERT_KEYS); // [['mug','...'],['drug','...'],...]
  const results = await Promise.all(
    entries.map(async ([kind, key]) => {
      try {
        const log = await readOne(key);
        return log.map((a) => ({ ...a, kind }));
      } catch (e) {
        console.warn(`[alerts] read failed for "${key}":`, e?.message || e);
        return [];
      }
    })
  );
  return results.flat().sort((a, b) => (b.time || 0) - (a.time || 0));
}

export async function getByKind(kind) {
  const all = await getAll();
  return all.filter((a) => a.kind === kind);
}

export async function markAllRead() {
  return withLock(async () => {
    let failed = 0;
    for (const key of Object.values(ALERT_KEYS)) {
      try {
        await mutateOne(key, (log) =>
          log.map((a) => (a.read ? a : { ...a, read: true }))
        );
      } catch (e) {
        failed++;
        console.warn(`[alerts] markAllRead failed for "${key}":`, e?.message || e);
      }
    }
    return { ok: failed === 0, failed };
  });
}

export async function clearAll() {
  return withLock(async () => {
    let failed = 0;
    for (const key of Object.values(ALERT_KEYS)) {
      try {
        // Preserve representation; just empty the array.
        const raw = await readOneRaw(key);
        await writeOne(key, [], wasString(raw));
      } catch (e) {
        failed++;
        console.warn(`[alerts] clearAll failed for "${key}":`, e?.message || e);
      }
    }
    return { ok: failed === 0, failed };
  });
}

export async function unreadCount() {
  const all = await getAll();
  return all.filter((a) => !a.read).length;
}

export default { getAll, getByKind, markAllRead, clearAll, unreadCount };