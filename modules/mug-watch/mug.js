import { apiGet, safeSendMessage, appendAlert } from '../../shared/content-env.js';
import { SOUNDS, playSound } from '../../shared/sound.js';
import { ALERT_KINDS, ALERT_KEYS, MSG } from '../../shared/constants.js';

const ERR_INVALID_KEY = 2, ERR_RATE_LIMITED = 5, ERR_KEY_PAUSED = 16, ERR_KEY_DISABLED = 17;
const SEEN_KEY       = 'torn_mug_seen_v7';
const LAST_POLL_KEY  = 'torn_mug_last_poll_v7';
const MY_FACTION_KEY = 'torn_mug_myFactionId_v7';
const MAX_SEEN       = 500;

const DEFAULT_WATCHED = ['Mugged', 'Hospitalized'];

export function createMugModule({ getConfig }) {
  let seen = new Set();
  try {
    const raw = localStorage.getItem('tornSuite_' + SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) seen = new Set(parsed.map(String));
  } catch {}
  if (seen.size > MAX_SEEN) seen = new Set(Array.from(seen).slice(-MAX_SEEN));

  let intervalHandle = null;
  let consecutiveErrors = 0;
  let fatalError = false;
  let checkInProgress = false; // Prevent concurrent polling from duplicating alerts

  const saveSeen = () => {
    try {
      localStorage.setItem('tornSuite_' + SEEN_KEY,
        JSON.stringify(Array.from(seen).slice(-MAX_SEEN)));
    } catch {}
  };

  async function fetchMyFactionId(apiKey) {
    try {
      const { data } = await apiGet(
        `https://api.torn.com/v2/faction/basic?key=${encodeURIComponent(apiKey)}`);
      if (!data || data.error) return null;
      const id = data.basic?.id ?? data.id ?? null;
      return id != null ? String(id) : null;
    } catch (e) {
      console.warn('[mug] fetchMyFactionId failed:', e);
      return null;
    }
  }

  async function fetchIncoming(apiKey) {
    const { status, data } = await apiGet(
      `https://api.torn.com/v2/faction/attacks?filters=incoming&limit=100&sort=DESC&key=${encodeURIComponent(apiKey)}`);
    if (status === 0) return { ok: false, fatal: false, reason: 'Network error' };
    if (!data)        return { ok: false, fatal: false, reason: `HTTP ${status}: non-JSON` };
    if (data.error) {
      const code = data.error.code;
      const msg  = data.error.error || `code ${code}`;
      if ([ERR_INVALID_KEY, ERR_KEY_PAUSED, ERR_KEY_DISABLED].includes(code))
        return { ok: false, fatal: true, reason: `API key problem (${code}): ${msg}` };
      return { ok: false, fatal: false, reason: `API error (${code}): ${msg}` };
    }

    const raw = data.attacks || {};
    const attacks = Array.isArray(raw)
      ? raw
      : Object.keys(raw).map((k) => ({ id: k, ...raw[k] }));

    return { ok: true, attacks };
  }

  function fireAlert(title, text) {
    try { appendAlert(ALERT_KINDS.MUG, text, ALERT_KEYS.mug); }
    catch (e) { console.warn('[mug] appendAlert failed:', e); }
    try { safeSendMessage({ type: MSG.NOTIFY, title, text }); }
    catch (e) { console.warn('[mug] notify failed:', e); }
    if (getConfig('general.notifications.soundEnabled')) {
      try {
        const volume = (parseInt(getConfig('general.notifications.volumeMug')) || 25) / 100;
        playSound(SOUNDS.mug, volume);
      } catch (e) { console.warn('[mug] sound failed:', e); }
    }
  }

  function getWatchedResults() {
    const raw = getConfig('notifications.mug.watchResults');
    if (Array.isArray(raw) && raw.length) return raw;
    return DEFAULT_WATCHED;
  }

  function formatAttack(attack) {
    const defender = attack.defender || {};
    const attacker = attack.attacker || null;

    const defName = defender.name || `ID ${defender.id ?? '?'}`;
    const defId   = defender.id   ?? '?';
    const manner  = attack.result || 'attacked';

    const attackerText = attacker
      ? `${attacker.name || 'ID ' + attacker.id} (${attacker.id})`
      : 'a stealthed attacker (unknown)';

    const ts = attack.ended || attack.started;
    const timeStr = ts
      ? new Date(ts * 1000).toLocaleString(undefined, {
          weekday: 'short', year: 'numeric', month: 'short',
          day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : 'Unknown time';

    return {
      title: `🥊 Faction ${manner} Alert`,
      text: `🚨 ${defName} (${defId}) was ${manner} by ${attackerText} at ${timeStr}`,
    };
  }

  // Returns true if this attack is "incoming against our faction":
  // defender is a member of our faction AND attacker is not also one of us.
  // Unknown attacker faction (stealthed) counts as "not us".
  function isIncomingAgainstUs(attack, myFactionId) {
    const defFac = attack.defender?.faction?.id;
    const atkFac = attack.attacker?.faction?.id;

    const defFacStr = defFac != null ? String(defFac) : '';
    const atkFacStr = atkFac != null ? String(atkFac) : '';

    if (defFacStr !== myFactionId) return false;
    if (atkFacStr && atkFacStr === myFactionId) return false;
    return true;
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
    const res = await fetchIncoming(apiKey);

    if (!res.ok) {
      if (res.fatal) {
        fatalError = true;
        fireAlert('🥊 Mug Alert stopped', `❌ ${res.reason}`);
        if (intervalHandle) clearInterval(intervalHandle);
        intervalHandle = null;
      } else {
        consecutiveErrors++;
      }
      return;
    }

    consecutiveErrors = 0;

    let myFactionId = localStorage.getItem('tornSuite_' + MY_FACTION_KEY) || '';
    if (!myFactionId) {
      myFactionId = await fetchMyFactionId(apiKey);
      if (myFactionId) localStorage.setItem('tornSuite_' + MY_FACTION_KEY, myFactionId);
    }

    // If we still don't know our faction id, do NOT mark anything seen —
    // we'd otherwise permanently lose hits. Just bail and retry next tick.
    if (!myFactionId) {
      console.warn('[mug] my faction id unknown; skipping this tick (not marking seen)');
      return;
    }

    const watched = new Set(getWatchedResults());
    const attacks = res.attacks
      .slice()
      .sort((a, b) => (a.ended || a.started || 0) - (b.ended || b.started || 0));

    let fired = 0;
    try {
      for (const attack of attacks) {
        const id = attack.id != null ? String(attack.id) : null;
        if (!id) continue;                 // can't dedupe -> skip, don't poison seen
        if (seen.has(id)) continue;

        if (!isIncomingAgainstUs(attack, myFactionId)) {
          seen.add(id);
          continue;
        }

        // Claim this event before notifying so later checks cannot re-fire it.
        seen.add(id);
        if (watched.has(attack.result)) {
          const { title, text } = formatAttack(attack);
          fireAlert(title, text);
          fired++;
        }
      }
    } finally {
      console.log('[mug] alerts fired this tick:', fired);
      saveSeen();
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
      try { check(); } catch (e) { console.warn('[mug] tick failed:', e); }
    }, secs * 1000);
    check();
  }

  function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  }

  return { start, stop, check };
}
export default createMugModule;