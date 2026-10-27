// Customize: picks what the wallpaper shows (the design, the liveblogs that
// lead the front page, the section streams) and saves it on the server. Every
// open wallpaper, the preview here included, follows a change over
// /api/settings/events. This page reloads the settings when it comes back into
// view, in case another tab changed them. Shows only what the feeds provide:
// titles, sections, counts and times.

const OUTLET = 'vrt-nws';
const OPTIONS_REFRESH_MS = 60_000;

const state = {
  settings: null,          // what the page shows: the saved settings plus changes not saved yet
  saved: null,             // the server's settings, as last heard
  options: null,           // /api/settings/options
  optionsError: null,      // the last options refresh failed
  health: null,            // { checkedAt, streams: Map<streamId, result> } | { error }
  checking: true,          // the first check starts right after the first render
  saving: false,
  error: null,             // why the last save failed, from the server
  openDetails: new Set(),  // warning lists the reader opened, kept across renders
};

// Changes not sent yet, by key: a newer change to a key replaces the older one.
let pending = {};

const els = {
  status: document.getElementById('status'),
  settings: document.getElementById('settings'),
  previewLinks: document.getElementById('preview-links'),
};

// A rebuild between press and release would swallow the click.
let pressing = false;
els.settings.addEventListener('pointerdown', () => { pressing = true; });
addEventListener('pointerup', () => { pressing = false; });
addEventListener('pointercancel', () => { pressing = false; });

// ---------------------------------------------------------------------------
// Data

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Liveblogs start and end, so the list is reloaded now and then. The rows keep
// their place, so none moves under the pointer; new ones go last.
async function refreshOptions() {
  if (document.hidden) return;
  try {
    const next = await api('/api/settings/options');
    const shown = state.options.liveblogs.map(b => b.id);
    const at = b => (shown.indexOf(b.id) + 1 || shown.length + 1);
    next.liveblogs.sort((a, b) => at(a) - at(b));
    state.options = next;
    state.optionsError = null;
  } catch (err) {
    state.optionsError = err.message;
  }
  if (!pressing) render(); // else the click's own change, or the next refresh, shows it
}

// Slow: the server loads every stream of the outlet. Nothing waits for it.
async function loadHealth() {
  state.checking = true;
  render();
  try {
    const { checkedAt, streams } = await api(`/api/outlets/${OUTLET}/health`);
    state.health = { checkedAt, streams: new Map(streams.map(r => [r.streamId, r])) };
  } catch (err) {
    state.health = { error: err.message };
  }
  state.checking = false;
  render();
}

// ---------------------------------------------------------------------------
// Saving

// Shows a change at once and queues it; saves go out one at a time.
function change(patch) {
  Object.assign(state.settings, patch);
  Object.assign(pending, patch);
  render({ reveal: true });
  save();
}

