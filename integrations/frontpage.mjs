// The front page: VRT NWS's own front-page order, its running liveblogs and the
// newest stories per section, as one payload for the front-page wallpapers.
// Every story appears once in `top` + `sections` (deduplicated by URL);
// `live` and `latest` are views across the whole site and may repeat them.

import * as catalog from './catalog.mjs';

const OUTLET = 'vrt-nws';
const SECTIONS = ['binnenland', 'buitenland', 'politiek', 'economie', 'sport', 'cultuur', 'wetenschap'];

export async function getFrontpage({ perSection = 6, latest = 20 } = {}) {
  // Only the front page itself is required; a section that fails is left out.
  const [front, ...rest] = await Promise.allSettled(
    ['voorpagina', 'all', 'live', ...SECTIONS].map(id => catalog.loadStream(OUTLET, id)),
  );
  if (front.status === 'rejected') throw front.reason;
  const [all, live, ...sections] = rest.map(r => r.status === 'fulfilled' ? r.value : null);
  const seen = new Set();
  const fresh = items => items.filter(i => !seen.has(i.url) && seen.add(i.url));

  return {
    source: { id: OUTLET, name: front.value.outlet.name, language: 'nl', homepage: front.value.outlet.homepage },
    generatedAt: new Date().toISOString(),
    top: fresh(front.value.items).map(story),
    sections: sections.filter(Boolean).map(s => ({
      id: s.stream.id,
      name: s.stream.name,
      stories: fresh(s.items).slice(0, perSection).map(story),
    })),
    live: (live?.items ?? []).filter(i => i.live).map(story),
    latest: (all?.items ?? []).slice(0, latest).map(story),
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
