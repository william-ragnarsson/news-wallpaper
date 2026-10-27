// The wallpaper page. It loads the news through the sources (in this page,
// over the host's /net: see host.js), picks a preset, renders it full-screen
// and keeps it fresh. The same page runs in a browser on the dev server and in
// the macOS app, which takes a picture of it for the desktop.
// The preset and the followed liveblog come from the settings and change with
// them, unless the URL pins them.
// Dev controls live in a HUD (press ?) and never become part of the wallpaper.

import * as host from './host.js';
import { PRESETS } from './presets/index.js';

const { sources } = host;

const SCREENS = [
  { id: 'fill', label: 'Fill window' },
  { id: '1440x900', label: 'MacBook Air 13″' },
  { id: '1512x982', label: 'MacBook Pro 14″' },
  { id: '1728x1117', label: 'MacBook Pro 16″' },
  { id: '2560x1440', label: 'Studio Display' },
  { id: '3440x1440', label: 'Ultrawide 34″' },
];

const IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1600, 1920];
// The Dock area the wallpaper keeps clear, in points: `?dock=WxH` to match the
// real one, `?dock=0` for a Dock that hides itself. Default: 12 icons of 52.
const DOCK_DEFAULT = { width: 12 * (52 + 6) + 28, height: 52 + 26 };
// The column at the right edge where Finder puts files and folders on the
// desktop, in points: one icon with its label. Customize sets its width
// (settings.margin); this is the width until the settings load.
const DESKTOP_ICONS = 104;

const params = new URLSearchParams(location.search);
const urlPreset = PRESETS.find(p => p.id === params.get('preset'))?.id;
const state = {
  preset: urlPreset ?? PRESETS[0].id,
  follow: params.get('follow') || 'auto',
  // Pinned in the URL (or by a key, which writes it there): the settings leave it alone.
  pinned: { preset: Boolean(urlPreset), follow: Boolean(params.get('follow')) },
  settings: null,
  chrome: params.get('chrome') !== '0',
  screen: parseScreen(params.get('screen')),
  dock: parseDock(params.get('dock')),
  dockHidden: params.get('dock') === '0',
  refreshMs: Math.max(15, Number(params.get('refresh')) || 60) * 1000,
  showHint: params.get('hud') !== '0',
  data: null,
  error: null,
  fetchedAt: null,
  seenPostIds: new Set(),
  fresh: new Set(),
};

const els = {
  desktop: document.getElementById('desktop'),
  wallpaper: document.getElementById('wallpaper'),
  chrome: document.getElementById('mac-chrome'),
  dock: document.getElementById('dock'),
  clock: document.getElementById('menubar-clock'),
  hud: document.getElementById('hud'),
  toast: document.getElementById('toast'),
  presetCss: document.getElementById('preset-css'),
};

let preset = null;
let presetId = null; // which preset `preset` is; state.preset runs ahead during a switch
const imageFallbacks = new Map();

// ---------------------------------------------------------------------------
// Data

// Each preset reads one of these (its `data` in presets/index.js); both are
// documented in presets/README.md.
const SOURCES = {
  // The followed liveblog with its posts, plus the other liveblogs and headlines.
  wallpaper: {
    load: () => sources.getWallpaper({ follow: state.follow, maxPosts: 40, maxHeadlines: 16 }),
    ids: d => [d.focus, ...d.liveblogs].flatMap(b => (b.posts ?? b.recent).map(p => p.id)),
    signature: d => [d.focus.id, d.focus.posts[0]?.id, ...d.liveblogs.map(b => b.updatedAt), d.headlines[0]?.id].join('|'),
  },
  // VRT NWS's front page in its own order, the sections and the running liveblogs.
  front: {
    load: () => sources.getFrontpage(state.settings ?? {}),
    ids: d => frontStories(d).map(s => s.id),
    signature: d => frontStories(d).map(s => `${s.id}@${s.time}`).join('|'),
  },
};

function dataSource(presetId = state.preset) {
  return SOURCES[PRESETS.find(p => p.id === presetId)?.data ?? 'wallpaper'];
}

function frontStories(d) {
  return [...d.top, ...d.sections.flatMap(s => s.stories), ...d.live];
}

let fetchSeq = 0;
let lastFetch = null;