async function save() {
  if (state.saving || !Object.keys(pending).length) return;
  const patch = pending;
  pending = {};
  state.saving = true;
  renderStatus();
  try {
    state.saved = await api('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    state.error = null;
  } catch (err) {
    // Back to what the server has; changes queued on top of the failed one go too.
    pending = {};
    state.error = err.message;
    state.saved = await api('/api/settings').catch(() => state.saved);
  }
  const before = state.settings;
  state.settings = { ...state.saved, ...pending };
  state.saving = false;
  if (sameChoices(before, state.settings)) renderStatus();
  else render();
  save();
}

// Another tab may have saved while this one was out of view. No event stream
// here: the preview already holds one, and a browser opens only six
// connections to this server. A save of our own answers with the settings, so
// the check skips while one is under way or done meanwhile.
async function refreshSettings() {
  const busy = () => state.saving || Object.keys(pending).length > 0;
  if (busy()) return;
  const before = state.saved;
  const next = await api('/api/settings').catch(() => null);
  if (!next || busy() || state.saved !== before || next.updatedAt === before.updatedAt) return;
  state.saved = next;
  state.settings = { ...next };
  state.error = null;
  render();
}

function sameChoices(a, b) {
  const pick = s => JSON.stringify([s.preset, s.liveblogs, s.otherLiveblogs, s.sections]);
  return pick(a) === pick(b);
}

// ---------------------------------------------------------------------------
// Rendering

// Everything in the settings column is rebuilt on each change. Focus goes back
// to the same control (data-key), or to its row when the control is gone, so
// a keyboard user can keep moving an item.
function render({ reveal = false } = {}) {
  const active = els.settings.contains(document.activeElement) ? document.activeElement : null;
  const key = active?.dataset.key;
  const row = active?.closest('[data-row]')?.dataset.row;
  els.settings.replaceChildren(designBlock(), liveblogBlock(), sectionsBlock());
  if (key || row) restoreFocus(key, row, reveal);
  renderStatus();
  renderPreviewLinks();
}

function restoreFocus(key, row, reveal) {
  const find = (attr, value) => value ? els.settings.querySelector(`[${attr}="${CSS.escape(value)}"]`) : null;
  let el = find('data-key', key);
  if (!el || el.disabled) {
    const r = find('data-row', row);
    el = r?.querySelector('.actions button:not(:disabled)') ?? r?.querySelector('input, button:not(:disabled), a[href]');
  }
  if (!el) return;
  el.focus({ preventScroll: true });
  if (reveal) el.scrollIntoView({ block: 'nearest' });
}

function renderStatus() {
  const busy = state.saving || Object.keys(pending).length > 0;
  const updatedAt = state.saved?.updatedAt ? Date.parse(state.saved.updatedAt) : null;
  els.status.className = !busy && state.error ? 'bad' : 'muted';
  els.status.title = updatedAt ? `Last saved ${new Date(updatedAt).toString()}` : '';
  els.status.textContent = busy ? 'Saving…'
    : state.error ? `Not saved: ${state.error}`
    : updatedAt ? `Saved ${stamp(updatedAt)}`
    : 'Defaults, never saved';
}

function renderPreviewLinks() {
  const payload = isFront()
    ? '/api/vrt-nws/frontpage'
    : `/api/vrt-nws/wallpaper?follow=${encodeURIComponent(state.settings.liveblogs[0] ?? 'auto')}`;
  els.previewLinks.replaceChildren(
    h('a', { href: '/', target: '_blank' }, 'Open wallpaper ↗'),
    h('a', { href: payload, target: '_blank' }, 'Payload JSON ↗'),
  );
}

function design() {
  return state.options.presets.find(p => p.id === state.settings.preset);
}

function isFront() {
  return design()?.data === 'front';
}

// ---------------------------------------------------------------------------
// Design

function designBlock() {
  const { presets } = state.options;
  const groups = [
    ['Front page', presets.filter(p => p.data === 'front')],
    ['Liveblog', presets.filter(p => p.data !== 'front')],
  ];
  return h('section', { class: 'block', 'aria-labelledby': 'design-title' },
    h('h2', { id: 'design-title' }, 'Design'),
    h('p', { class: 'hint' }, 'Front-page designs show the VRT NWS front page in its own order. Liveblog designs follow one liveblog and its latest posts.'),
    groups.filter(([, list]) => list.length).map(([label, list]) => h('fieldset', null,
      h('legend', null, label),
      h('div', { class: 'cards' }, list.map(p => h('label', { class: 'card' },
        h('input', {
          type: 'radio',
          name: 'preset',
          value: p.id,
          checked: p.id === state.settings.preset,
          'data-key': `preset:${p.id}`,
          onchange: () => change({ preset: p.id }),
        }),
        h('span', null, h('span', { class: 'card-name' }, p.name), h('span', { class: 'card-desc' }, p.description)),
      ))),
    )),
  );
}

// ---------------------------------------------------------------------------
// Lead liveblogs

function liveblogBlock() {
  const picked = state.settings.liveblogs;
  const max = state.options.maxLiveblogs;
  const full = picked.length >= max;
  const front = isFront();
  const showsLive = design()?.live;
  const others = state.options.liveblogs.filter(b => !picked.includes(b.id));
  const hintId = 'other-liveblogs-hint';

  return h('section', { class: 'block', 'aria-labelledby': 'liveblogs-title' },
    h('div', { class: 'block-head' },
      h('h2', { id: 'liveblogs-title' }, 'Lead liveblogs'),
      h('span', { class: 'muted small' }, `${picked.length} of ${max}`),
    ),
    h('p', { class: 'hint' }, front
      ? `Up to ${max}. The first leads the front page; the others follow it in this order.`
      : `Up to ${max}. The first is the liveblog the design follows; the others only matter for front-page designs.`),
    picked.length
      ? h('ol', { class: 'list' }, picked.map((id, i) => liveblogRow(liveblogById(id), { index: i, count: picked.length })))
      : h('p', { class: 'none' }, front ? 'None picked: VRT’s own front-page order leads.' : 'None picked: the most active live liveblog is followed, or the last one updated when none is live.'),

    h('h3', null, 'Other liveblogs'),
    full ? h('p', { class: 'hint' }, `${max} picked, the most there can be: remove one to add another.`) : null,
    state.optionsError ? h('p', { class: 'bad small' }, `Could not refresh the list: ${state.optionsError}`) : null,
    others.length
      ? h('ul', { class: 'list' }, others.map(b => liveblogRow(b, { full })))
      : h('p', { class: 'none' }, 'No other liveblogs in VRT’s feed right now.'),

    h('div', { class: ['option', !showsLive && 'unused'].filter(Boolean).join(' ') },
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: state.settings.otherLiveblogs,
          'aria-describedby': hintId,
          'data-key': 'other-liveblogs',
          onchange: e => change({ otherLiveblogs: e.target.checked }),
        }),
        h('span', null, 'Also list the other running liveblogs'),
      ),
      h('p', { class: 'hint', id: hintId },
        'Adds a list of the other running liveblogs. Off: no such list; a liveblog on VRT’s own front page still shows there, and the picked ones still lead the page.',
        showsLive ? null : [' ', h('span', { class: 'note-inline' }, 'Not used by this design.')]),
    ),
  );
}

