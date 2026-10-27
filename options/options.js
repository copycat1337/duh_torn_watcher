import { DEFAULT_CONFIG } from '../shared/config.js';
import { loadConfig, getConfigSync, setConfig } from '../shared/storage.js';

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');

/* ============================================================
 *  HASH ROUTING  #/preferences/<section>/<page>
 * ============================================================ */
function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  const [, section, page] = parts;
  return { section, page };
}
function navigate(section, page) {
  location.hash = `#/preferences/${section}/${page}`;
}

/* ============================================================
 *  SIDEBAR
 * ============================================================ */
function renderSidebar(activeSection, activePage) {
  sidebar.innerHTML = '';
  for (const [section, pages] of Object.entries(DEFAULT_CONFIG)) {
    const group = document.createElement('div');
    group.className = 'group';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = section;
    group.appendChild(title);

    for (const page of Object.keys(pages)) {
      const link = document.createElement('a');
      link.textContent = page;
      link.href = `#/preferences/${section}/${page}`;
      if (section === activeSection && page === activePage) link.classList.add('active');
      group.appendChild(link);
    }
    sidebar.appendChild(group);
  }
}

/* ============================================================
 *  CONTENT — card grid per page
 * ============================================================ */
function renderContent(section, page) {
  content.innerHTML = '';
  const pageConfig = DEFAULT_CONFIG?.[section]?.[page];
  if (!pageConfig) {
    content.textContent = 'Not found.';
    return;
  }

  const h = document.createElement('h2');
  h.innerHTML = `${escapeHtml(capitalize(section))} <span class="crumb">→ ${escapeHtml(capitalize(page))}</span>`;
  content.appendChild(h);

  if (section === 'alerts' && page === 'log') {
    renderAlertsLog(content);
    return;
  }

  const hint = document.createElement('p');
  hint.className = 'page-hint';
  hint.textContent = PAGE_HINTS[`${section}.${page}`] || '';
  if (hint.textContent) content.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'cards';

  const cfg = getConfigSync();
  for (const [name, def] of Object.entries(pageConfig)) {
    const path = `${section}.${page}.${name}`;
    const current = cfg[path] ?? def.default;
    grid.appendChild(buildCard({ def, path, current }));
  }
  content.appendChild(grid);
}

const PAGE_HINTS = {
  'api.general': 'Credentials and polling cadence for the Torn API.',
  'general.notifications': 'Master toggles for how alerts are surfaced.',
  'notifications.mug': 'Alert when a faction member gets mugged.',
  'notifications.xanax-watch': 'Alert when watched drugs are consumed.',
  'alerts.log': 'Full history of every alert fired.',
};

/* Build a single card for one config field. */
function buildCard({ def, path, current }) {
  const card = document.createElement('div');
  card.className = 'card' + (def.type === 'text' ? ' wide' : '');

  const head = document.createElement('div');
  head.className = 'card-head';

  const label = document.createElement('div');
  label.className = 'card-label';
  label.textContent = def.label || path;
  head.appendChild(label);

  if (def.type === 'boolean') {
    head.appendChild(buildSwitch(current, (v) => save(path, v)));
    card.appendChild(head);
  } else {
    card.appendChild(head);
    card.appendChild(buildInput(def, current, (v) => save(path, v)));
  }

  if (def.hint) {
    const hint = document.createElement('div');
    hint.className = 'card-hint';
    hint.textContent = def.hint;
    card.appendChild(hint);
  }

  return card;
}