// Calls can overlap (the timer, a key, a settings change). Only the newest
// response is kept and the older calls wait for it, so stale data never lands
// last. `markFresh: false` takes in what a settings change brought into view
// without marking it Nieuw: it is not news.
function fetchData(options) {
  lastFetch = loadData(++fetchSeq, options);
  return lastFetch;
}

async function loadData(seq, { markFresh = true } = {}) {
  const source = dataSource();
  try {
    const body = await source.load();
    if (seq !== fetchSeq) return lastFetch;
    const changed = !state.data || source.signature(body) !== source.signature(state.data);
    const ids = source.ids(body);
    if (markFresh) state.fresh = state.seenPostIds.size ? new Set(ids.filter(id => !state.seenPostIds.has(id))) : new Set();
    ids.forEach(id => state.seenPostIds.add(id));
    state.data = body;
    state.error = null;
    state.fetchedAt = new Date();
    return changed;
  } catch (err) {
    if (seq !== fetchSeq) return lastFetch;
    state.error = err.message;
    console.warn('Wallpaper refresh failed:', err);
    return !state.data;
  }
}

// ---------------------------------------------------------------------------
// Settings (kept by the host: see host.js)

// What the settings ask for, or the defaults while they are unknown.
function settingsPreset() {
  const id = state.settings?.preset;
  return PRESETS.some(p => p.id === id) ? id : PRESETS[0].id;
}

function settingsFollow() {
  return state.settings?.liveblogs?.[0] ?? 'auto';
}

// Hears every change made on Customize, without a reload (dev server only).
// A page with both the preset and the liveblog pinned (tools/snap.sh renders
// those) does without: headless Chrome can hold virtual time while a request
// stays open, so a snapshot might never be taken.
function listen() {
  if (listen.stop || host.inApp) return;
  listen.stop = host.watchSettings(onSettings);
}

// The stream sends the settings on connecting and again on every change. The
// same updatedAt as the settings in use means there is nothing new.
function onSettings(settings) {
  const changed = settings.updatedAt !== state.settings?.updatedAt;
  state.settings = settings;
  if (changed) followSettings();
  else renderHud();
}

// Takes what is not pinned from the settings, then fetches and renders at
// once: the front page changes with the settings even when the preset stays.
async function followSettings() {
  applyScreen(); // the margin for the desktop files
  if (!state.pinned.follow) state.follow = settingsFollow();
  const id = state.pinned.preset ? state.preset : settingsPreset();
  if (id !== state.preset) return setPreset(id, { pin: false });
  await fetchData({ markFresh: false });
  render();
  renderHud();
}

// Drops both pins (key C): back to what Customize says.
async function followCustomize() {
  state.pinned = { preset: false, follow: false };
  syncUrl();
  toast('Volgt Customize');
  listen();
  await followSettings();
}

// ---------------------------------------------------------------------------
// Presets

// Loads a preset's module, and its stylesheet once `ready` (its data) is in
// too, so the page on screen keeps its styles until the new one can render.
// False when another switch started meanwhile.
async function loadPreset(id, ready) {
  const [mod] = await Promise.all([import(`./presets/${id}/preset.js`), ready]);
  if (id !== state.preset) return false;
  const href = `./presets/${id}/preset.css`;
  if (els.presetCss.getAttribute('href') !== href) {
    await new Promise(resolve => {
      els.presetCss.onload = els.presetCss.onerror = resolve;
      els.presetCss.href = href;
    });
  }
  if (id !== state.preset) return false;
  // Set last: a module without a default export throws here, and presetId must
  // still name the preset on screen for the fallback.
  const next = mod.default;
  els.desktop.dataset.tone = next.tone ?? 'dark';
  preset = next;
  presetId = id;
  return true;
}

function render() {
  const root = els.wallpaper;
  // Mid-switch the new preset is still loading: leave the last page up.
  if (state.data && presetId !== state.preset) return;
  root.replaceChildren();
  root.className = `preset-${state.preset}`;
  if (!state.data) {
    root.append(h('div', { class: 'wallpaper-status' }, state.error ? `Kon het nieuws niet laden: ${state.error}` : 'Nieuws laden…'));
    return;
  }
  try {
    preset.render(root, state.data, makeContext());
    layout();
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('pre', { class: 'wallpaper-status' }, `Preset "${state.preset}" failed:\n${err.stack}`));
  }
}

