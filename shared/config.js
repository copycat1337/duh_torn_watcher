// Central settings registry. Options page auto-renders from this.
// Adding a field here instantly creates a UI at
// options.html#/preferences/<section>/<page>

export const DEFAULT_CONFIG = {
  api: {
    general: {
      apiKey: {
        type: 'password',
        default: '',
        label: 'Torn API Key',
        hint: 'Full access key from torn.com/prefs.php?step=api',
      },
      checkInterval: {
        type: 'number',
        default: 30,
        label: 'Check Interval (seconds)',
        min: 15,
        max: 120,
        hint: 'How often to poll the Torn API. Lower = faster alerts, more requests.',
      },
    },
  },

  general: {
    notifications: {
      soundEnabled: {
        type: 'boolean',
        default: true,
        label: 'Play alert sounds',
        hint: 'Chiptune beep when an alert fires in an open Torn tab.',
      },
      desktopNotifications: {
        type: 'boolean',
        default: true,
        label: 'Desktop notifications',
        hint: 'Native OS notification popups.',
      },
      badgeEnabled: {
        type: 'boolean',
        default: true,
        label: 'Show unread badge',
        hint: 'Number on the toolbar icon showing unread alerts.',
      },
      volumeMug: {
        type: 'number',
        default: 25,
        min: 0,
        max: 100,
        label: 'Mug alert volume (%)',
        hint: '0 = silent, 100 = loudest. Sound must be enabled above.',
      },
      volumeDrug: {
        type: 'number',
        default: 25,
        min: 0,
        max: 100,
        label: 'Drug alert volume (%)',
        hint: '0 = silent, 100 = loudest.',
      },
      volumeBazaar: {
        type: 'number',
        default: 25,
        min: 0,
        max: 100,
        label: 'Bazaar alert volume (%)',
        hint: '0 = silent, 100 = loudest.',
      },
    },
  },

  notifications: {
    mug: {
      enabled: {
        type: 'boolean',
        default: true,
        label: 'Enable Mug Watch',
        hint: 'Alert when a faction member is attacked in your faction.',
      },
      watchResults: {
        type: 'checkboxes',
        label: 'Alert me on these incoming attack types',
        hint: 'Stealthed attackers are shown as "unknown" but the alert still fires.',
        default: ['Mugged', 'Hospitalized'],
        options: ['Attacked', 'Mugged', 'Hospitalized'],
      },
      minValue: {
        type: 'number',
        default: 0,
        label: 'Minimum mug value ($)',
        min: 0,
        max: 100000000,
        hint: 'Skip mugs below this amount. 0 = alert on all.',
      },
    },
    'xanax-watch': {
      enabled: {
        type: 'boolean',
        default: true,
        label: 'Enable Xanax Watch',
        hint: 'Alert when faction Xanax stock drops.',
      },
      watchAllDrugs: {
        type: 'boolean',
        default: false,
        label: 'Watch all drugs, not just Xanax',
        hint: 'If off, only Xanax (item 206) is monitored.',
      },
      drugsWatched: {
        type: 'text',
        default: '206',
        label: 'Watched drug IDs (comma-separated)',
        hint: '206=Xanax, 366=Ecstasy, 522=Ketamine, 752=Cannabis, 753=Opium, 754=Speed, 755=PCP, 756=LSD, 757=Shrooms',
      },
    },
    bazaar: {
      enabled: {
        type: 'boolean',
        default: false,
        label: 'Enable Bazaar Watch',
        hint: 'Alert when a Torn dollar bazaar is worth at least the minimum value.',
      },
      minTotalValue: {
        type: 'number',
        default: 1000000,
        min: 1000,
        max: 100000000,
        label: 'Minimum total value ($)',
        hint: 'Only alert on bazaars whose total market value meets this threshold.',
      },
      checkInterval: {
        type: 'number',
        default: 300,
        min: 60,
        max: 3600,
        label: 'Check interval (seconds)',
        hint: 'How often to poll the bazaar API. Default 5 minutes.',
      },
      maxPages: {
        type: 'number',
        default: 50,
        min: 1,
        max: 200,
        label: 'Max pages to fetch',
        hint: 'Safety cap. Each page is up to 100 records.',
      },
      soundEnabled: {
        type: 'boolean',
        default: true,
        label: 'Bazaar-specific sound',
        hint: 'Play a chime when a matching bazaar is found.',
      },
    },
  },

  alerts: {
    log: {
      maxAlerts: {
        type: 'number',
        default: 500,
        label: 'Max alerts kept',
        min: 50,
        max: 2000,
        hint: 'Older alerts are dropped past this limit.',
      },
    },
  },
};

