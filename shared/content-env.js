// Shared helpers that only content scripts use.
import { MSG } from './constants.js';

export function safeSendMessage(msg) {
  try {
    if (!chrome?.runtime?.id) {
      console.warn('[content-env] Extension context unavailable');
      return;
    }

    const p = chrome.runtime.sendMessage(msg);

    if (p && typeof p.catch === 'function') {
      p.catch(err => {
        console.error('[content-env] Message failed:', msg.type, err);
      });
    }
  } catch (err) {
    console.error('[content-env] Send failed:', err);
  }
}

export function safeAddRuntimeListener(fn) {
  try { chrome?.runtime?.onMessage?.addListener(fn); } catch {}
}

export function safeAddStorageListener(fn) {
  try {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener(fn);
  } catch {}
}

/**
 * GET with structured error info. Never throws.
 * Returns { status, data, raw, err, retryAfterMs }.
 * - status 0  => network/exception failure
 * - status N  => HTTP status; data is parsed body if JSON, else null
 * - retryAfterMs is populated from Retry-After (seconds or HTTP-date)
 *   or X-RateLimit-Reset where present, so callers can back off correctly.
 */
export async function apiGet(url) {
  try {
    const r = await fetch(url);

    let retryAfterMs = null;
    const ra = r.headers.get('Retry-After');
    if (ra) {
      const asNum = Number(ra);
      if (Number.isFinite(asNum)) retryAfterMs = asNum * 1000;
      else {
        const t = Date.parse(ra);
        if (Number.isFinite(t)) retryAfterMs = Math.max(0, t - Date.now());
      }
    }
    if (retryAfterMs == null) {
      const xr = r.headers.get('X-RateLimit-Reset');
      const xrNum = xr ? Number(xr) : NaN;
      if (Number.isFinite(xrNum)) {
        // Heuristic: values < 1e12 are epoch seconds, else ms.
        const resetMs = xrNum < 1e12 ? xrNum * 1000 : xrNum;
        retryAfterMs = Math.max(0, resetMs - Date.now());
      }
    }

    const raw = await r.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    return { status: r.status, data, raw, retryAfterMs };
  } catch (err) {
    return { status: 0, data: null, raw: '', err: String(err), retryAfterMs: null };
  }
}

// ---------------------------------------------------------------------------
// Alert log storage.
//
// Representation is ALWAYS a JSON string under the alertKey, matching what
// shared/alerts.js reads. All writers (this file, alerts.js) must agree.
//
// RMW is serialized within this context via a per-key promise chain so two
// appendAlert calls can't clobber each other. Cross-context races with the
// options page (markAllRead/clearAll) are NOT solved here; see note below.
// ---------------------------------------------------------------------------

const ALERT_MAX = 500;

const writeChains = new Map(); // alertKey -> Promise
function withKeyLock(key, fn) {
  const prev = writeChains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  writeChains.set(key, run.catch(() => {}));
  return run;
}

function parseLog(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendAlert(kind, text, alertKey) {
  const entry = {
    id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(),
    kind,
    text,
    read: false,
  };

  return withKeyLock(alertKey, async () => {
    let log = [];
    try {
      const obj = await chrome.storage.local.get(alertKey);
      log = parseLog(obj?.[alertKey]);
    } catch {}

    log.push(entry);
    if (log.length > ALERT_MAX) log = log.slice(-ALERT_MAX);

    let persisted = false;
    try {
      await chrome.storage.local.set({ [alertKey]: JSON.stringify(log) });
      persisted = true;
    } catch (e) {
      console.warn('[content-env] appendAlert persist failed:', e?.message || e);
    }

    // Only notify the UI if we actually wrote. Otherwise the popup would
    // show an alert that vanishes on reload.
    if (persisted) {
      safeSendMessage({ type: MSG.ALERT_APPEND, key: alertKey, value: log });
    }

    return { ok: persisted, log };
  });
}