// Wallpaper host. Plays the role the macOS app will play later: it fetches the
// normalized news data, picks a preset, renders it full-screen and keeps it fresh.
// Dev controls live in a HUD (press ?) and never become part of the wallpaper.

import { PRESETS } from './presets/index.js';

const SCREENS = [
  { id: 'fill', label: 'Fill window' },
  { id: '1440x900', label: 'MacBook Air 13″' },
  { id: '1512x982', label: 'MacBook Pro 14″' },
  { id: '1728x1117', label: 'MacBook Pro 16″' },
  { id: '2560x1440', label: 'Studio Display' },
  { id: '3440x1440', label: 'Ultrawide 34″' },
];

const IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1600, 1920];
const DOCK_TILE = 52;
const DOCK_TILES = 12;

const params = new URLSearchParams(location.search);
const state = {
  preset: PRESETS.some(p => p.id === params.get('preset')) ? params.get('preset') : PRESETS[0].id,
  follow: params.get('follow') || 'auto',
  chrome: params.get('chrome') !== '0',
  screen: SCREENS.some(s => s.id === params.get('screen')) ? params.get('screen') : 'fill',
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
const imageFallbacks = new Map();

// ---------------------------------------------------------------------------
// Data

async function fetchData() {
  const url = `/api/vrt-nws/wallpaper?follow=${encodeURIComponent(state.follow)}&posts=40&headlines=16`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const changed = signature(body) !== signature(state.data);
    const ids = [body.focus, ...body.liveblogs].flatMap(b => (b.posts ?? b.recent).map(p => p.id));
    state.fresh = state.seenPostIds.size ? new Set(ids.filter(id => !state.seenPostIds.has(id))) : new Set();
    ids.forEach(id => state.seenPostIds.add(id));
    state.data = body;
    state.error = null;
    state.fetchedAt = new Date();
    return changed;
  } catch (err) {
    state.error = err.message;
    console.warn('Wallpaper refresh failed:', err);
    return !state.data;
  }
}

function signature(d) {
  if (!d) return '';
  return [d.focus.id, d.focus.posts[0]?.id, ...d.liveblogs.map(b => b.updatedAt), d.headlines[0]?.id].join('|');
}

// ---------------------------------------------------------------------------
// Presets

async function loadPreset(id) {
  const href = `./presets/${id}/preset.css`;
  const cssLoaded = new Promise(resolve => {
    els.presetCss.onload = els.presetCss.onerror = resolve;
  });
  els.presetCss.href = href;
  const [mod] = await Promise.all([import(`./presets/${id}/preset.js`), cssLoaded]);
  preset = mod.default;
  els.desktop.dataset.tone = preset.tone ?? 'dark';
}

