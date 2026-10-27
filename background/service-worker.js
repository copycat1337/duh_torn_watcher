import alarmsModule from '../modules/alarms/index.js';
import { loadConfig, migrateLegacy } from '../shared/storage.js';
import { MSG, ALERT_KEYS } from '../shared/constants.js';

const modules = [alarmsModule];

// Ensure the tick alarm always exists, regardless of how the SW was woken.
// chrome.alarms.create is idempotent for the same name.
try {
  chrome.alarms.create('torn-suite-tick', { periodInMinutes: 1 });
} catch (e) {
  console.warn('[sw] failed to create tick alarm:', e);
}

let readyPromise = (async () => {
  await migrateLegacy();
  await loadConfig();
  for (const m of modules) {
    try {
      await m.init?.();
    } catch (e) {
      console.error('[sw] init fail', e);
    }
  }
})();

// Notify + badge refresh from content scripts and popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    // Make sure config/alarms module are ready before handling anything.
    await readyPromise;

    if (msg?.type === MSG.NOTIFY) {
      if (typeof alarmsModule.notify === 'function') {
        alarmsModule.notify(msg.title, msg.text);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'alarms module not initialized' });
      }
      return;
    }

    // Content script already wrote the alert log. Do NOT re-write it.
    if (msg?.type === MSG.ALERT_APPEND) {
      await refreshBadge();
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === MSG.REFRESH_BADGE) {
      await refreshBadge();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false });
  })().catch((e) => {
    try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch {}
  });

  return true; // async sendResponse
});

// Count unread alerts across ALL alert logs and set badge text accordingly.
async function refreshBadge() {
  const cfg = await loadConfig();
  const enabled = cfg['general.notifications.badgeEnabled'] !== false;
  if (!enabled) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const keys = Object.values(ALERT_KEYS);
  const obj = await chrome.storage.local.get(keys);

  let unread = 0;
  for (const k of keys) {
    let log = obj[k];
    try {
      log = typeof log === 'string' ? JSON.parse(log) : log;
    } catch {
      log = [];
    }
    if (Array.isArray(log)) {
      // Treat missing `read` as unread=false? No: new alerts set read:false.
      // For legacy entries without `read`, count them as unread (matches
      // prior behavior). Explicitly: unread when read !== true.
      unread += log.filter((a) => a && a.read !== true).length;
    }
  }

  await chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } catch {}
}

// Repeating alarm -> tell all Torn tabs to re-check.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'torn-suite-tick') return;
  const tabs = await chrome.tabs.query({
    url: ['https://www.torn.com/*', 'https://torn.com/*'],
  });
  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs
        .sendMessage(tab.id, { type: MSG.RECHECK_NOW })
        .catch(() => {})
    )
  );
});

// Update the badge whenever an alert log OR the badge setting changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);

  const alertKeys = new Set(Object.values(ALERT_KEYS));
  const alertChanged = keys.some((k) => alertKeys.has(k));

  // Also react to the badge setting itself.
  const badgeSettingChanged = keys.includes('cfg.general.notifications.badgeEnabled');

  if (alertChanged || badgeSettingChanged) {
    refreshBadge().catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('torn-suite-tick', { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('torn-suite-tick', { periodInMinutes: 1 });
});