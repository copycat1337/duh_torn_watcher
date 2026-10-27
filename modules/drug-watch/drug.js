import { apiGet, safeSendMessage, appendAlert } from '../../shared/content-env.js';
import { SOUNDS, playSound } from '../../shared/sound.js';
import { ALERT_KINDS, ALERT_KEYS, MSG } from '../../shared/constants.js';

const ERR_INVALID_KEY = 2, ERR_KEY_PAUSED = 16, ERR_KEY_DISABLED = 17;

const DRUG_ITEMS = {
  'Xanax': 206, 'Ecstasy': 366, 'Ketamine': 522, 'Cannabis': 752,
  'Opium': 753, 'Speed': 754, 'PCP': 755, 'LSD': 756, 'Shrooms': 757,
};
const DRUG_NAME_TO_ID = {};
for (const [n, i] of Object.entries(DRUG_ITEMS)) DRUG_NAME_TO_ID[n.toLowerCase()] = i;

const LAST_POLL_KEY     = 'torn_drug_last_poll_v7';
const DRUG_SNAPSHOT_KEY = 'torn_drug_snapshot_v7';

function parseWatched(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

export function createDrugModule({ getConfig }) {
  let snapshot = { items: {}, timestamp: 0 };
  try {
    const raw = localStorage.getItem('tornSuite_' + DRUG_SNAPSHOT_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') {
      if (obj.items && typeof obj.items === 'object')
        snapshot = { items: obj.items, timestamp: obj.timestamp || 0 };
      else snapshot = { items: obj, timestamp: 0 };
    }
  } catch {}

  let intervalHandle = null;
  let consecutiveErrors = 0;
  let fatalError = false;
  let checkInProgress = false; // Prevent concurrent polling from duplicating alerts

  async function fetchDrugs(apiKey) {
    const { status, data, raw } = await apiGet(
      `https://api.torn.com/v2/faction/inventory?cat=drugs&limit=50&offset=0&key=${encodeURIComponent(apiKey)}`);
    if (status === 0) return { ok: false, fatal: false, reason: 'Network error' };
    if (!data)        return { ok: false, fatal: false, reason: `HTTP ${status}: non-JSON. Raw: ${(raw || '').slice(0, 120)}` };
    if (data.error) {
      const code = data.error.code;
      const msg  = data.error.error || `code ${code}`;
      if ([ERR_INVALID_KEY, ERR_KEY_PAUSED, ERR_KEY_DISABLED].includes(code))
        return { ok: false, fatal: true, reason: `API key problem (${code}): ${msg}` };
      return { ok: false, fatal: false, reason: `Drug API error (${code}): ${msg}` };
    }

    let items = data.inventory ?? data.items ?? data.drugs ?? [];
    if (!Array.isArray(items) && typeof items === 'object')
      items = Object.entries(items).map(([k, v]) => ({ id: k, ...v }));

    const normalized = items.map((it) => {
      const id = parseInt(it.id ?? it.item_id ?? it.ID ?? it.itemId);
      let name = it.name ?? it.item_name ?? it.itemName ?? '';
      if (!name) {
        const known = Object.entries(DRUG_ITEMS).find(([, v]) => v === id);
        if (known) name = known[0];
      }
      const qty = parseInt(it.quantity ?? it.qty ?? it.amount ?? it.count ?? 0);
      return { id, name, quantity: isNaN(qty) ? 0 : qty };
    }).filter((it) => !isNaN(it.id));

    return { ok: true, items: normalized };
  }

  function diff(newItems) {
    const enabled = !!getConfig('notifications.xanax-watch.enabled');
    const watched = new Set(parseWatched(getConfig('notifications.xanax-watch.drugsWatched')));

    const alerts = [];
    const newMap = {};

    for (const it of newItems) {
      newMap[it.id] = it.quantity;

      let isWatched = watched.has(it.id);
      if (!isWatched && it.name) {
        const byName = DRUG_NAME_TO_ID[it.name.toLowerCase()];
        if (byName && watched.has(byName)) {
          isWatched = true;
          newMap[byName] = it.quantity;
        }
      }
      if (!isWatched) continue;

      const before = snapshot.items[it.id] !== undefined
        ? snapshot.items[it.id]
        : snapshot.items[DRUG_NAME_TO_ID[it.name?.toLowerCase()]];

      if (before !== undefined && it.quantity < before) {
        alerts.push({
          id: it.id,
          name: it.name
            || Object.entries(DRUG_ITEMS).find(([, v]) => v === it.id)?.[0]
            || `Item #${it.id}`,
          used: before - it.quantity,
          remaining: it.quantity,
          before,
        });
      }
    }

    snapshot = { items: newMap, timestamp: Date.now() };
    try {
      localStorage.setItem('tornSuite_' + DRUG_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {}

    if (!enabled || !watched.size) return [];
    return alerts;
  }

  function fireAlert(title, text, { log = true } = {}) {
    if (log) appendAlert(ALERT_KINDS.DRUG, text, ALERT_KEYS.drug);
    safeSendMessage({ type: MSG.NOTIFY, title, text });
    if (getConfig('general.notifications.soundEnabled')) {
      const volume = (parseInt(getConfig('general.notifications.volumeDrug')) || 25) / 100;
      playSound(SOUNDS.drug, volume);
    }
  }

  async function check(force = false) {
    if (checkInProgress) return;
    checkInProgress = true;
    try {
    if (fatalError && !force) return;
    const apiKey = getConfig('api.general.apiKey');
    if (!apiKey) return;
    if (consecutiveErrors >= 3 && !force && Math.random() < 0.66) return;

    localStorage.setItem('tornSuite_' + LAST_POLL_KEY, String(Date.now()));
    const res = await fetchDrugs(apiKey);

    if (res.ok) {
      consecutiveErrors = 0;
      const alerts = diff(res.items);
      for (const a of alerts) {
        fireAlert(
          '💊 Faction Drug Alert',
          `💊 ${a.name} used: ${a.used} taken (was ${a.before}, now ${a.remaining})`
        );
      }
    } else if (res.fatal) {
      fatalError = true;
      fireAlert('💊 Drug Watch stopped', `❌ ${res.reason}`, { log: false });
      if (intervalHandle) clearInterval(intervalHandle);
      intervalHandle = null;
    } else {
      consecutiveErrors++;
    }
    } finally {
      checkInProgress = false;
    }
  }

  function start() {
    if (intervalHandle) clearInterval(intervalHandle);
    const cfgSecs = parseInt(getConfig('api.general.checkInterval')) || 30;
    const secs = Math.min(120, Math.max(15, cfgSecs));
    intervalHandle = setInterval(() => {
      try { check(); } catch (e) { console.warn('[drug] tick failed:', e); }
    }, secs * 1000);
    check();
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  }

  return { start, stop, check };
}
export default createDrugModule; 