export const STORAGE_PREFIX = 'cfg.';

// ---------------------------------------------------------------------------
// Path helpers.
//
// Storage is FLAT: one chrome.storage.local key per setting, named
// "cfg.<section>.<page>.<name>". getPath/buildDefaults must agree on this.
// ---------------------------------------------------------------------------

// Resolve a dotted path against a nested object (kept for callers that pass
// nested shapes, e.g. UI render state). For flat config lookups use getFlat.
export function getPath(obj, path) {
  if (obj == null || !path) return undefined;
  // Support both flat keys and nested objects.
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Look up a setting field definition from the schema by dotted path.
export function getFieldDef(path) {
  const parts = String(path).split('.');
  let node = DEFAULT_CONFIG;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[p];
  }
  // A field def is an object with a `type` property.
  return node && typeof node === 'object' && 'type' in node ? node : undefined;
}

// Build the flat defaults map: { "api.general.apiKey": "", ... }
export function buildDefaults() {
  const out = {};
  for (const [section, pages] of Object.entries(DEFAULT_CONFIG)) {
    for (const [page, fields] of Object.entries(pages)) {
      for (const [name, def] of Object.entries(fields)) {
        out[`${section}.${page}.${name}`] = def.default;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schema-aware coercion: clamp numbers, coerce booleans, validate checkboxes.
// Use this anywhere you read a raw stored value.
// ---------------------------------------------------------------------------
export function coerceValue(path, raw) {
  const def = getFieldDef(path);
  if (!def) return raw;

  if (raw === undefined || raw === null) return def.default;

  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      if (!Number.isFinite(n)) return def.default;
      let v = n;
      if (typeof def.min === 'number') v = Math.max(def.min, v);
      if (typeof def.max === 'number') v = Math.min(def.max, v);
      return v;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1 || raw === '1') return true;
      if (raw === 'false' || raw === 0 || raw === '0' || raw === '') return false;
      return def.default;
    case 'checkboxes': {
      if (!Array.isArray(raw)) return def.default;
      const allowed = new Set(def.options || []);
      const filtered = raw.filter((v) => allowed.has(v));
      return filtered.length ? filtered : def.default;
    }
    case 'password':
    case 'text':
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

// ---------------------------------------------------------------------------
// Legacy migration.
//
// IMPORTANT: multiple legacy keys can target the same new path. We define
// precedence explicitly (first key in LEGACY_KEY_PRECEDENCE wins) so the
// result is deterministic regardless of iteration order.
// ---------------------------------------------------------------------------

// Ordered list: earlier entries take precedence for the same target.
export const LEGACY_KEY_PRECEDENCE = [
  // api
  ['torn_suite_apiKey',               'api.general.apiKey'],
  ['torn_suite_checkInterval',        'api.general.checkInterval'],

  // general notifications
  ['torn_suite_soundEnabled',         'general.notifications.soundEnabled'],
  ['notifications.general.soundEnabled', 'general.notifications.soundEnabled'],
  ['torn_suite_desktopNotifications', 'general.notifications.desktopNotifications'],
  ['notifications.general.desktopNotifications', 'general.notifications.desktopNotifications'],

  // xanax-watch enabled: prefer the most specific legacy key first
  ['drug.general.drugAlertsEnabled',  'notifications.xanax-watch.enabled'],
  ['drug.general.enabled',            'notifications.xanax-watch.enabled'],
  ['drug_drugAlertsEnabled',          'notifications.xanax-watch.enabled'],

  // xanax-watch drugsWatched
  ['drug.watched.drugsWatched',       'notifications.xanax-watch.drugsWatched'],
  ['drug_drugsWatched',               'notifications.xanax-watch.drugsWatched'],

  // mug
  ['mug.general.enabled',             'notifications.mug.enabled'],
];

// Flat map form kept for anything that expects it (order not guaranteed).
export const LEGACY_KEY_MAP = Object.fromEntries(LEGACY_KEY_PRECEDENCE);