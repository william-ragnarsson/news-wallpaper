// The front page: a provider's own front-page order, the newest stories per
// section and the running liveblogs, as one payload for the front-page wallpapers.
// The settings (settings.mjs, or the app's settings file) pick the provider,
// the sections and whether running live stories lead the page (`liveFirst`).
// Every story appears once in `top` + `sections` (deduplicated by URL, a
// liveblog by its stream id: its URL follows its headline); `live` and
// `latest` are views across the whole site and may repeat them.
// Every story says whether it is `live`: a running live blog or live page, as
// each outlet module marks it (`item.live`).

import * as reader from './lib/reader.mjs';
import { OUTLETS } from './outlets/index.mjs';

// The news providers a front page can come from: every outlet with a
// `frontpage` (sources/README.md), each with its sections, for Customize.
// `liveblogs`: whether it has liveblogs with posts to follow, for the liveblog
// designs (VRT NWS only).
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
  provider, sections, liveFirst = true, perSection = 6, latest = 20,
} = {}) {
  const p = getProvider(provider);
  const { top, latest: all, live: index } = frontOf(p.id);
  // Sections of another provider (settings from before a switch) are left out.
  sections = (sections ?? p.defaultSections).filter(id => p.sections.some(s => s.id === id));
  // Only the front page itself is required; a section that fails is left out.
  const load = id => id ? reader.loadStream(p.id, id) : Promise.resolve(null);
  const [front, ...rest] = await Promise.allSettled([top, all, index, ...sections].map(load));
  if (front.status === 'rejected') throw front.reason;
  const loaded = rest.map(r => r.status === 'fulfilled' ? r.value : null);
  const [newest, live] = loaded;
  const sectionPayloads = loaded.slice(2);
  const key = i => i.streamId ?? i.url;
  const seen = new Set();
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
  // Running live stories lead, newest first: those on the front page, and those
  // the outlet's front-page feed leaves out (NYT's live blogs) from its newest.
  const leads = liveFirst
    ? fresh(newestOf([front.value, newest].map(s => s && { items: s.items.filter(i => i.live) })))
    : [];

  return {
    source: { id: p.id, name: p.name, language: p.language, homepage: p.homepage },
    generatedAt: new Date(reader.now()).toISOString(),
    top: [...leads, ...fresh(front.value.items)].map(story),
    sections: sectionPayloads.filter(Boolean).map(s => ({
      id: s.stream.id,
      name: s.stream.name,
      stories: take(s.items, perSection).map(story),
    })),
    // The running liveblogs, for the designs that list them (VRT NWS only).
    live: (live?.items ?? []).filter(i => i.live).map(story),
    // Without a stream of its own: the newest of everything loaded.
    latest: (newest?.items ?? newestOf([front.value, ...sectionPayloads])).slice(0, latest).map(story),
  };
}

function newestOf(payloads) {
  const byUrl = new Map(payloads.filter(Boolean).flatMap(p => p.items).map(i => [i.url, i]));
  return [...byUrl.values()].sort((a, b) => activityAt(b) - activityAt(a));
}

// A liveblog's time is its newest post's.
function activityAt(i) {
  return (i.kind === 'liveblog' ? i.updatedAt ?? i.publishedAt : i.publishedAt) ?? 0;
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
    live: item.live === true,
    ...(isLiveblog && { postCount: item.postCount ?? null, startedAt: item.publishedAt }),
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