function buildInput(def, current, onChange) {
  const field = document.createElement('div');
  field.className = 'field';

  if (def.type === 'checkboxes') {
    field.classList.add('stack');
    const selected = new Set(Array.isArray(current) ? current : (def.default || []));
    for (const opt of def.options || []) {
      const value = opt.value ?? opt;
      const row = document.createElement('label');
      row.className = 'check-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = value;
      cb.checked = selected.has(value);
      cb.onchange = () => {
        if (cb.checked) selected.add(value);
        else            selected.delete(value);
        const ordered = (def.options || [])
          .map((o) => o.value ?? o)
          .filter((v) => selected.has(v));
        onChange(ordered);
      };

      const lbl = document.createElement('span');
      lbl.textContent = opt.label ?? value;

      row.append(cb, lbl);
      field.appendChild(row);
    }
    return field;
  }

  let input;

  if (def.type === 'select') {
    input = document.createElement('select');
    for (const opt of def.options || []) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === current) o.selected = true;
      input.appendChild(o);
    }
    input.onchange = () => onChange(input.value);
  } else if (def.type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
    input.value = current ?? 0;
    if (def.min != null) input.min = def.min;
    if (def.max != null) input.max = def.max;
    input.onchange = () => onChange(Number(input.value));
  } else if (def.type === 'password') {
    input = document.createElement('input');
    input.type = 'password';
    input.value = current ?? '';
    input.autocomplete = 'off';
    input.onchange = () => onChange(input.value);
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = current ?? '';
    input.onchange = () => onChange(input.value);
  }

  field.appendChild(input);
  return field;
}

function buildSwitch(checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.onchange = () => onChange(input.checked);

  const slider = document.createElement('span');
  slider.className = 'slider';

  wrap.append(input, slider);
  return wrap;
}

/* ============================================================
 *  SAVE
 * ============================================================ */
async function save(path, value) {
  await setConfig(path, value);
  flashSaved();
}

let flashTimer = null;
function flashSaved() {
  clearTimeout(flashTimer);
  let el = document.getElementById('save-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-flash';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '16px',
      right: '20px',
      background: '#2563eb',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '6px',
      fontSize: '13px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      transition: 'opacity 0.2s',
      zIndex: 1000,
    });
    document.body.appendChild(el);
  }
  el.textContent = 'Saved';
  el.style.opacity = '1';
  flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

/* ============================================================
 *  ALERTS LOG VIEWER (special-cased)
 * ============================================================ */
async function renderAlertsLog(root) {
  const alertsModule = await import('../modules/alerts/index.js');

  const bar = document.createElement('div');
  bar.className = 'log-bar';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  refreshBtn.onclick = () => renderAlertsLog(root);

  const readBtn = document.createElement('button');
  readBtn.textContent = 'Mark all read';
  readBtn.onclick = async () => {
    await alertsModule.markAllRead();
    renderAlertsLog(root);
  };

  const clearBtn = document.createElement('button');
  clearBtn.className = 'danger';
  clearBtn.textContent = 'Clear all';
  clearBtn.onclick = async () => {
    if (confirm('Delete all alerts?')) {
      await alertsModule.clearAll();
      renderAlertsLog(root);
    }
  };

  bar.append(refreshBtn, readBtn, clearBtn);

  const list = document.createElement('div');
  list.className = 'log-list';

  const alerts = await alertsModule.getAll();
  if (!alerts.length) {
    list.innerHTML = '<div class="log-empty">No alerts yet.</div>';
  } else {
    for (const a of alerts) {
      const row = document.createElement('div');
      row.className = 'log-row' + (a.read ? ' read' : '');

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = new Date(a.time).toLocaleString();

      const kind = document.createElement('span');
      kind.className = 'log-kind ' + a.kind;
      kind.textContent = a.kind;

      const text = document.createElement('span');
      text.className = 'log-text';
      text.textContent = a.text;

      row.append(time, kind, text);
      list.appendChild(row);
    }
  }

  root.innerHTML = '';
  const h = document.createElement('h2');
  h.innerHTML = 'Alerts <span class="crumb">→ Log</span>';
  root.append(h, bar, list);
}

/* ============================================================
 *  UTILS
 * ============================================================ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

/* ============================================================
 *  ROUTING
 * ============================================================ */
function route() {
  let { section, page } = parseHash();
  const sections = Object.keys(DEFAULT_CONFIG);

  if (!section || !DEFAULT_CONFIG[section]) {
    section = sections[0];
    page = Object.keys(DEFAULT_CONFIG[section])[0];
    return navigate(section, page);
  }
  if (!page || !DEFAULT_CONFIG[section][page]) {
    page = Object.keys(DEFAULT_CONFIG[section])[0];
    return navigate(section, page);
  }

  renderSidebar(section, page);
  renderContent(section, page);
}

window.addEventListener('hashchange', route);

(async () => {
  await loadConfig();
  route();
})();