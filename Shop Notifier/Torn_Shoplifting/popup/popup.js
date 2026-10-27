import { ALERT_KEYS, MSG } from '../shared/constants.js';

const SHOP_LOG_KEY = 'torn_shoplifting_alerts_v1';
const SHOP_ENABLED_KEY = 'shopliftingWatchEnabled';
const $ = (id) => document.getElementById(id);

let filter = 'all';
let state = {};

/* ---------- helpers ---------- */
function parseLog(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function flash(msg, cls) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback ' + (cls || '');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ''; el.className = 'feedback'; }, 2500);
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/* ---------- state ---------- */
async function loadState() {
  state = (await chrome.storage.local.get(null)) || {};
}

async function saveMany(obj) {
  await chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) state[k] = v;
}

/* ---------- alerts ---------- */
/* Extract player ID from existing Bazaar alert text (including older alerts). */
function bazaarProfileUrl(alert) {
  if (alert.kind !== 'bazaar') return null;
  const match = String(alert.text || '').match(/\((\d{1,12})\)\s+has\b/i);
  if (!match) return null;
  return `https://www.torn.com/profiles.php?XID=${match[1]}`;
}

function allAlerts() {
  const mug    = parseLog(state[ALERT_KEYS.mug]).map((a) => ({ ...a, kind: 'mug' }));
  const drug   = parseLog(state[ALERT_KEYS.drug]).map((a) => ({ ...a, kind: 'drug' }));
  const bazaar = parseLog(state[ALERT_KEYS.bazaar]).map((a) => ({ ...a, kind: 'bazaar' }));
  const shop = parseLog(state[SHOP_LOG_KEY]).map((a) => ({ ...a, kind: 'shop' }));
  return [...mug, ...drug, ...bazaar, ...shop].sort((a, b) => (b.time || 0) - (a.time || 0));
}

function updateCounts(all) {
  const set = (id, n) => {
    const el = $(id);
    if (!el) return;
    el.textContent = n > 0 ? String(n) : '';
    el.classList.toggle('show', n > 0);
  };
  set('count-all',    all.filter((a) => !a.read).length);
  set('count-mug',    all.filter((a) => !a.read && a.kind === 'mug').length);
  set('count-drug',   all.filter((a) => !a.read && a.kind === 'drug').length);
  set('count-bazaar', all.filter((a) => !a.read && a.kind === 'bazaar').length);
  set('count-shop', all.filter((a) => !a.read && a.kind === 'shop').length);
}

function renderAlerts() {
  const list = $('alert-list');
  if (!list) return;

  const all = allAlerts();
  updateCounts(all);

  const shown = filter === 'all' ? all : all.filter((a) => a.kind === filter);

  if (!shown.length) {
    list.innerHTML = `<div class="alert-empty">No ${filter === 'all' ? '' : filter + ' '}alerts yet.</div>`;
    return;
  }

  list.innerHTML = shown.map((a) => {
    const profileUrl = a.kind === 'shop' ? 'https://www.torn.com/loader.php?sid=crimes#/shoplifting' : bazaarProfileUrl(a);
    return `
    <div class="alert-item ${a.read ? 'read' : 'unread'}" data-id="${escapeHtml(String(a.id))}" data-kind="${a.kind}" ${profileUrl ? `data-profile-url="${escapeHtml(profileUrl)}" title="Open player profile" role="link" tabindex="0" style="cursor:pointer"` : ''}>
      <div class="alert-dot ${a.kind}"></div>
      <div class="alert-body">
        <div class="alert-text">${escapeHtml(a.text || '')}${profileUrl ? ' ↗' : ''}</div>
        <div class="alert-time">${escapeHtml(fmtTime(a.time))}</div>
      </div>
      <button class="alert-read" title="Mark read">✓</button>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.alert-item').forEach((el) => {
    async function activate() {
      const url = el.dataset.profileUrl;
      if (url) {
        try {
          await chrome.tabs.create({ url });
        } catch (err) {
          console.error('[popup] failed to open profile:', err);
          flash('Could not open player profile.', 'err');
          return;
        }
      }
      await markRead(el.dataset.kind, el.dataset.id);
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.alert-read')) return;
      activate();
    });
    if (el.dataset.profileUrl) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    }
    el.querySelector('.alert-read')?.addEventListener('click', (e) => {
      e.stopPropagation();
      markRead(el.dataset.kind, el.dataset.id);
    });
  });
}

async function markRead(kind, id) {
  const key = kind === 'shop' ? SHOP_LOG_KEY : ALERT_KEYS[kind];
  if (!key) return;
  const log = parseLog(state[key]);
  const a = log.find((x) => String(x.id) === String(id));
  if (!a || a.read) return;
  a.read = true;
  await saveMany({ [key]: JSON.stringify(log) });
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  renderAlerts();
}

async function markAllRead() {
  const mug    = parseLog(state[ALERT_KEYS.mug]);
  const drug   = parseLog(state[ALERT_KEYS.drug]);
  const bazaar = parseLog(state[ALERT_KEYS.bazaar]);
  const shop = parseLog(state[SHOP_LOG_KEY]);
  let changed = false;
  for (const a of mug)    if (!a.read) { a.read = true; changed = true; }
  for (const a of drug)   if (!a.read) { a.read = true; changed = true; }
  for (const a of bazaar) if (!a.read) { a.read = true; changed = true; }
  for (const a of shop) if (!a.read) { a.read = true; changed = true; }
  if (!changed) return flash('Nothing to mark.', '');
  await saveMany({
    [ALERT_KEYS.mug]:    JSON.stringify(mug),
    [ALERT_KEYS.drug]:   JSON.stringify(drug),
    [ALERT_KEYS.bazaar]: JSON.stringify(bazaar),
    [SHOP_LOG_KEY]: JSON.stringify(shop),
  });
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  renderAlerts();
  flash('All marked read.', 'ok');
}

async function clearAll() {
  if (!confirm('Clear all alerts?')) return;
  await saveMany({
    [ALERT_KEYS.mug]:    '[]',
    [ALERT_KEYS.drug]:   '[]',
    [ALERT_KEYS.bazaar]: '[]',
    [SHOP_LOG_KEY]: '[]',
  });
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  renderAlerts();
  flash('Cleared.', 'ok');
}

async function recheckNow() {
  const tabs = await chrome.tabs.query({ url: 'https://www.torn.com/*' });
  if (!tabs.length) return flash('Open a Torn tab first.', 'err');
  const type = MSG?.RECHECK_NOW || 'recheckNow';
  await Promise.all(
    tabs.map((t) => chrome.tabs.sendMessage(t.id, { type }).catch(() => {}))
  );
  flash(`Rechecked ${tabs.length} tab(s).`, 'ok');
}

/* ---------- wiring ---------- */
function wire() {
  $('open-options') && ($('open-options').onclick = () => chrome.runtime.openOptionsPage());
  $('mark-all')     && ($('mark-all').onclick     = markAllRead);
  $('clear-all')    && ($('clear-all').onclick    = clearAll);
  $('recheck')      && ($('recheck').onclick      = recheckNow);

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter || 'all';
      document.querySelectorAll('.filter-btn').forEach((b) =>
        b.classList.toggle('active', b === btn));
      renderAlerts();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    for (const [k, v] of Object.entries(changes)) {
      state[k] = v.newValue;
      if (k === ALERT_KEYS.mug || k === ALERT_KEYS.drug || k === ALERT_KEYS.bazaar || k === SHOP_LOG_KEY) dirty = true;
    }
    if (dirty) renderAlerts();
  });

  loadState().then(renderAlerts);
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', wire)
  : wire();