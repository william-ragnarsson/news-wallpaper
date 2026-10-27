// Stream explorer: browse every integrated outlet and stream, and inspect the
// normalized items exactly as the wallpaper will receive them. A data tool,
// not a design: each item shows what the integration extracted, with the
// normalized JSON and the raw upstream entry one click away. Streams picked
// in the settings (.dev/settings.json) carry a quiet mark.

const REFRESH_MS = 60_000;

const LANGUAGES = { nl: 'Nederlands', fr: 'Français', de: 'Deutsch', en: 'English' };

// The outlet the wallpaper shows. The settings pick which of its liveblogs
// lead the front page and which sections follow.
const WALLPAPER_OUTLET = 'vrt-nws';

const params = new URLSearchParams(location.search);
const state = {
  outlets: [],
  outletId: params.get('outlet'),
  streams: [],
  streamId: params.get('stream'),
  view: params.get('view') === 'health' ? 'health' : 'stream',
  payload: null,
  loading: false,
  error: null,
  health: new Map(),     // outletId → { checkedAt, streams: Map<streamId, result> }
  healthAll: null,       // result of /api/health for the health view
  rawById: null,         // id → raw upstream entry, fetched on demand
  expanded: new Set(),
  openData: new Map(),   // item id → 'json' | 'raw'
  seen: new Map(),       // "outlet/stream" → Set of item ids already shown
  fresh: new Set(),
  picks: null,           // picked in the settings, from /api/settings/events: { liveblogs, sections }
};

const els = {
  outlets: document.getElementById('outlets'),
  streams: document.getElementById('streams'),
  stream: document.getElementById('stream'),
};

// ---------------------------------------------------------------------------
// Data

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function loadOutlets() {
  state.outlets = (await api('/api/outlets')).outlets;
  if (!state.outlets.some(o => o.id === state.outletId)) state.outletId = state.outlets[0]?.id ?? null;
  renderOutlets();
}

async function loadStreams({ check = false } = {}) {
  if (!state.outletId) return;
  const outletId = state.outletId;
  try {
    const { streams } = await api(`/api/outlets/${outletId}/streams`);
    if (outletId !== state.outletId) return;
    state.streams = streams;
    if (!streams.some(s => s.id === state.streamId) && !/^liveblog-\d+$/.test(state.streamId ?? '')) {
      state.streamId = streams[0]?.id ?? null;
    }
  } catch (err) {
    state.streams = [];
    state.error = err.message;
  }
  renderStreams();
  if (check || !state.health.has(outletId)) checkOutlet(outletId);
}

async function checkOutlet(outletId) {
  try {
    const { checkedAt, streams } = await api(`/api/outlets/${outletId}/health`);
    state.health.set(outletId, { checkedAt, streams: new Map(streams.map(s => [s.streamId, s])) });
    if (outletId === state.outletId) renderStreams();
  } catch (err) {
    console.warn(`Health check failed for ${outletId}:`, err);
  }
}

async function loadStream({ quiet = false } = {}) {
  if (!state.outletId || !state.streamId) return;
  const key = `${state.outletId}/${state.streamId}`;
  if (!quiet) {
    state.loading = true;
    state.payload = null;
    state.rawById = null;
    state.expanded.clear();
    state.openData.clear();
    renderStream();
  }
  try {
    const payload = await api(`/api/outlets/${state.outletId}/streams/${state.streamId}`);
    if (key !== `${state.outletId}/${state.streamId}`) return;
    const seen = state.seen.get(key);
    state.fresh = seen ? new Set(payload.items.map(i => i.id).filter(id => !seen.has(id))) : new Set();
    state.seen.set(key, new Set([...(seen ?? []), ...payload.items.map(i => i.id)]));
    if (quiet && state.rawById && state.fresh.size) state.rawById = null;
    state.payload = payload;
    state.error = null;
  } catch (err) {
    if (!quiet) state.payload = null;
    state.error = err.message;
  }
  state.loading = false;
  renderStream();
}

async function loadRaw() {
  const { outlet, stream } = state.payload;
  const payload = await api(`/api/outlets/${outlet.id}/streams/${stream.id}?raw=1`);
  state.rawById = new Map(payload.items.map(i => [i.id, i.raw ?? '(no raw source for this item)']));
}

