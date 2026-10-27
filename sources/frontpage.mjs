// The front page: VRT NWS's own front-page order, its running liveblogs and the
// newest stories per section, as one payload for the front-page wallpapers.
// The settings (settings.mjs, or the app's settings file) pick the liveblogs that lead it and the sections.
// Every story appears once in `top` + `sections` (deduplicated by URL, a
// liveblog by its stream id: its URL follows its headline); `live` and
// `latest` are views across the whole site and may repeat them.

import * as catalog from './catalog.mjs';
import vrtNws from './outlets/vrt-nws.mjs';

const OUTLET = 'vrt-nws';
// Every section stream the front page can show, in catalog order.
export const SECTIONS = vrtNws.streams
  .filter(s => !['Top stories', 'Live'].includes(s.group))
  .map(s => ({ id: s.id, name: s.name, group: s.group }));
export const DEFAULT_SECTIONS = ['binnenland', 'buitenland', 'politiek', 'economie', 'sport', 'cultuur', 'wetenschap'];

export async function getFrontpage({
  sections = DEFAULT_SECTIONS, liveblogs = [], otherLiveblogs = true, perSection = 6, latest = 20,
} = {}) {
  // Only the front page itself is required; a section or liveblog that fails is left out.
  const [front, ...rest] = await Promise.allSettled([
    ...['voorpagina', 'all', 'live', ...sections].map(id => catalog.loadStream(OUTLET, id)),
    ...liveblogs.map(id => catalog.loadStream(OUTLET, `liveblog-${id}`)),
  ]);
  if (front.status === 'rejected') throw front.reason;
  const loaded = rest.map(r => r.status === 'fulfilled' ? r.value : null);
  const [all, live] = loaded;
  const sectionPayloads = loaded.slice(2, 2 + sections.length);
  const picks = loaded.slice(2 + sections.length).filter(Boolean);
  // A picked liveblog's URL and section come from a list loaded in this same
  // call (its own stream's header holds whatever the first caller passed in).
  const listed = [live, all, front.value, ...sectionPayloads].filter(Boolean).flatMap(p => p.items);
  const featured = picks.map(p => liveblogStory(p, listed.find(i => i.streamId === p.stream.id)));
  const key = i => i.streamId ?? i.url;
  const seen = new Set(picks.map(p => p.stream.id));
  const fresh = items => items.filter(i => !seen.has(key(i)) && seen.add(key(i)));
  // The first n not seen yet; only those count as seen, not the rest of the list.
  const take = (items, n) => {
    const out = [];
    for (const i of items) {
      if (out.length >= n) break;
      if (!seen.has(key(i))) { seen.add(key(i)); out.push(i); }
    }
    return out;
  };

  return {
    source: { id: OUTLET, name: front.value.outlet.name, language: 'nl', homepage: front.value.outlet.homepage },
    generatedAt: new Date().toISOString(),
    top: [...featured, ...fresh(front.value.items).map(story)],
    sections: sectionPayloads.filter(Boolean).map(s => ({
      id: s.stream.id,
      name: s.stream.name,
      stories: take(s.items, perSection).map(story),
    })),
    // Off: no list of running liveblogs; the picked ones lead `top` anyway.
    live: otherLiveblogs ? (live?.items ?? []).filter(i => i.live).map(story) : [],
    latest: (all?.items ?? []).slice(0, latest).map(story),
  };
}

// The liveblogs a reader can put on the front page: every one in VRT's feed,
// live ones first, plus the `include` ids (picked earlier) that left it.
// If the feed fails, the picked ones are still listed.
export async function liveblogOptions(include = []) {
  const index = await catalog.loadStream(OUTLET, 'live').catch(() => null);
  const listed = (index?.items ?? []).map(i => ({
    id: i.streamId.replace(/^liveblog-/, ''),
    title: i.title,
    section: i.categories[0] ?? null,
    live: i.live,
    updatedAt: i.updatedAt,
    postCount: i.postCount,
    url: i.url,
  }));
  const missing = include.filter(id => !listed.some(b => b.id === id));
  const extra = await Promise.allSettled(missing.map(id => catalog.loadStream(OUTLET, `liveblog-${id}`)));
  return [
    ...listed,
    ...extra.map((r, i) => {
      const b = r.status === 'fulfilled' ? r.value.header : null;
      return b
        ? { id: b.id, title: b.title, section: b.section, live: b.status === 'live', updatedAt: b.updatedAt, postCount: b.postCount, url: b.url }
        : { id: missing[i], title: `Liveblog ${missing[i]}`, section: null, live: null, updatedAt: null, postCount: null, url: null, error: r.reason?.message ?? null };
    }),
  ];
}

// A picked liveblog as a front-page story, from its own stream: the liveblog's
// title and its latest post, like the liveblogs in VRT's feed. `item` is the
// same liveblog in a list from this call, for its URL and section.
function liveblogStory(p, item) {
  const b = p.header;
  const latest = p.items[0];
  return {
    ...story({
      kind: 'liveblog',
      url: item?.url ?? `liveblog-${b.id}`,
      title: b.title,
      summary: latest ? [latest.title?.trim(), latest.paragraphs?.[0]?.trim()].filter(Boolean).join(': ') : null,
      categories: [item?.categories[0]].filter(Boolean),
      image: b.image,
      publishedAt: b.startedAt,
      updatedAt: b.updatedAt,
      live: b.status === 'live',
      postCount: b.postCount,
    }),
    featured: true,
  };
}

function story(item) {
  const isLiveblog = item.kind === 'liveblog';
  return {
    id: item.url,
    kind: item.kind,
    url: item.url,
    title: clean(item.title),
    summary: withoutTitle(clean(item.summary), clean(item.title)),
    section: clean(item.categories[0]),
    image: item.image ? { url: item.image.url, alt: clean(item.image.alt) ?? '', credit: clean(item.image.credit) } : null,
    time: isLiveblog ? item.updatedAt ?? item.publishedAt : item.publishedAt,
    ...(isLiveblog && { live: item.live ?? null, postCount: item.postCount ?? null, startedAt: item.publishedAt }),
    ...(item.kind === 'video' && { durationSec: item.durationSec ?? null }),
  };
}

function clean(text) {
  return text?.replace(/\s+/g, ' ').trim() || null;
}

// A liveblog's summary is its latest post, which often repeats the liveblog's
// own headline before the text: "Title: text".
function withoutTitle(summary, title) {
  if (!summary || !title || !summary.startsWith(title)) return summary;
  return summary.slice(title.length).replace(/^[\s:.,–—-]+/, '') || null;
}
