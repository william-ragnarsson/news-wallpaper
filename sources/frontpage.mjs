// The front page: a provider's own front-page order, its running liveblogs and
// the newest stories per section, as one payload for the front-page wallpapers.
// The settings (settings.mjs, or the app's settings file) pick the provider,
// the liveblogs that lead it and the sections.
// Every story appears once in `top` + `sections` (deduplicated by URL, a
// liveblog by its stream id: its URL follows its headline); `live` and
// `latest` are views across the whole site and may repeat them.

import * as reader from './lib/reader.mjs';
import { OUTLETS } from './outlets/index.mjs';

// The news providers a front page can come from: every outlet with a
// `frontpage` (sources/README.md), each with its sections, for Customize.
// `liveblogs`: whether it has liveblogs to follow (VRT NWS only).
export const PROVIDERS = OUTLETS.filter(o => o.frontpage).map(o => ({
  id: o.id,
  name: o.name,
  owner: o.owner,
  language: o.language,
  homepage: o.homepage,
  description: o.description,
  sections: sectionsOf(o),
  defaultSections: o.frontpage.sections,
  liveblogs: Boolean(o.frontpage.live),
}));

// The provider with this id, or the first one.
export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];
}

// Which streams make an outlet's front page: {top, latest, live, sections}.
export function frontOf(id) {
  return OUTLETS.find(o => o.id === id).frontpage;
}

// Every stream but the front page's own, in catalog order.
function sectionsOf(outlet) {
  const { top, latest, live } = outlet.frontpage;
  return outlet.streams
    .filter(s => ![top, latest, live].includes(s.id) && !['Top stories', 'Live'].includes(s.group))
    .map(s => ({ id: s.id, name: s.name, group: s.group }));
}

export async function getFrontpage({
  provider, sections, liveblogs = [], otherLiveblogs = true, perSection = 6, latest = 20,
} = {}) {
  const p = getProvider(provider);
  const { top, latest: all, live: index } = frontOf(p.id);
  // Sections of another provider (settings from before a switch) are left out.
  sections = (sections ?? p.defaultSections).filter(id => p.sections.some(s => s.id === id));
  if (!p.liveblogs) liveblogs = [];
  // Only the front page itself is required; a section or liveblog that fails is left out.
  const load = id => id ? reader.loadStream(p.id, id) : Promise.resolve(null);
  const [front, ...rest] = await Promise.allSettled([
    ...[top, all, index, ...sections].map(load),
    ...liveblogs.map(id => load(`liveblog-${id}`)),
  ]);
  if (front.status === 'rejected') throw front.reason;
  const loaded = rest.map(r => r.status === 'fulfilled' ? r.value : null);
  const [newest, live] = loaded;
  const sectionPayloads = loaded.slice(2, 2 + sections.length);
  const picks = loaded.slice(2 + sections.length).filter(Boolean);
  // A picked liveblog's URL and section come from a list loaded in this same
  // call (its own stream's header holds whatever the first caller passed in).
  const listed = [live, newest, front.value, ...sectionPayloads].filter(Boolean).flatMap(p => p.items);
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
    source: { id: p.id, name: p.name, language: p.language, homepage: p.homepage },
    generatedAt: new Date(reader.now()).toISOString(),
    top: [...featured, ...fresh(front.value.items).map(story)],
    sections: sectionPayloads.filter(Boolean).map(s => ({
      id: s.stream.id,
      name: s.stream.name,
      stories: take(s.items, perSection).map(story),
    })),
    // Off: no list of running liveblogs; the picked ones lead `top` anyway.
    live: otherLiveblogs ? (live?.items ?? []).filter(i => i.live).map(story) : [],
    // Without a stream of its own: the newest of everything loaded.
    latest: (newest?.items ?? newestOf([front.value, ...sectionPayloads])).slice(0, latest).map(story),
  };
}

// The liveblogs Customize can put on the front page: every one in VRT's feed,
// live ones first, plus the `include` ids (picked earlier) that left it.
// If the feed fails, the picked ones are still listed. None for a provider
// without liveblogs.
export async function liveblogOptions(include = [], provider) {
  const p = getProvider(provider);
  if (!p.liveblogs) return [];
  const index = await reader.loadStream(p.id, frontOf(p.id).live).catch(() => null);
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
  const extra = await Promise.allSettled(missing.map(id => reader.loadStream(p.id, `liveblog-${id}`)));
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

function newestOf(payloads) {
  const byUrl = new Map(payloads.filter(Boolean).flatMap(p => p.items).map(i => [i.url, i]));
  return [...byUrl.values()].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
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