async function loadHealthAll() {
  state.healthAll = null;
  renderStream();
  try {
    state.healthAll = await api('/api/health');
  } catch (err) {
    state.healthAll = { error: err.message };
  }
  renderStream();
}

// What the owner picked in the settings. The server sends the settings
// on connect and after every change; without them, no marks. Open only while
// the tab is in view: a browser keeps six connections to this server at most.
let settingsEvents = null;
function watchSettings() {
  if (document.hidden) {
    settingsEvents?.close();
    settingsEvents = null;
  } else if (!settingsEvents) {
    settingsEvents = new EventSource('/api/settings/events');
    settingsEvents.addEventListener('settings', e => applySettings(JSON.parse(e.data)));
  }
}

// Redraws the marks only: the streams pane keeps its scroll, the stream pane
// its items, and the selected stream and view stay as they are.
function applySettings(settings) {
  const list = v => Array.isArray(v) ? v : [];
  state.picks = { liveblogs: list(settings?.liveblogs), sections: list(settings?.sections) };
  renderStreams();
  const head = els.stream.querySelector('.stream-head');
  if (state.view === 'stream' && state.payload && head) head.replaceWith(streamHeader(state.payload));
}

// ---------------------------------------------------------------------------
// Navigation

function selectOutlet(id) {
  if (id === state.outletId && state.view === 'stream') return;
  state.outletId = id;
  state.view = 'stream';
  state.streams = [];
  state.streamId = null;
  syncUrl();
  renderOutlets();
  renderStreams();
  loadStreams().then(() => {
    syncUrl();
    loadStream();
  });
}

function selectStream(id) {
  state.streamId = id;
  state.view = 'stream';
  syncUrl();
  renderOutlets();
  renderStreams();
  loadStream();
}

function showHealth() {
  state.view = 'health';
  syncUrl();
  renderOutlets();
  renderStreams();
  loadHealthAll();
}

function syncUrl() {
  const q = new URLSearchParams();
  if (state.outletId) q.set('outlet', state.outletId);
  if (state.streamId) q.set('stream', state.streamId);
  if (state.view === 'health') q.set('view', 'health');
  history.replaceState(null, '', `?${q}`);
}

// ---------------------------------------------------------------------------
// Outlets pane

