import { apiGet, safeSendMessage, appendAlert } from '../../shared/content-env.js';
import { SOUNDS, playSound } from '../../shared/sound.js';
import { ALERT_KINDS, ALERT_KEYS, MSG } from '../../shared/constants.js';

const SEEN_KEY = 'torn_bazaar_seen_v8_playerkey';
const MAX_SEEN = 2000;

export function createBazaarModule({ getConfig }) {
  let seen = new Set();
  try {
    const raw = localStorage.getItem('tornSuite_' + SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      // migrate any legacy "playerId:value" strings to bare playerIds
      for (const entry of parsed) {
        const id = String(entry).split(':')[0];
        if (id) seen.add(id);
      }
    }
  } catch {}

  let intervalHandle = null;
  let consecutiveErrors = 0;

  const saveSeen = () => {
    try {
      localStorage.setItem(
        'tornSuite_' + SEEN_KEY,
        JSON.stringify(Array.from(seen).slice(-MAX_SEEN))
      );
    } catch {}
  };

  function valueOf(rec) {
    const v = parseFloat(rec?.totalMarketValue ?? 0);
    return isNaN(v) ? 0 : v;
  }

  async function fetchBazaars() {
    const maxPages = Math.max(1, parseInt(getConfig('notifications.bazaar.maxPages')) || 50);
    const minValue = parseInt(getConfig('notifications.bazaar.minTotalValue')) || 1000000;
    const all = [];
    let page = 1;

    while (page <= maxPages) {
      const url = `https://weav3r.dev/api/dollar-bazaars/bazaars?page=${page}&limit=100`;
      console.log('[bazaar] fetching page', page);
      const { status, data } = await apiGet(url);
      if (status === 0) { console.warn('[bazaar] network error'); return { ok: false, reason: 'Network error' }; }
      if (!data)        { console.warn('[bazaar] non-JSON, status', status); return { ok: false, reason: `HTTP ${status}: non-JSON` }; }
      if (data.error)   { console.warn('[bazaar] api error', data.error); return { ok: false, reason: `API error: ${data.error}` }; }

      const batch = data.bazaars || [];
      console.log('[bazaar] page', page, 'returned', batch.length, 'records');
      all.push(...batch);

      if (batch.length < 100) break;

      const lastVal = valueOf(batch[batch.length - 1]);
      if (lastVal < minValue) {
        console.log('[bazaar] early stop, last val', lastVal, '< minValue', minValue);
        break;
      }

      page++;
      await new Promise((r) => setTimeout(r, 700));
    }
    console.log('[bazaar] total fetched:', all.length);
    return { ok: true, bazaars: all };
  }

  function fireAlert(bazaar) {
    const name = bazaar.name || `Player ${bazaar.playerId}`;
    const value = valueOf(bazaar);
    const text = `🏪 ${name} (${bazaar.playerId}) has ${bazaar.itemCount} item(s) worth $${value.toLocaleString()}`;

    try { appendAlert(ALERT_KINDS.BAZAAR, text, ALERT_KEYS.bazaar); }
    catch (e) { console.warn('[bazaar] appendAlert failed:', e); }

    try { safeSendMessage({
      type: MSG.NOTIFY, title: '🏪 Bazaar Alert', text,
      url: `https://www.torn.com/profiles.php?XID=${bazaar.playerId}`
    }); }
    catch (e) { console.warn('[bazaar] notify failed:', e); }

    if (getConfig('general.notifications.soundEnabled') &&
        getConfig('notifications.bazaar.soundEnabled')) {
      try {
        const volume = (parseInt(getConfig('general.notifications.volumeBazaar')) || 25) / 100;
        playSound(SOUNDS.bazaar, volume);
      } catch (e) { console.warn('[bazaar] sound failed:', e); }
    }
  }

  async function check(force = false) {
    if (!getConfig('notifications.bazaar.enabled')) {
      console.log('[bazaar] disabled in settings');
      return;
    }
    if (consecutiveErrors >= 3 && !force && Math.random() < 0.66) return;

    const minValue = parseInt(getConfig('notifications.bazaar.minTotalValue')) || 1000000;
    console.log('[bazaar] checking with minValue', minValue);
    const res = await fetchBazaars();

    if (!res.ok) {
      consecutiveErrors++;
      console.warn('[bazaar] fetch failed:', res.reason);
      return;
    }

    consecutiveErrors = 0;

    let fired = 0;
    try {
      for (const b of res.bazaars) {
        const value = valueOf(b);
        if (value < minValue) continue;      // ignore small bazaars entirely

        const key = String(b.playerId);      // one alert per player/bazaar
        if (seen.has(key)) continue;

        fireAlert(b);
        fired++;
        seen.add(key);
      }
    } finally {
      console.log('[bazaar] alerts fired this tick:', fired);
      saveSeen();                            // always persist
    }
  }

  function start() {
    if (intervalHandle) clearInterval(intervalHandle);
    const secs = Math.max(60, parseInt(getConfig('notifications.bazaar.checkInterval')) || 300);
    intervalHandle = setInterval(() => {
      try { check(); } catch (e) { console.warn('[bazaar] tick failed:', e); }
    }, secs * 1000);
    check();
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  }

  return { start, stop, check };
}
export default createBazaarModule;