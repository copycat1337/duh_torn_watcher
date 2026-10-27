// modules/alarms/index.js
// Service-worker-side helper for chrome.alarms + desktop notifications.
// Content scripts send { type: MSG.NOTIFY, title, text } and the SW
// calls notify() here.

import { loadConfig } from '../../shared/storage.js';

export async function init() {
  console.log('[alarms] module ready');
  // No onAlarm listener here — service-worker.js owns the tick.
}

// Register at module scope so clicks wake the MV3 service worker.
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const match = /^torn-bazaar-(\d+)-/.exec(notificationId);
  if (!match) return; // Other notifications keep their existing behavior.
  try {
    await chrome.tabs.create({
      url: `https://www.torn.com/profiles.php?XID=${match[1]}`,
      active: true,
    });
    await chrome.notifications.clear(notificationId);
  } catch (e) {
    console.error('[alarms] open profile failed:', e);
  }
});

export async function notify(title, text, iconPath, url) {
  const cfg = await loadConfig();
  if (cfg['general.notifications.desktopNotifications'] === false) return;

  try {
    // Only use a validated Torn profile ID for clickable Bazaar notifications.
    const profileMatch = typeof url === 'string'
      ? /^https:\/\/www\.torn\.com\/profiles\.php\?XID=(\d+)$/.exec(url)
      : null;
    const prefix = profileMatch ? `torn-bazaar-${profileMatch[1]}` : 'torn';
    await chrome.notifications.create(`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
      type: 'basic',
      iconUrl: iconPath || chrome.runtime.getURL('assets/icons/icon128.png'),
      title: title || 'Torn Alerts',
      message: text || '',
    });
  } catch (e) {
    console.error('[alarms] notify failed:', e);
  }
}

export default { init, notify };