function renderOutlets() {
  const byLanguage = groupBy(state.outlets, o => o.language);
  els.outlets.replaceChildren(
    h('p', { class: 'pages' }, h('a', { href: '/' }, 'Wallpaper')),
    h('header', { class: 'pane-head' }, h('h1', null, 'Outlets'), h('span', { class: 'muted' }, `${state.outlets.length}`)),
    h('div', { class: 'pane-body' },
      Object.keys(LANGUAGES).filter(l => byLanguage.has(l)).concat([...byLanguage.keys()].filter(l => !LANGUAGES[l]))
        .map(lang => h('section', null,
          h('h2', null, LANGUAGES[lang] ?? lang),
          byLanguage.get(lang).map(o => h('button', {
            class: 'row outlet',
            'aria-current': o.id === state.outletId && state.view === 'stream' ? 'true' : null,
            title: o.description,
            onclick: () => selectOutlet(o.id),
          },
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, o.name), h('span', { class: 'row-sub' }, o.owner)),
            h('span', { class: 'row-meta' }, o.streamCount, o.hasLive ? h('i', { class: 'dot live', title: 'Has live streams' }) : null),
          )),
        ))),
    h('footer', { class: 'pane-foot' },
      h('button', { class: 'link', 'aria-current': state.view === 'health' ? 'true' : null, onclick: showHealth }, 'Check every stream'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Streams pane

function renderStreams() {
  const outlet = state.outlets.find(o => o.id === state.outletId);
  if (!outlet) return els.streams.replaceChildren();
  const health = state.health.get(outlet.id);
  const groups = groupBy(state.streams, s => s.group);
  // Keep the list where it was on a refresh, not when the outlet changes.
  const scroll = els.streams.dataset.outlet === outlet.id ? els.streams.querySelector('.pane-body')?.scrollTop ?? 0 : 0;
  els.streams.dataset.outlet = outlet.id;

  els.streams.replaceChildren(
    h('header', { class: 'pane-head' },
      h('h1', null, outlet.name),
      h('a', { class: 'muted', href: safeUrl(outlet.homepage), target: '_blank', rel: 'noreferrer' }, hostOf(outlet.homepage)),
    ),
    h('div', { class: 'pane-body' },
      state.streams.length ? null : h('p', { class: 'empty' }, 'Loading streams…'),
      [...groups].map(([group, streams]) => h('section', null,
        h('h2', null, group),
        streams.map(s => streamRow(s, health?.streams.get(s.id))),
      )),
    ),
    h('footer', { class: 'pane-foot muted' },
      health ? `Checked ${clock(health.checkedAt)}` : 'Checking streams…',
      health ? h('button', { class: 'link', onclick: () => checkOutlet(outlet.id) }, 'Recheck') : null,
    ),
  );
  els.streams.querySelector('.pane-body').scrollTop = scroll;
}

function streamRow(s, check) {
  const failed = check && !check.ok;
  const count = check?.ok ? check.stats.count : null;
  const newest = check?.ok ? check.stats.newestAt : s.updatedAt;
  const warn = check?.warnings?.length ? check.warnings.join('\n') : null;
  const role = wallpaperRole(state.outletId, s.id);
  return h('button', {
    class: 'row stream',
    'aria-current': s.id === state.streamId && state.view === 'stream' ? 'true' : null,
    title: [s.description, s.url, failed ? `Error: ${check.error}` : null, warn, role ? `Picked in the settings (${role})` : null]
      .filter(Boolean).join('\n'),
    onclick: () => selectStream(s.id),
  },
    s.kind === 'liveblog' ? h('i', { class: `dot ${s.live ? 'live' : 'ended'}`, title: s.live ? 'Live' : 'Ended' }) : null,
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, s.name),
      h('span', { class: 'row-sub' }, [
        s.derived ? 'filtered' : s.kind === 'feed' ? null : s.kind,
        s.language !== state.outlets.find(o => o.id === state.outletId)?.language ? s.language : null,
        newest ? ago(newest) : null,
      ].filter(Boolean).join(' · ')),
    ),
    h('span', { class: 'row-meta' },
      failed ? h('span', { class: 'bad' }, check.status) : count ?? '',
      warn ? h('span', { class: 'warn', title: warn }, '!') : null,
      role ? pickMark(role) : null,
    ),
  );
}

// Where a stream was picked in the settings, or null. The picked liveblogs open
// the front page (the first leads it); the picked sections show in order on the
// designs that have sections.
function wallpaperRole(outletId, streamId) {
  const picks = state.picks;
  if (!picks || outletId !== WALLPAPER_OUTLET) return null;
  const liveblog = picks.liveblogs.indexOf(/^liveblog-(\d+)$/.exec(streamId ?? '')?.[1]);
  if (liveblog === 0) return 'lead liveblog';
  if (liveblog > 0) return `liveblog ${liveblog + 1} of ${picks.liveblogs.length}`;
  const section = picks.sections.indexOf(streamId);
  return section >= 0 ? `section ${section + 1} of ${picks.sections.length}` : null;
}

function pickMark(role) {
  return h('i', {
    class: `dot pick${role === 'lead liveblog' ? ' lead' : ''}`,
    title: `Picked in the settings (${role})`,
  });
}

// ---------------------------------------------------------------------------
// Stream pane

function renderStream() {
  if (state.view === 'health') return renderHealth();
  const p = state.payload;
  const meta = state.streams.find(s => s.id === state.streamId);
  if (!p) {
    return els.stream.replaceChildren(h('div', { class: 'stream-empty' },
      state.error && !state.loading ? h('p', { class: 'bad' }, state.error)
        : h('p', { class: 'muted' }, state.streamId ? `Loading ${meta?.name ?? state.streamId}…` : 'Pick a stream'),
    ));
  }

  const scroll = els.stream.querySelector('.items')?.scrollTop ?? 0;
  els.stream.replaceChildren(
    streamHeader(p),
    h('div', { class: 'items' },
      p.header ? liveblogHeader(p.header) : null,
      p.items.length ? p.items.map(item => itemCard(item, p)) : h('p', { class: 'empty' }, 'This stream has no items right now.'),
    ),
  );
  els.stream.querySelector('.items').scrollTop = scroll;
}