function layout() {
  if (state.data && preset?.layout) preset.layout(els.wallpaper, makeContext());
}

// ---------------------------------------------------------------------------
// Render context handed to presets (documented in presets/README.md)

function makeContext() {
  const { width, height } = screenSize();
  return {
    now: new Date(),
    screen: { width, height, id: state.screen },
    safe: { top: menubarInset(width), right: filesColumn(), bottom: dockArea().height, dockWidth: dockArea().width },
    fresh: state.fresh,
    follow: state.follow,
    image,
    time,
    clock,
    ago,
    date,
    h,
    html,
  };
}

function image(img, cssWidth = 960) {
  const url = typeof img === 'string' ? img : img?.url;
  if (!url) return '';
  const scale = screenScale() * (window.devicePixelRatio || 1);
  const want = IMAGE_WIDTHS.find(w => w >= cssWidth * scale) ?? IMAGE_WIDTHS.at(-1);
  const resized = url.replace(/^(https:\/\/images\.vrt\.be\/)(orig|vrtnws_share|width\d+|w\d+hx)\//, `$1w${want}hx/`);
  if (resized !== url) imageFallbacks.set(resized, url);
  return resized;
}

const fmtTime = new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtLong = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayMonth = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'long' });

// Flemish newsroom style: 20u38
function time(ts) {
  return clock(ts).replace(':', 'u');
}

function clock(ts) {
  return fmtTime.format(new Date(ts));
}

function ago(ts, now = Date.now()) {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return 'zonet';
  if (min < 60) return `${min} min geleden`;
  const hours = Math.floor(min / 60);
  if (hours < 24 && new Date(ts).getDate() === new Date(now).getDate()) return `${hours} uur geleden`;
  if (hours < 48) return `gisteren ${time(ts)}`;
  return fmtShort.format(new Date(ts));
}

function date(ts = Date.now(), style = 'long') {
  const d = new Date(ts);
  if (style === 'short') return fmtShort.format(d);
  if (style === 'daymonth') return fmtDayMonth.format(d);
  return fmtLong.format(d);
}

// Tiny hyperscript: h('div', { class: 'x', style: { color: 'red' } }, 'text', child)
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

// VRT's text HTML is sanitized server-side to p/strong/em/ul/ol/li/br.
function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup ?? '';
  return t.content;
}

// ---------------------------------------------------------------------------
// Simulated screen

function screenSize() {
  if (state.screen === 'fill') return { width: innerWidth, height: innerHeight };
  const [width, height] = state.screen.split('x').map(Number);
  return { width, height };
}

function screenScale() {
  if (state.screen === 'fill') return 1;
  const { width, height } = screenSize();
  return Math.min(innerWidth / width, innerHeight / height);
}

function menubarHeight(width) {
  return width <= 1800 ? 37 : 25;
}

// How much of the menu bar lies over the page. A wallpaper app such as Plash
// may already start its window below the menu bar: then the window is that
// much shorter than the screen, and none of it does.
function menubarInset(width) {
  const height = menubarHeight(width);
  if (state.chrome || state.screen !== 'fill') return height;
  return Math.max(0, height - Math.max(0, screen.height - innerHeight));
}

// One of SCREENS, or any `WxH` in points: the app previews the page at the
// size of the real screen.
function parseScreen(value) {
  if (SCREENS.some(s => s.id === value)) return value;
  const [width, height] = (value ?? '').split('x').map(Number);
  return /^\d+x\d+$/.test(value) && width >= 320 && height >= 240 && width <= 8192 && height <= 8192 ? value : 'fill';
}

function parseDock(value) {
  const [width, height] = (value ?? '').split('x').map(Number);
  return width > 0 && height > 0 ? { width, height } : DOCK_DEFAULT;
}

function filesColumn() {
  const margin = state.settings?.margin;
  return Number.isInteger(margin) ? margin : DESKTOP_ICONS;
}

function dockArea() {
  return state.dockHidden ? { width: 0, height: 0 } : state.dock;
}

// The fake Dock's icon size and count follow the area kept clear.
function dockTile() {
  return Math.max(16, state.dock.height - 26);
}