// A picked liveblog the options do not know yet (picked in another tab just now).
function liveblogById(id) {
  return state.options.liveblogs.find(b => b.id === id)
    ?? { id, title: `Liveblog ${id}`, section: null, live: null, updatedAt: null, postCount: null, url: null };
}

function liveblogRow(b, { index = null, count = 0, full = false }) {
  const picked = index != null;
  const list = state.settings.liveblogs;
  const name = `“${b.title}”`;
  return h('li', { class: 'item', 'data-row': `lb:${b.id}` },
    picked ? h('span', { class: 'pos', 'aria-hidden': 'true' }, index + 1) : null,
    h('div', { class: 'item-main' },
      h('p', { class: 'item-title' }, b.title),
      h('p', { class: 'meta' }, sep([
        b.section,
        b.live === true ? h('span', { class: 'pill live' }, 'Live')
          : b.live === false ? h('span', { class: 'pill ended' }, 'Ended')
          : 'status unknown',
        b.postCount != null ? `${b.postCount} posts` : null,
        b.updatedAt ? h('span', { title: new Date(b.updatedAt).toString() }, `updated ${ago(b.updatedAt)}`) : null,
        h('a', { href: explorerUrl(`liveblog-${b.id}`), 'data-key': `lb-inspect:${b.id}` }, 'Inspect'),
        safeUrl(b.url) ? h('a', { href: b.url, target: '_blank', rel: 'noreferrer', 'data-key': `lb-open:${b.id}` }, 'Open on VRT ↗') : null,
      ])),
      b.error ? h('p', { class: 'bad small' }, b.error) : null,
    ),
    h('div', { class: 'actions' }, picked ? [
      h('button', {
        class: 'btn icon', type: 'button', title: 'Move up', 'aria-label': `Move ${name} up`, disabled: index === 0,
        'data-key': `lb-up:${b.id}`, onclick: () => change({ liveblogs: moved(list, index, -1) }),
      }, '↑'),
      h('button', {
        class: 'btn icon', type: 'button', title: 'Move down', 'aria-label': `Move ${name} down`, disabled: index === count - 1,
        'data-key': `lb-down:${b.id}`, onclick: () => change({ liveblogs: moved(list, index, 1) }),
      }, '↓'),
      h('button', {
        class: 'btn', type: 'button', 'aria-label': `Remove ${name}`,
        'data-key': `lb-remove:${b.id}`, onclick: () => change({ liveblogs: list.filter(id => id !== b.id) }),
      }, 'Remove'),
    ] : h('button', {
      class: 'btn', type: 'button', 'aria-label': `Add ${name}`, disabled: full,
      title: full ? `${state.options.maxLiveblogs} picked already` : null,
      'data-key': `lb-add:${b.id}`, onclick: () => change({ liveblogs: [...list, b.id] }),
    }, 'Add')),
  );
}