function streamHeader(p) {
  const { stats, upstream } = p;
  const role = wallpaperRole(p.outlet.id, p.stream.id);
  return h('header', { class: 'stream-head' },
    h('div', { class: 'stream-title' },
      h('h1', null, p.stream.name),
      h('span', { class: 'muted' }, p.outlet.name),
      p.stream.derived ? h('span', { class: 'badge' }, 'filtered from feed') : null,
    ),
    p.stream.description ? h('p', { class: 'stream-desc' }, p.stream.description) : null,
    role ? h('p', { class: 'on-wallpaper' }, pickMark(role), `Picked in the settings · ${role}`) : null,
    h('dl', { class: 'facts' },
      fact('Items', stats.count),
      fact('Newest', stats.newestAt ? `${stamp(stats.newestAt)} (${ago(stats.newestAt)})` : '—'),
      fact('Oldest', stats.oldestAt ? stamp(stats.oldestAt) : '—'),
      fact('Fetched', `${clock(p.fetchedAt)}${upstream.ms != null ? ` · ${upstream.ms} ms` : ''}${upstream.bytes ? ` · ${kb(upstream.bytes)}` : ''}`),
      fact('Source', h('a', { href: safeUrl(upstream.url), target: '_blank', rel: 'noreferrer' }, upstream.format ?? 'feed', ' ', shortUrl(upstream.url))),
    ),
    h('div', { class: 'coverage', title: 'Share of items that have each field' },
      Object.entries(stats.coverage).map(([field, share]) => h('span', {
        class: `chip ${share >= 0.9 ? 'good' : share >= 0.5 ? 'fair' : 'poor'}`,
      }, `${field} ${Math.round(share * 100)}%`)),
      stats.premium ? h('span', { class: 'chip fair' }, `${stats.premium} premium`) : null,
      state.error ? h('span', { class: 'chip poor', title: state.error }, 'refresh failed') : null,
    ),
  );
}

function liveblogHeader(b) {
  return h('section', { class: 'liveblog-head' },
    b.image ? img(b.image, 'liveblog-image') : null,
    h('div', null,
      h('p', { class: 'kicker' },
        h('span', { class: `pill ${b.status === 'live' ? 'live' : 'ended'}` }, b.status === 'live' ? 'LIVE' : 'Ended'),
        [b.label, b.topic, b.section].filter(Boolean).join(' · '),
      ),
      h('h2', null, b.title),
      b.intro ? h('p', null, b.intro) : null,
      b.summary ? h('div', { class: 'summary-box' },
        h('h3', null, b.summary.title),
        h('ul', null, b.summary.points.map(pt => h('li', null, pt))),
      ) : null,
      h('p', { class: 'muted' },
        `${b.postCount} posts · started ${b.startedAt ? stamp(b.startedAt) : '?'} · last post ${b.updatedAt ? ago(b.updatedAt) : '?'} · `,
        b.url ? h('a', { href: safeUrl(b.url), target: '_blank', rel: 'noreferrer' }, 'open on site ↗') : null,
      ),
    ),
  );
}

function itemCard(item, p) {
  const open = state.expanded.has(item.id);
  const body = item.paragraphs ?? [];
  const lead = item.summary ?? body.slice(0, 2).join(' ');
  return h('article', {
    class: ['item', open && 'open', state.fresh.has(item.id) && 'fresh', item.highlight && 'highlight'].filter(Boolean).join(' '),
  },
    h('div', { class: 'item-row', onclick: e => { if (!e.target.closest('a')) toggle(item.id); } },
      item.image ? img(item.image, 'thumb') : h('div', { class: 'thumb none' }),
      h('div', { class: 'item-main' },
        h('p', { class: 'item-meta' },
          h('span', { class: `kind kind-${item.kind}` }, item.kind),
          item.live != null ? h('span', { class: `pill ${item.live ? 'live' : 'ended'}` }, item.live ? 'LIVE' : 'Ended') : null,
          item.premium ? h('span', { class: 'pill premium' }, 'premium') : null,
          h('time', { datetime: item.publishedAt ? new Date(item.publishedAt).toISOString() : null, title: item.publishedAt ? new Date(item.publishedAt).toString() : 'no date' },
            item.publishedAt ? `${stamp(item.publishedAt)} · ${ago(item.publishedAt)}` : 'no date'),
          item.updatedAt ? h('span', { class: 'muted', title: new Date(item.updatedAt).toString() }, `updated ${ago(item.updatedAt)}`) : null,
          item.authors.length ? h('span', null, item.authors.join(', ')) : null,
          item.postCount != null ? h('span', { class: 'muted' }, `${item.postCount} posts`) : null,
        ),
        item.title ? h('h3', { class: 'item-title' }, item.title) : null,
        !open && lead ? h('p', { class: 'item-lead' }, lead) : null,
        item.categories.length ? h('p', { class: 'cats' }, item.categories.map(c => h('span', { class: 'cat' }, c))) : null,
      ),
    ),
    open ? itemDetail(item, p) : null,
  );
}