function applyScreen() {
  const { width, height } = screenSize();
  const d = els.desktop;
  d.toggleAttribute('data-fixed', state.screen !== 'fill');
  d.style.setProperty('--screen-w', `${width}px`);
  d.style.setProperty('--screen-h', `${height}px`);
  d.style.setProperty('--screen-scale', screenScale());
  d.style.setProperty('--safe-top', `${menubarInset(width)}px`);
  d.style.setProperty('--safe-right', `${filesColumn()}px`);
  d.style.setProperty('--safe-bottom', `${dockArea().height}px`);
  d.style.setProperty('--dock-width', `${dockArea().width}px`);
  d.style.setProperty('--dock-tile', `${dockTile()}px`);
  els.chrome.hidden = !state.chrome;
  els.dock.hidden = state.dockHidden;
  buildDock();
}

function buildDock() {
  const hues = [210, 0, 130, 28, 280, 190, 48, 340, 160, 230, 15, 260];
  const tiles = Math.max(2, Math.round((state.dock.width - 28) / (dockTile() + 6)));
  els.dock.replaceChildren(
    ...Array.from({ length: tiles - 1 }, (_, i) => h('i', { '--hue': hues[i % hues.length] })),
    h('b'),
    h('i', { class: 'trash' }),
  );
}