// ---------------------------------------------------------------------------
// Sections

function sectionsBlock() {
  const all = state.options.sections;
  const picked = state.settings.sections;
  const byId = new Map(all.map(s => [s.id, s]));
  const rest = all.filter(s => !picked.includes(s.id));
  const shown = design()?.sections;

  return h('section', { class: ['block', !shown && 'unused'].filter(Boolean).join(' '), 'aria-labelledby': 'sections-title' },
    h('div', { class: 'block-head' },
      h('h2', { id: 'sections-title' }, 'Sections'),
      h('span', { class: 'muted small' }, `${picked.length} of ${all.length}`),
    ),
    h('p', { class: 'hint' }, 'The section streams below the front page, in this order.'),
    shown ? null : h('p', { class: 'note' }, 'This design does not show sections. Changes here still apply to the designs that do.'),
    healthLine(),
    h('div', { class: 'dim' },
      picked.length
        ? h('ol', { class: 'list' }, picked.map((id, i) => sectionRow(byId.get(id) ?? { id, name: id, group: null }, { index: i, count: picked.length })))
        : h('p', { class: 'none' }, 'None picked.'),
      rest.length ? [
        h('h3', null, 'More sections'),
        [...groupBy(rest, s => s.group)].map(([group, list]) => h('div', { class: 'group' },
          h('h4', null, group),
          h('ul', { class: 'list' }, list.map(s => sectionRow(s, {}))),
        )),
      ] : null,
    ),
  );
}

// The button stays put during a new check, so keyboard focus is not lost.
function healthLine() {
  const { health, checking } = state;
  return h('p', { class: 'hint health-line' },
    checking ? 'Checking every section stream…'
      : health?.error ? h('span', { class: 'bad' }, `Data check failed: ${health.error}`)
      : `Data checked ${clock(health.checkedAt)}`,
    checking && !health ? null : [' · ', h('button', {
      class: 'link', type: 'button', 'aria-disabled': checking ? 'true' : null,
      'data-key': 'recheck', onclick: () => { if (!state.checking) loadHealth(); },
    }, 'Check again')],
  );
}