function itemDetail(item, p) {
  const tab = state.openData.get(item.id);
  return h('div', { class: 'item-detail' },
    item.blocks ? h('div', { class: 'blocks' }, item.blocks.map(block)) : [
      item.summary ? h('p', { class: 'item-summary' }, item.summary) : null,
      (item.paragraphs ?? []).map(t => h('p', null, t)),
    ],
    item.image ? h('p', { class: 'muted small' },
      `Image from ${item.image.source}`,
      item.image.width ? ` · ${item.image.width}×${item.image.height ?? '?'}` : '',
      item.image.credit ? ` · © ${item.image.credit}` : '',
      item.image.alt ? ` · alt: “${item.image.alt}”` : '',
    ) : null,
    h('p', { class: 'item-actions' },
      item.url ? h('a', { href: safeUrl(item.url), target: '_blank', rel: 'noreferrer' }, 'Open on site ↗') : null,
      item.streamId && item.streamId !== p.stream.id
        ? h('button', { class: 'link', onclick: () => selectStream(item.streamId) }, 'Open as stream →') : null,
      h('button', { class: 'link', 'aria-pressed': tab === 'json' ? 'true' : null, onclick: () => showData(item.id, 'json') }, 'Normalized JSON'),
      h('button', { class: 'link', 'aria-pressed': tab === 'raw' ? 'true' : null, onclick: () => showData(item.id, 'raw') }, 'Raw source'),
    ),
    tab === 'json' ? h('pre', { class: 'code' }, JSON.stringify(withoutRaw(item), null, 2)) : null,
    tab === 'raw' ? h('pre', { class: 'code' }, state.rawById ? state.rawById.get(item.id) ?? '(item not in the latest fetch)' : 'Loading…') : null,
  );
}

// Liveblog post content, in the order VRT lays it out.
function block(b) {
  switch (b.type) {
    case 'text':
      return b.paragraphs.map(t => h('p', { class: b.emphasised ? 'emph' : null }, t));
    case 'image':
      return b.image ? h('figure', null, img(b.image, 'block-image'), caption(b.image)) : null;
    case 'video':
      return h('figure', null, b.image ? img(b.image, 'block-image') : null,
        h('figcaption', null, `▶ Video${b.durationSec ? ` · ${duration(b.durationSec)}` : ''}${b.name ? ` · ${b.name}` : ''}`));
    case 'audio':
      return h('p', { class: 'block-note' }, `♪ ${[b.title, b.show, b.duration].filter(Boolean).join(' · ')}`);
    case 'quote':
      return h('blockquote', null, h('p', null, b.text), b.by ? h('cite', null, b.by) : null);
    case 'teaser':
      return h('p', { class: 'block-note' }, `${b.label ?? 'Lees ook'}: `,
        b.url ? h('a', { href: safeUrl(b.url), target: '_blank', rel: 'noreferrer' }, b.title) : b.title);
    case 'embed':
      return h('p', { class: 'block-note' }, `[${b.network}] `, b.text || b.title || '',
        b.attribution ? ` — ${b.attribution}` : '',
        b.url ? [' ', h('a', { href: safeUrl(b.url), target: '_blank', rel: 'noreferrer' }, '↗')] : null);
    default:
      return null;
  }
}

function caption(image) {
  const text = [image.caption, image.credit && `© ${image.credit}`].filter(Boolean).join(' · ');
  return text ? h('figcaption', null, text) : null;
}

