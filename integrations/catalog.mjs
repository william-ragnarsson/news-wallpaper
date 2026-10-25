// The outlet catalog: every news outlet we integrate, the streams it offers,
// and one loader that turns any stream into the same normalized payload.
// Shapes are documented in integrations/README.md.
//
// An outlet module (integrations/outlets/<id>.mjs) is mostly data: a list of
// hand-verified streams. Optional hooks cover what the generic feed reader
// cannot know: normalize() fixes outlet quirks on every item, enrich() fills in
// what a feed leaves out from another source, liveStreams() adds streams that
// come and go (VRT's liveblogs), resolveStream() accepts stream ids that are
// not listed (a liveblog that just ended), and a stream's own load() replaces
// the feed reader for non-feed sources.

import { parseFeed, rawEntry, normalizeEntry } from './lib/feed.mjs';
import { cached, fetchResource, HttpError } from './lib/http.mjs';
import { OUTLETS } from './outlets/index.mjs';

export { HttpError };

const FEED_TTL_MS = 90_000;
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

// Sidebar order. Streams in a group keep their catalog order.
export const GROUPS = ['Top stories', 'Live', 'News', 'Politics', 'World', 'Economy', 'Regional', 'Sport', 'Culture',
  'Science & Tech', 'Opinion', 'Lifestyle', 'In English', 'Other'];

const registry = [...OUTLETS];
const byId = new Map(registry.map(o => [o.id, o]));

// For tools that try out an outlet module before it is listed in outlets/index.mjs.
export function registerOutlet(outlet) {
  if (byId.has(outlet.id)) throw new Error(`Outlet ${outlet.id} is already registered`);
  registry.push(outlet);
  byId.set(outlet.id, outlet);
}

// ---------------------------------------------------------------------------
// Public API

export function listOutlets() {
  return {
    outlets: registry.map(o => ({
      ...describeOutlet(o),
      streamCount: o.streams.length,
      hasLive: Boolean(o.liveStreams),
    })),
  };
}

export async function listStreams(outletId) {
  const outlet = getOutlet(outletId);
  const live = await liveStreamsOf(outlet);
  return {
    outlet: describeOutlet(outlet),
    streams: sortByGroup([...outlet.streams, ...live]).map(s => describeStream(outlet, s)),
  };
}

export async function loadStream(outletId, streamId, { raw = false } = {}) {
  const outlet = getOutlet(outletId);
  const stream = await findStream(outlet, streamId);
  const result = stream.load ? await stream.load({ raw }) : await loadFeed(outlet, stream, { raw });
  const items = dedupe(result.items);
  if (!stream.keepOrder) items.sort(newestFirst);
  return {
    outlet: describeOutlet(outlet),
    stream: describeStream(outlet, stream),
    fetchedAt: result.fetchedAt,
    upstream: result.upstream,
    header: result.header ?? null,
    stats: itemStats(items),
    items,
  };
}

// Loads every listed stream of one outlet (or of all outlets) and reports
// what came back. Powers the explorer's health view and tools/check-feeds.mjs.
export async function checkStreams(outletId) {
  const outlets = outletId ? [getOutlet(outletId)] : registry;
  const jobs = outlets.flatMap(o => o.streams.map(s => ({ o, s })));
  const results = await mapLimit(jobs, 6, async ({ o, s }) => {
    const base = { outletId: o.id, streamId: s.id, name: s.name, group: s.group, url: s.url ?? null, staleAfterDays: s.staleAfterDays ?? 7 };
    try {
      const p = await loadStream(o.id, s.id);
      return { ...base, ok: true, upstream: p.upstream, stats: p.stats, ids: p.items.map(i => i.id).sort().join('\n') };
    } catch (err) {
      return { ...base, ok: false, error: err.message, status: err.status ?? 500 };
    }
  });
  return {
    checkedAt: Date.now(),
    streams: results.map(({ ids, ...r }) => ({ ...r, warnings: warningsFor(r, ids, results) })),
  };
}

// ---------------------------------------------------------------------------
// Feeds