function render() {
  const root = els.wallpaper;
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
  const menubar = menubarHeight(width);
  return {
    now: new Date(),
    screen: { width, height, id: state.screen },
    safe: { top: menubar, bottom: DOCK_TILE + 26, dockWidth: dockWidth() },
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
  const resized = url.replace(/^(https:\/\/images\.vrt\.be\/)(orig|vrtnws_share|w\d+hx)\//, `$1w${want}hx/`);
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

function dockWidth() {
  return DOCK_TILES * (DOCK_TILE + 6) + 28;
}

function applyScreen() {
  const { width, height } = screenSize();
  const d = els.desktop;
  d.toggleAttribute('data-fixed', state.screen !== 'fill');
  d.style.setProperty('--screen-w', `${width}px`);
  d.style.setProperty('--screen-h', `${height}px`);
  d.style.setProperty('--screen-scale', screenScale());
  d.style.setProperty('--safe-top', `${menubarHeight(width)}px`);
  d.style.setProperty('--safe-bottom', `${DOCK_TILE + 26}px`);
  d.style.setProperty('--dock-width', `${dockWidth()}px`);
  d.style.setProperty('--dock-tile', `${DOCK_TILE}px`);
  els.chrome.hidden = !state.chrome;
}

function buildDock() {
  const hues = [210, 0, 130, 28, 280, 190, 48, 340, 160, 230, 15, 260];
  els.dock.replaceChildren(
    ...hues.slice(0, DOCK_TILES - 1).map(hue => h('i', { '--hue': hue })),
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

function syncUrl() {
  const p = new URLSearchParams();
  p.set('preset', state.preset);
  if (state.follow !== 'auto') p.set('follow', state.follow);
  if (state.screen !== 'fill') p.set('screen', state.screen);
  if (!state.chrome) p.set('chrome', '0');
  history.replaceState(null, '', `?${p}`);
}

function toast(text, ms = 1600) {
  els.toast.textContent = text;
  els.toast.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), ms);
}

function renderHud() {
  const d = state.data;
  const blogs = d?.liveblogs ?? [];
  const followLabel = state.follow === 'auto'
    ? `auto → ${d?.focus.topic ?? '…'}`
    : blogs.find(b => b.id === state.follow)?.topic ?? state.follow;
  els.hud.replaceChildren(
    h('h2', null, 'Wallpaper controls'),
    h('dl', null,
      row('← →', 'Preset', PRESETS.find(p => p.id === state.preset)?.name),
      row('L', 'Liveblog', followLabel),
      row('S', 'Screen', SCREENS.find(s => s.id === state.screen)?.label),
      row('M', 'macOS overlay', state.chrome ? 'on' : 'off'),
      row('R', 'Refresh', state.fetchedAt ? `last ${clock(state.fetchedAt)}${state.error ? ' (error)' : ''}` : '…'),
      row('?', 'Hide this panel', ''),
    ),
    h('ul', { class: 'hud-presets' }, PRESETS.map(p =>
      h('li', { class: p.id === state.preset ? 'is-active' : null, 'data-preset': p.id }, h('b', null, p.name), ' ', p.description),
    )),
  );
  function row(key, label, value) {
    return [h('dt', null, h('kbd', null, key), ' ', label), h('dd', null, value ?? '')];
  }
}

async function setPreset(id) {
  state.preset = id;
  await loadPreset(id);
  syncUrl();
  render();
  renderHud();
  toast(PRESETS.find(p => p.id === id)?.name ?? id);
}

async function cycleFollow() {
  const ids = ['auto', ...(state.data?.liveblogs ?? []).map(b => b.id)];
  state.follow = ids[(ids.indexOf(state.follow) + 1) % ids.length];
  syncUrl();
  await fetchData();
  render();
  renderHud();
  toast(state.follow === 'auto' ? `Liveblog: automatisch (${state.data?.focus.topic})` : `Liveblog: ${state.data?.focus.topic}`);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = PRESETS.findIndex(p => p.id === state.preset);
  switch (e.key) {
    case 'ArrowRight': setPreset(PRESETS[(i + 1) % PRESETS.length].id); break;
    case 'ArrowLeft': setPreset(PRESETS[(i - 1 + PRESETS.length) % PRESETS.length].id); break;
    case 'l': case 'L': cycleFollow(); break;
    case 'm': case 'M':
      state.chrome = !state.chrome;
      applyScreen(); syncUrl(); renderHud();
      toast(`macOS overlay ${state.chrome ? 'on' : 'off'}`);
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

async function start() {
  applyScreen();
  buildDock();
  tickClock();
  await Promise.all([loadPreset(state.preset), fetchData()]);
  render();
  renderHud();
  // Web fonts only start loading once text uses them; lay out again when they land.
  document.fonts.ready.then(layout);
  document.fonts.addEventListener?.('loadingdone', layout);

  setInterval(refresh, state.refreshMs);
  // Re-render on each minute so relative times ("4 min geleden") stay right.
  setTimeout(function minute() {
    tickClock();
    render();
    setTimeout(minute, 60_000 - (Date.now() % 60_000) + 50);
  }, 60_000 - (Date.now() % 60_000) + 50);

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { applyScreen(); render(); }, 120);
  });
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
  window.wallpaper = { state, setPreset, refresh, render };
}

start();