function toggle(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderStream();
}

async function showData(id, tab) {
  if (state.openData.get(id) === tab) state.openData.delete(id);
  else state.openData.set(id, tab);
  renderStream();
  if (tab === 'raw' && !state.rawById) {
    try {
      await loadRaw();
    } catch (err) {
      state.rawById = new Map([[id, `Could not load the raw source: ${err.message}`]]);
    }
    renderStream();
  }
}

function withoutRaw({ raw, ...item }) {
  return item;
}

// ---------------------------------------------------------------------------
// Health view: every stream of every outlet in one table

function renderHealth() {
  const result = state.healthAll;
  els.stream.replaceChildren(
    h('header', { class: 'stream-head' },
      h('div', { class: 'stream-title' }, h('h1', null, 'Stream health'),
        result?.checkedAt ? h('span', { class: 'muted' }, `checked ${clock(result.checkedAt)}`) : null,
        h('button', { class: 'link', onclick: loadHealthAll }, 'Run again')),
      h('p', { class: 'stream-desc' }, 'Loads every listed stream and reports what came back: item counts, freshness and field coverage.'),
    ),
    h('div', { class: 'items' },
      !result ? h('p', { class: 'empty' }, 'Loading every stream… this takes a few seconds.')
        : result.error ? h('p', { class: 'bad' }, result.error)
        : healthTable(result.streams),
    ),
  );
}

function healthTable(rows) {
  const failed = rows.filter(r => !r.ok).length;
  const warned = rows.filter(r => r.warnings.length).length;
  const names = new Map(state.outlets.map(o => [o.id, o.name]));
  return [
    h('p', { class: 'health-summary' }, `${rows.length} streams · `,
      h('span', { class: failed ? 'bad' : 'good' }, `${failed} failing`), ' · ',
      h('span', { class: warned ? 'warn' : 'good' }, `${warned} with warnings`)),
    h('table', { class: 'health' },
      h('thead', null, h('tr', null, ['Outlet', 'Stream', 'Status', 'Items', 'Newest', 'Date', 'Image', 'Summary', 'Author', 'Notes'].map(t => h('th', null, t)))),
      h('tbody', null, rows.map(r => h('tr', { class: r.ok ? null : 'failed' },
        h('td', null, names.get(r.outletId) ?? r.outletId),
        h('td', null, h('button', { class: 'link', onclick: () => { state.outletId = r.outletId; loadStreams().then(() => selectStream(r.streamId)); } }, r.name)),
        h('td', null, r.ok ? h('span', { class: 'good' }, r.upstream.status ?? 'ok') : h('span', { class: 'bad', title: r.error }, r.status)),
        h('td', { class: 'num' }, r.ok ? r.stats.count : ''),
        h('td', null, r.ok && r.stats.newestAt ? ago(r.stats.newestAt) : ''),
        ['date', 'image', 'summary', 'author'].map(f => h('td', { class: 'num' }, r.ok ? pct(r.stats.coverage[f]) : '')),
        h('td', { class: 'notes' }, r.ok ? r.warnings.join('; ') : r.error),
      ))),
    ),
  ];
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
  return `${Math.floor(hours / 24)} days ago`;
}

function duration(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function kb(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

function pct(share) {
  return `${Math.round(share * 100)}%`;
}

function fact(label, value) {
  return [h('dt', null, label), h('dd', null, value)];
}

function img(image, cls) {
  return h('img', { class: cls, src: safeUrl(image.url), alt: image.alt || '', loading: 'lazy', referrerpolicy: 'no-referrer' });
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url ?? '') ? url : null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url ?? '';
  }
}

function shortUrl(url) {
  return String(url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/(.{60}).+/, '$1…');
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

async function refresh() {
  if (document.hidden || state.view !== 'stream') return;
  await loadStreams();
  await loadStream({ quiet: true });
}

watchSettings();
try {
  await loadOutlets();
  await loadStreams();
  syncUrl();
  if (state.view === 'health') showHealth();
  else await loadStream();
} catch (err) {
  els.stream.replaceChildren(h('div', { class: 'stream-empty' }, h('p', { class: 'bad' }, `Could not reach the API: ${err.message}`)));
}
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  watchSettings();
  refresh();
});