async function loadFeed(outlet, stream, { raw }) {
  const feed = await cached(`feed:${stream.url}`, stream.ttlMs ?? outlet.ttlMs ?? FEED_TTL_MS, async () => {
    const res = await fetchWithRetries(stream.url, outlet.retries ?? 0, {
      accept: FEED_ACCEPT,
      userAgent: outlet.userAgent,
      headers: outlet.headers,
      timeoutMs: stream.timeoutMs ?? outlet.timeoutMs ?? 15_000,
    });
    let parsed;
    try {
      parsed = parseFeed(res.text);
    } catch (err) {
      throw new HttpError(502, `${err.message} (${stream.url})`);
    }
    return {
      ...parsed,
      fetchedAt: Date.now(),
      upstream: { url: stream.url, finalUrl: res.finalUrl, format: parsed.format, status: res.status, contentType: res.contentType, bytes: res.bytes, ms: res.ms },
    };
  });

  let items = feed.entries.map(entry => {
    let item = normalizeEntry(entry);
    item = outlet.normalize?.(item, entry, stream) ?? item;
    if (raw) item.raw = rawEntry(entry);
    return item;
  });
  if (stream.filter) items = items.filter(stream.filter);
  if (outlet.enrich) items = await outlet.enrich(items, stream);
  return { fetchedAt: feed.fetchedAt, upstream: { ...feed.upstream, title: feed.title, entries: feed.entries.length }, items };
}

// Some origins answer slowly on a cache miss; a second try usually hits the CDN.
async function fetchWithRetries(url, retries, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchResource(url, options);
    } catch (err) {
      if (attempt >= retries || err.status === 404) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Lookup and description

function getOutlet(id) {
  const outlet = byId.get(id);
  if (!outlet) throw new HttpError(404, `Unknown outlet: ${id}`);
  return outlet;
}

async function liveStreamsOf(outlet) {
  if (!outlet.liveStreams) return [];
  try {
    return await outlet.liveStreams();
  } catch (err) {
    console.warn(`${outlet.id}: live streams unavailable: ${err.message}`);
    return [];
  }
}

async function findStream(outlet, streamId) {
  const listed = outlet.streams.find(s => s.id === streamId)
    ?? (await liveStreamsOf(outlet)).find(s => s.id === streamId)
    ?? outlet.resolveStream?.(streamId);
  if (!listed) throw new HttpError(404, `Unknown stream ${outlet.id}/${streamId}`);
  return listed;
}

function describeOutlet(o) {
  return { id: o.id, name: o.name, owner: o.owner, language: o.language, homepage: o.homepage, description: o.description ?? null };
}

function describeStream(outlet, s) {
  return {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.kind ?? 'feed',
    language: s.language ?? outlet.language,
    description: s.description ?? null,
    topics: s.topics ?? [],
    url: s.url ?? null,
    derived: Boolean(s.filter),
    live: s.live ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}

function sortByGroup(streams) {
  const rank = g => (GROUPS.includes(g) ? GROUPS.indexOf(g) : GROUPS.length);
  return streams.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.group) - rank(b.s.group) || a.i - b.i).map(x => x.s);
}

// ---------------------------------------------------------------------------
// Items

// Liveblogs run for weeks; what makes one current is its latest post.
function activityAt(item) {
  return item.kind === 'liveblog' ? item.updatedAt ?? item.publishedAt : item.publishedAt;
}

function newestFirst(a, b) {
  return (activityAt(b) ?? -Infinity) - (activityAt(a) ?? -Infinity);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

function itemStats(items) {
  const share = pred => (items.length ? Math.round((items.filter(pred).length / items.length) * 100) / 100 : 0);
  const dates = items.map(activityAt).filter(Boolean);
  return {
    count: items.length,
    newestAt: dates.length ? Math.max(...dates) : null,
    oldestAt: dates.length ? Math.min(...dates) : null,
    coverage: {
      date: share(i => i.publishedAt),
      image: share(i => i.image),
      summary: share(i => i.summary),
      author: share(i => i.authors.length),
      categories: share(i => i.categories.length),
      body: share(i => i.paragraphs?.length),
    },
    premium: items.filter(i => i.premium).length,
  };
}

const DAY = 86_400_000;

// Two streams of one outlet with exactly the same items usually means a
// section URL that silently falls back to the main feed.
function warningsFor(r, ids, all) {
  if (!r.ok) return [];
  const w = [];
  const { stats } = r;
  if (!stats.count) w.push('empty');
  if (stats.count && stats.coverage.date < 1) w.push(`${Math.round((1 - stats.coverage.date) * 100)}% of items have no date`);
  if (stats.newestAt && Date.now() - stats.newestAt > r.staleAfterDays * DAY) w.push(`stale: newest item ${Math.round((Date.now() - stats.newestAt) / DAY)} days old`);
  const twin = all.find(o => o.streamId !== r.streamId && o.ok && o.outletId === r.outletId && o.stats.count >= 3 && o.ids === ids);
  if (twin) w.push(`same items as ${twin.streamId}`);
  return w;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}
