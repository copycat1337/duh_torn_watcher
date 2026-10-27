// Background-only Shoplifting Watch. Never starts in content scripts.
const STATE_KEY = 'torn_shoplifting_status_v1';
export const LOG_KEY = 'torn_shoplifting_alerts_v1';
export const ENABLE_KEY = 'shopliftingWatchEnabled';
const URL = 'https://www.torn.com/loader.php?sid=crimes#/shoplifting';
const TARGETS = {
  pharmacy: { name: 'Pharmacy', camera: 3, checkpoint: true, guards: 0 },
  cyber: { name: 'Cyber Force', camera: 2, checkpoint: false, guards: 1 },
  jewelry: { name: 'Jewelry Store', camera: 3, checkpoint: false, guards: 1 },
  bigal: { name: "Big Al's Gun Shop", camera: 4, checkpoint: false, guards: 2 },
};
let busy = false;

// The API returns shop id + titles such as 'Three cameras' and 'One guard',
// not shop names. Identify requested shops from their unique security layouts.
function cameraCount(title) {
  const m = String(title).toLowerCase().match(/\b(one|two|three|four)\s+cameras?\b/);
  return m ? ({ one:1, two:2, three:3, four:4 })[m[1]] : 0;
}
function guardCount(title) {
  const m = String(title).toLowerCase().match(/\b(one|two)\s+guards?\b/);
  return m ? ({ one:1, two:2 })[m[1]] : 0;
}
function identify(statuses) {
  const camera = statuses.reduce((n, s) => n + cameraCount(s.title), 0);
  const guards = statuses.reduce((n, s) => n + guardCount(s.title), 0);
  const checkpoint = statuses.some(s => /checkpoint/i.test(s.title));
  return Object.entries(TARGETS).find(([, x]) => x.camera === camera && x.guards === guards && x.checkpoint === checkpoint)?.[0];
}
function collect(data) {
  if (!Array.isArray(data?.shoplifting)) throw new Error('Unexpected Torn shoplifting response');
  const found = {};
  for (const shop of data.shoplifting) {
    if (!Array.isArray(shop.status) || !shop.status.length) continue;
    const key = identify(shop.status);
    if (!key || found[key]) continue;
    if (!shop.status.every(s => typeof s.title === 'string' && typeof s.disabled === 'boolean')) continue;
    found[key] = Object.fromEntries(shop.status.map(s => [s.title, s.disabled]));
  }
  return found;
}
function events(before, after) {
  const result = [];
  for (const [key, statuses] of Object.entries(after)) {
    const prior = before[key];
    if (!prior) continue; // First observation establishes baseline; no alert storm.
    const newlyDisabled = Object.keys(statuses).filter(s => statuses[s] && prior[s] === false);
    for (const security of newlyDisabled) result.push({key, title:'🔓 Shop security down', text:`${TARGETS[key].name}: ${security} disabled`});
    const wasAll = Object.keys(prior).length > 0 && Object.values(prior).every(Boolean);
    const isAll = Object.keys(statuses).length > 0 && Object.values(statuses).every(Boolean);
    if (isAll && !wasAll) result.push({key, title:'🚨 All security down', text:`${TARGETS[key].name}: ALL security disabled!`});
  }
  return result;
}
async function recordAndNotify(event) {
  const data = await chrome.storage.local.get(LOG_KEY);
  const raw = data[LOG_KEY];
  let history;
  try { history = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { history = []; }
  if (!Array.isArray(history)) history = [];
  const entry = { id:`shop_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, time:Date.now(), kind:'shop', text:event.text, url:URL, read:false };
  history.push(entry);
  await chrome.storage.local.set({ [LOG_KEY]: JSON.stringify(history.slice(-500)) });
  const notificationId = `torn-shop-${entry.id}`;
  try {
    await chrome.notifications.create(notificationId, {
      type:'basic', iconUrl:chrome.runtime.getURL('assets/icons/icon128.png'),
      title:event.title, message:event.text + ' — Click to open Shoplifting'
    });
  } catch(e) { console.warn('[shoplifting] desktop notification failed:', e); }
}

export async function checkShoplifting(config) {
  if (busy) return;
  busy = true;
  try {
    const setting = await chrome.storage.local.get(ENABLE_KEY);
    if (setting[ENABLE_KEY] === false) return;
    const key = config?.['api.general.apiKey'];
    if (!key) { console.warn('[shoplifting] missing API key'); return; }
    const resp = await fetch('https://api.torn.com/v2/torn/shoplifting?key=' + encodeURIComponent(key));
    if (!resp.ok) throw new Error('Torn HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error('Torn API error ' + data.error.code + ': ' + data.error.error);
    const current = collect(data);
    if (Object.keys(current).length !== 4) {
      console.warn('[shoplifting] expected 4 matching stores, got', Object.keys(current), '- refusing partial-state update');
      return;
    }
    const old = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
    const changes = events(old, current);
    // Commit before notifications, so worker restarts cannot replay the same state change.
    await chrome.storage.local.set({[STATE_KEY]: current});
    for (const event of changes) await recordAndNotify(event);
  } catch(e) {
    console.warn('[shoplifting] poll failed:', e);
  } finally { busy = false; }
}

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith('torn-shop-')) return;
  chrome.tabs.create({url: URL}).catch(e => console.warn('[shoplifting] open failed:', e));
  chrome.notifications.clear(id).catch(() => {});
});