function sectionRow(s, { index = null, count = 0 }) {
  const picked = index != null;
  const list = state.settings.sections;
  return h('li', { class: 'item', 'data-row': `sec:${s.id}` },
    h('div', { class: 'item-main' },
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: picked,
          'data-key': `sec:${s.id}`,
          onchange: e => change({ sections: e.target.checked ? [...list.filter(id => id !== s.id), s.id] : list.filter(id => id !== s.id) }),
        }),
        h('span', { class: 'item-title' }, s.name),
      ),
      h('p', { class: 'meta' }, sep([
        picked ? s.group : null,
        ...healthFacts(s.id),
        h('a', { href: explorerUrl(s.id), 'data-key': `sec-inspect:${s.id}` }, 'Inspect'),
      ])),
      healthNotes(s.id),
    ),
    picked ? h('div', { class: 'actions' },
      h('button', {
        class: 'btn icon', type: 'button', title: 'Move up', 'aria-label': `Move ${s.name} up`, disabled: index === 0,
        'data-key': `sec-up:${s.id}`, onclick: () => change({ sections: moved(list, index, -1) }),
      }, '↑'),
      h('button', {
        class: 'btn icon', type: 'button', title: 'Move down', 'aria-label': `Move ${s.name} down`, disabled: index === count - 1,
        'data-key': `sec-down:${s.id}`, onclick: () => change({ sections: moved(list, index, 1) }),
      }, '↓'),
    ) : null,
  );
}

function healthFacts(id) {
  if (!state.health) return [h('span', { class: 'muted' }, 'checking…')];
  if (state.health.error) return [];
  const r = state.health.streams.get(id);
  if (!r) return ['not checked'];
  if (!r.ok) return [h('span', { class: 'bad' }, `failed (${r.status})`)];
  return [
    h('span', { class: 'good' }, 'ok'),
    `${r.stats.count} items`,
    r.stats.newestAt ? h('span', { title: new Date(r.stats.newestAt).toString() }, `newest ${ago(r.stats.newestAt)}`) : 'no dates',
  ];
}

// The health check's warnings, or the error of a stream that failed, behind a
// summary line; the text also shows on hover.
function healthNotes(id) {
  const r = state.health?.streams?.get(id);
  const notes = !r ? [] : r.ok ? r.warnings : [r.error];
  if (!notes.length) return null;
  return h('details', {
    class: `notes ${r.ok ? 'warned' : 'failed'}`,
    open: state.openDetails.has(id),
    ontoggle: e => { if (e.currentTarget.open) state.openDetails.add(id); else state.openDetails.delete(id); },
  },
    h('summary', { title: notes.join('\n'), 'data-key': `notes:${id}` },
      r.ok ? `${notes.length} warning${notes.length === 1 ? '' : 's'}` : 'Error'),
    h('ul', null, notes.map(n => h('li', null, n))),
  );
}

// ---------------------------------------------------------------------------
// Helpers

const fmtClock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function clock(ts) {
  return fmtClock.format(new Date(ts));
}

// Time of day for today, date and time otherwise.
function stamp(ts) {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? clock(ts) : `${fmtDay.format(d)} ${clock(ts)}`;
}

function ago(ts, now = Date.now()) {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 0) return 'in the future';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function moved(list, index, delta) {
  const next = [...list];
  const [id] = next.splice(index, 1);
  next.splice(index + delta, 0, id);
  return next;
}

function explorerUrl(streamId) {
  return `/explorer/?${new URLSearchParams({ outlet: OUTLET, stream: streamId })}`;
}

// Parts of a meta line, the empty ones left out, with a dot between.
function sep(parts) {
  return parts.filter(p => p != null && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]));
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url ?? '') ? url : null;
}

function groupBy(list, key) {
  const map = new Map();
  for (const x of list) {
    const k = key(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  els.settings.replaceChildren(h('p', { class: 'empty' }, 'Loading settings…'));
  try {
    const [settings, options] = await Promise.all([api('/api/settings'), api('/api/settings/options')]);
    state.saved = settings;
    state.settings = { ...settings };
    state.options = options;
  } catch (err) {
    els.settings.replaceChildren(h('div', { class: 'load-error' },
      h('p', { class: 'bad' }, `Could not load the settings: ${err.message}`),
      h('button', { class: 'btn', type: 'button', onclick: boot }, 'Try again'),
    ));
    return;
  }
  render();
  loadHealth();
  setInterval(refreshOptions, OPTIONS_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshSettings();
    refreshOptions();
  });
}

boot();
