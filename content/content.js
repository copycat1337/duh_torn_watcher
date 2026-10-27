(async () => {
  'use strict';

  const {
    safeAddRuntimeListener,
    safeAddStorageListener,
  } = await import(chrome.runtime.getURL('shared/content-env.js'));

  const {
    loadConfig,
    getConfigSync,
    migrateLegacy,
  } = await import(chrome.runtime.getURL('shared/storage.js'));

  const { MSG } = await import(chrome.runtime.getURL('shared/constants.js'));

  // --- SAFE MODULE LOADING ---
  let mugModule, drugModule, bazaarModule;

  try {
    mugModule = (await import(chrome.runtime.getURL('modules/mug-watch/index.js'))).default;
    drugModule = (await import(chrome.runtime.getURL('modules/drug-watch/index.js'))).default;
    bazaarModule = (await import(chrome.runtime.getURL('modules/bazaar-watch/index.js'))).default;
  } catch (err) {
    console.error('[content] CRITICAL ERROR loading module files:', err);
  }

  const { getFieldDef, coerceValue } = await import(chrome.runtime.getURL('shared/config.js'));

  function getConfigForModule(path) {
    const cfg = getConfigSync();
    const def = getFieldDef(path);
    const raw = Object.prototype.hasOwnProperty.call(cfg, path) ? cfg[path] : undefined;
    return def ? coerceValue(path, raw) : raw;
  }

  let registry = [];

  function startOne(entry) {
    if (entry.started) return;
    try {
      if (typeof entry.inst.start === 'function') entry.inst.start();
      entry.started = true;
      console.log('[content] started', entry.name);
    } catch (e) {
      console.warn(`[content] failed to start ${entry.name}:`, e);
    }
  }

  function stopOne(entry) {
    if (!entry.started) return;
    try { entry.inst.stop?.(); } catch (e) {
      console.warn(`[content] failed to stop ${entry.name}:`, e);
    }
    entry.started = false;
  }

  function buildRegistry() {
    const mods = [
      [mugModule, 'mug-watch'],
      [drugModule, 'drug-watch'],
      [bazaarModule, 'bazaar-watch'],
    ];
    registry = [];
    
    for (const [mod, fallbackName] of mods) {
      if (!mod || typeof mod.init !== 'function') {
        console.warn(`[content] module "${fallbackName}" failed to load. Ensure it exports default { init }.`);
        continue;
      }
      try {
        // Your index.js exports an object with an init() method!
        const inst = mod.init({ getConfig: getConfigForModule });
        registry.push({
          name: inst.name || fallbackName,
          inst,
          started: false,
        });
      } catch (e) {
        console.warn(`[content] failed to construct ${fallbackName}:`, e);
      }
    }
  }

  function isEnabled(entry) {
    try {
      if (typeof entry.inst.isEnabled === 'function') return entry.inst.isEnabled() !== false;
    } catch {}
    return true; 
  }

  function syncModules() {
    for (const entry of registry) {
      const want = isEnabled(entry);
      if (want && !entry.started) {
        startOne(entry);
      } else if (!want && entry.started) {
        stopOne(entry);
      } else if (want && entry.started && typeof entry.inst.sync === 'function') {
        try { entry.inst.sync(); } catch (e) {
          console.warn(`[content] sync failed for ${entry.name}:`, e);
        }
      }
    }
  }

  async function boot() {
    try {
      await migrateLegacy();
      await loadConfig();
      buildRegistry();
      for (const entry of registry) {
        if (isEnabled(entry)) startOne(entry);
      }
    } catch (e) {
      console.error('[content] Failed to boot:', e);
    }
  }

  safeAddStorageListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    const affectsModules = keys.some((k) =>
      /^cfg\.(api\.general\.|general\.notifications\.|notifications\.)/.test(k)
    );
    if (affectsModules) syncModules();
  });

  safeAddRuntimeListener((msg, _sender, sendResponse) => {
    if (msg?.type !== MSG.RECHECK_NOW) return;
    let n = 0;
    for (const entry of registry) {
      if (!entry.started) continue;
      try { entry.inst.check(true); n++; } catch (e) {
        console.warn('[content] recheck failed:', e);
      }
    }
    sendResponse({ ok: true, modules: n });
    return false;
  });

  let focusDebounce = null;
  function recheckSoon() {
    if (focusDebounce) return;
    focusDebounce = setTimeout(() => {
      focusDebounce = null;
      for (const entry of registry) {
        if (!entry.started) continue;
        try { entry.inst.check(false); } catch (e) {
          console.warn('[content] focus recheck failed:', e);
        }
      }
    }, 2000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recheckSoon();
  });
  window.addEventListener('focus', recheckSoon);

  boot();
})();