function tickClock() {
  els.clock.textContent = new Date().toLocaleString('nl-BE', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

// ---------------------------------------------------------------------------
// Dev HUD

// Only pinned choices go in the URL: a plain one (Plash's /?chrome=0&hud=0)
// keeps following Customize.
function syncUrl() {
  const p = new URLSearchParams();
  if (state.pinned.preset) p.set('preset', state.preset);
  if (state.pinned.follow) p.set('follow', state.follow);
  if (state.screen !== 'fill') p.set('screen', state.screen);
  if (state.dockHidden) p.set('dock', '0');
  else if (state.dock !== DOCK_DEFAULT) p.set('dock', `${state.dock.width}x${state.dock.height}`);
  if (!state.chrome) p.set('chrome', '0');
  if (params.has('refresh')) p.set('refresh', params.get('refresh'));
  if (!state.showHint) p.set('hud', '0');
  const query = String(p);
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function toast(text, ms = 1600) {
  els.toast.textContent = text;
  els.toast.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), ms);
}

function renderHud() {
  // A front design takes its liveblogs and sections from Customize even when
  // pinned in the URL; the liveblog pin does nothing there.
  const front = dataSource() === SOURCES.front;
  const pinned = ['preset', 'follow'].filter(k => state.pinned[k] && !(k === 'follow' && front));
  els.hud.replaceChildren(
    h('h2', null, 'Wallpaper controls'),
    h('dl', null,
      row('← →', 'Preset', PRESETS.find(p => p.id === state.preset)?.name, origin('preset')),
      front ? leadRow() : row('L', 'Liveblog', followLabel(), origin('follow')),
      row('C', 'Follow Customize', pinned.length === 2 ? 'off: pinned in URL'
        : pinned.length ? `partly: ${pinned[0] === 'preset' ? 'preset' : 'liveblog'} pinned in URL` : 'on'),
      row('S', 'Screen', SCREENS.find(s => s.id === state.screen)?.label ?? state.screen.replace('x', '×')),
      row('M', 'macOS overlay', state.chrome ? 'on' : 'off'),
      row('D', 'Dock', state.dockHidden ? 'hides itself (dock=0)' : `${state.dock.width}×${state.dock.height} kept clear`),
      row('R', 'Refresh', state.fetchedAt ? `last ${clock(state.fetchedAt)}${state.error ? ' (error)' : ''}` : '…'),
      row('?', 'Hide this panel', ''),
    ),
    h('ul', { class: 'hud-presets' }, PRESETS.map(p =>
      h('li', { class: p.id === state.preset ? 'is-active' : null, 'data-preset': p.id }, h('b', null, p.name), ' ', p.description),
    )),
    h('p', { class: 'hud-links' },
      h('a', { href: '/customize/', target: '_blank' }, 'Customize'),
      h('a', { href: '/explorer/', target: '_blank' }, 'Explorer')),
  );

  function row(key, label, value, from) {
    return [
      h('dt', null, key && h('kbd', null, key), ' ', label),
      h('dd', null, h('span', null, value ?? ''), from && h('small', null, from)),
    ];
  }

  // Where the preset or the liveblog comes from.
  function origin(key) {
    if (state.pinned[key]) return 'pinned in URL';
    return state.settings ? 'from Customize' : 'default: settings not loaded';
  }

  function followLabel() {
    const d = state.data;
    if (state.follow === 'auto') return `auto → ${d?.focus?.topic ?? '…'}`;
    const topic = d?.liveblogs?.find(b => b.id === state.follow)?.topic;
    if (topic) return topic;
    // The server fell back to the most active blog: the pick did not load.
    return d?.follow === state.follow && d.focus ? `${state.follow} not loaded → ${d.focus.topic}` : state.follow;
  }

  // Front-page designs: the server puts the liveblogs picked on Customize
  // first (L does not apply to them).
  function leadRow() {
    const picked = (state.data?.top ?? []).filter(s => s.featured);
    return row(null, 'Lead liveblog', picked[0]?.title ?? "none: VRT's own lead",
      state.settings ? `${picked.length} picked on Customize` : 'settings not loaded');
  }
}

// From a key or the HUD this pins the preset in the URL. From the settings it
// does not, and it always fetches: the settings change the data too.
async function setPreset(id, { pin = true } = {}) {
  const sourceChanged = dataSource(id) !== dataSource();
  const wasPinned = state.pinned.preset;
  state.preset = id;
  if (pin) state.pinned.preset = true;
  if (sourceChanged) {
    state.data = null;
    state.seenPostIds.clear();
    state.fresh = new Set();
  }
  // A key press within one source waits for a fetch an earlier switch started.
  const fetched = sourceChanged || !pin ? fetchData({ markFresh: pin }) : !state.data && lastFetch;
  try {
    if (!await loadPreset(id, fetched)) return; // another switch overtook this one
  } catch (err) {
    // A preset that does not load (a syntax error while editing it): back to
    // the one still on screen, so the page keeps refreshing.
    console.error(`Preset "${id}" failed to load:`, err);
    toast(`Preset ${id} laadt niet`);
    if (id === state.preset && presetId && presetId !== id) {
      state.pinned.preset = wasPinned; // a failed key press pins nothing
      await setPreset(presetId, { pin: false });
    }
    return;
  }
  render();
  renderHud();
  if (!pin) return;
  syncUrl();
  toast(PRESETS.find(p => p.id === id)?.name ?? id);
}

async function cycleFollow() {
  if (dataSource() !== SOURCES.wallpaper) return;
  const ids = ['auto', ...(state.data?.liveblogs ?? []).map(b => b.id)];
  state.follow = ids[(ids.indexOf(state.follow) + 1) % ids.length];
  state.pinned.follow = true;
  syncUrl();
  await fetchData({ markFresh: false });
  render();
  renderHud();
  const topic = state.data?.focus?.topic;
  toast(state.follow === 'auto' ? `Liveblog: automatisch (${topic})` : `Liveblog: ${topic}`);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = PRESETS.findIndex(p => p.id === state.preset);
  switch (e.key) {
    case 'ArrowRight': setPreset(PRESETS[(i + 1) % PRESETS.length].id); break;
    case 'ArrowLeft': setPreset(PRESETS[(i - 1 + PRESETS.length) % PRESETS.length].id); break;
    case 'l': case 'L': cycleFollow(); break;
    case 'c': case 'C': followCustomize(); break;
    case 'm': case 'M':
      state.chrome = !state.chrome;
      applyScreen(); syncUrl(); render(); renderHud(); // the menu bar inset may change
      toast(`macOS overlay ${state.chrome ? 'on' : 'off'}`);
      break;
    case 'd': case 'D':
      state.dockHidden = !state.dockHidden;
      applyScreen(); syncUrl(); render(); renderHud();
      toast(state.dockHidden ? 'Dock hides itself' : 'Dock kept clear');
      break;
    case 's': case 'S': {
      const j = SCREENS.findIndex(s => s.id === state.screen);
      state.screen = SCREENS[(j + 1) % SCREENS.length].id;
      applyScreen(); syncUrl(); render(); renderHud();
      toast(`${SCREENS.find(s => s.id === state.screen).label}${state.screen === 'fill' ? '' : ` · ${state.screen.replace('x', '×')}`}`);
      break;
    }
    case 'r': case 'R': refresh(true); break;
    case '?': case 'h': case 'H':
      els.hud.hidden = !els.hud.hidden;
      renderHud();
      break;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

async function refresh(announce = false) {
  const changed = await fetchData();
  if (changed) render();
  renderHud();
  if (announce) toast(state.error ? `Vernieuwen mislukt: ${state.error}` : `Vernieuwd om ${clock(state.fetchedAt)}`);
}

// What the app calls before each picture: catch up with the settings, fetch,
// render, and wait until the fonts and images are in, so the picture is
// complete. Resolves to { ok, error, fetchedAt }; on an error the page still
// shows the last news it had.
async function update() {
  await ready;
  const settings = await host.loadSettings();
  if (settings && settings.updatedAt !== state.settings?.updatedAt) {
    state.settings = settings;
    await followSettings();
  } else {
    await fetchData();
  }
  tickClock();
  render();
  await settled();
  return { ok: !state.error, error: state.error, fetchedAt: state.fetchedAt?.toISOString() ?? null };
}

// Waits for the web fonts (then lays out again) and for every image on the
// wallpaper, at most `timeoutMs`: an image that never loads must not hold up
// the picture.
async function settled(timeoutMs = 8000) {
  await document.fonts.ready;
  layout();
  const images = [...els.wallpaper.querySelectorAll('img')].map(img => img.decode().catch(() => {}));
  await Promise.race([Promise.all(images), new Promise(resolve => setTimeout(resolve, timeoutMs))]);
}

async function start() {
  // Listen from the start: a window resized while the page loads must scale it
  // again too. render() waits until there is a preset and news to draw.
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { applyScreen(); render(); }, 120);
  });
  // What the URL does not pin comes from the settings (the defaults without them).
  state.settings = await host.loadSettings();
  applyScreen();
  tickClock();
  if (!state.pinned.preset) state.preset = settingsPreset();
  if (!state.pinned.follow) state.follow = settingsFollow();
  try {
    await loadPreset(state.preset, fetchData());
  } catch (err) {
    // As in setPreset: a preset that does not load must not stop the page.
    console.error(`Preset "${state.preset}" failed to load:`, err);
    toast(`Preset ${state.preset} laadt niet`);
    await setPreset(PRESETS.find(p => p.id !== state.preset).id, { pin: false });
  }
  render();
  renderHud();
  if (!(state.pinned.preset && state.pinned.follow)) listen();
  // The Customize preview lets go of its stream while that tab is hidden: a
  // browser keeps six connections to this server at most. The server sends
  // the settings again on reconnect, and onSettings catches up from those.
  if (window.self !== window.top) document.addEventListener('visibilitychange', () => {
    if (document.hidden) { listen.stop?.(); listen.stop = null; }
    else if (!(state.pinned.preset && state.pinned.follow)) listen();
  });
  // Web fonts only start loading once text uses them; lay out again when they land.
  document.fonts.ready.then(layout);
  document.fonts.addEventListener?.('loadingdone', layout);

  // The app decides when the page refreshes (see update); a browser keeps it
  // fresh itself, and re-renders each minute so relative times ("4 min
  // geleden") stay right.
  if (!host.inApp) {
    setInterval(refresh, state.refreshMs);
    setTimeout(function minute() {
      tickClock();
      render();
      setTimeout(minute, 60_000 - (Date.now() % 60_000) + 50);
    }, 60_000 - (Date.now() % 60_000) + 50);
  }

  addEventListener('keydown', onKey);
  els.hud.addEventListener('click', e => {
    const id = e.target.closest('[data-preset]')?.dataset.preset;
    if (id) setPreset(id);
  });
  // VRT's resized image URLs occasionally miss; fall back to the original.
  addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && imageFallbacks.has(img.src)) img.src = imageFallbacks.get(img.src);
  }, true);

  if (state.showHint) toast('Druk op ? voor de bediening', 3500);
}

// What the app (and the console) can reach. Set before start() so the app can
// call refresh() as soon as the page has loaded; it waits for `ready`.
const ready = start();
window.wallpaper = {
  ready,
  refresh: update,
  sources,
  presets: PRESETS,
  state, setPreset, followCustomize, render,
};
