// VRT NWS (VRT, public broadcaster, Dutch). Three public sources:
//   - the newsroom's Atom feed: the ~50 newest articles and liveblogs, each with
//     a lead and a section tag (<vrtns:nstag>)
//   - the "headlines" Atom feed: what the front page shows, in front-page order
//   - VRT's web backend, which serves every page of the site as JSON. Its "Net
//     binnen" pages list the 100 newest items of one section, newest first, and
//     are the section streams here. Their teasers carry a title, image, time and
//     tag (section, town or programme) but no lead or author; leads come from
//     the Atom feed when the article is still in it.
// Liveblogs show up in all of them; their posts come from VRT's web backend
// (sources/liveblog.mjs), and each live one becomes its own stream.
// VRT has no paywall, so nothing is premium.
// Live: a liveblog is live while VRT's backend gives it status "live"
// (enrichLiveblogs); articles are never live.
// What is weak:
//   - Section lists have no leads: only items still in the Atom feed (the 50
//     newest) get one, so most section stories show a title and picture only.
//   - VRT leaves some liveblogs "live" for weeks after the story calmed down.

import { getFront, getLiveblog } from '../liveblog.mjs';
import { normalizeEntry, parseFeed } from '../lib/feed.mjs';
import { cached, fetchResource, HttpError } from '../lib/http.mjs';
import { childText } from '../lib/xml.mjs';

const FEED = 'https://www.vrt.be/vrtnws/nl.rss.articles.xml';
const HEADLINES = 'https://www.vrt.be/vrtnws/nl.rss.headlines.xml';
const SITE = 'https://www.vrt.be/vrtnws/nl/';
const BFF_PAGE = 'https://vrtnws-web-bff.vrt.be/vrtnws-bff/web/page/content/';
const LIST_TTL_MS = 60_000;
const LIVEBLOG_STREAM = /^liveblog-(\d+)$/;

export default {
  id: 'vrt-nws',
  name: 'VRT NWS',
  owner: 'VRT',
  language: 'nl',
  homepage: 'https://www.vrt.be/vrtnws/nl/',
  description: 'Public broadcaster newsroom: all news, the front page, a stream per section and province, and liveblogs for running stories.',
  ttlMs: 60_000,
  // The streams of its front page (sources/frontpage.mjs), and the sections
  // below it until picked otherwise.
  frontpage: {
    top: 'voorpagina',
    latest: 'all',
    live: 'live',
    sections: ['binnenland', 'buitenland', 'politiek', 'economie', 'sport', 'cultuur', 'wetenschap'],
  },

  streams: [
    { id: 'all', name: 'Alle nieuws', group: 'Top stories', url: FEED, topics: ['general'],
      description: 'The 50 newest articles and liveblogs, with leads.' },
    { id: 'voorpagina', name: 'Voorpagina', group: 'Top stories', url: HEADLINES, topics: ['general', 'front page'],
      keepOrder: true, description: 'What the front page shows now, in front-page order.' },
    { id: 'live', name: 'Liveblogs', group: 'Live', kind: 'index', topics: ['live'], keepOrder: true,
      description: 'Every liveblog in the feed, live ones first, with its latest post.',
      load: loadLiveIndex },

    section('binnenland', 'binnenland', 'Binnenland', 'News', ['belgium'], 'Belgian news.'),
    section('politiek', 'binnenland/politiek', 'Politiek', 'Politics', ['politics', 'belgian politics'], 'Belgian politics.'),
    section('buitenland', 'buitenland', 'Buitenland', 'World', ['international'], 'International news.'),
    section('economie', 'binnenland/economie', 'Economie', 'Economy', ['economy', 'business'], 'Economy, business and work.'),

    section('antwerpen', 'antwerpen', 'Antwerpen', 'Regional', ['regional', 'antwerp'], 'News from the province of Antwerp.'),
    section('brussel', 'brussel', 'Brussel', 'Regional', ['regional', 'brussels'], 'News from Brussels.'),
    section('limburg', 'limburg', 'Limburg', 'Regional', ['regional', 'limburg'], 'News from the province of Limburg.'),
    section('oost-vlaanderen', 'oost-vlaanderen', 'Oost-Vlaanderen', 'Regional', ['regional', 'east flanders'], 'News from East Flanders.'),
    section('vlaams-brabant', 'vlaams-brabant', 'Vlaams-Brabant', 'Regional', ['regional', 'flemish brabant'], 'News from Flemish Brabant.'),
    section('west-vlaanderen', 'west-vlaanderen', 'West-Vlaanderen', 'Regional', ['regional', 'west flanders'], 'News from West Flanders.'),

    section('sport', 'sport', 'Sport', 'Sport', ['sport'], 'Sport as covered by the newsroom (Sporza is VRT\'s sports brand).'),
    section('cultuur', 'cultuur-en-media', 'Cultuur & media', 'Culture', ['culture', 'media'], 'Culture and media.'),
    section('wetenschap', 'technologie-en-wetenschap', 'Technologie & wetenschap', 'Science & Tech', ['science', 'technology'], 'Science and technology.'),
    section('klimaat', 'milieu-en-klimaat', 'Milieu & klimaat', 'Science & Tech', ['climate', 'environment', 'weather'], 'Environment, climate and weather.'),
    section('analyse', 'analyse', 'Analyse', 'Opinion', ['analysis'], 'Analyses and explainers by VRT NWS journalists.'),
    section('samenleving', 'binnenland/samenleving', 'Samenleving', 'Lifestyle', ['society'], 'Society and daily life.'),
    section('gezondheid', 'gezondheid', 'Gezondheid', 'Lifestyle', ['health'], 'Health.'),
  ],

  normalize,
  enrich: enrichLiveblogs,

  // One stream per liveblog in the feed, so a running story can be followed directly.
  async liveStreams() {
    const front = await getFront();
    const blogs = await Promise.allSettled(front.liveblogs.map(e => getLiveblog(e.liveblogId, e)));
    return front.liveblogs.map((entry, i) => {
      const blog = blogs[i].status === 'fulfilled' ? blogs[i].value : null;
      return liveblogStream(entry.liveblogId, {
        name: blog?.title ?? entry.title,
        live: blog ? blog.status === 'live' : null,
        updatedAt: blog?.updatedAt ?? entry.updatedAt,
        entry,
      });
    }).sort((a, b) => (b.live === true) - (a.live === true) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  },

  // Liveblogs drop out of the feed when they end; their posts stay available.
  resolveStream(streamId) {
    const id = streamId.match(LIVEBLOG_STREAM)?.[1];
    return id ? liveblogStream(id, { name: `Liveblog ${id}` }) : null;
  },
};

// ---------------------------------------------------------------------------
// Atom feeds

function normalize(item, entry) {
  const self = entry.node.children.find(c => c.name === 'link' && c.attrs?.rel === 'self')?.attrs.href ?? '';
  const liveblogId = self.match(/\/liveblog\/[^/]*~(\d+)\.rss\.xml$/)?.[1] ?? null;
  const section = childText(entry.node, 'vrtns:nstag');
  const brand = childText(entry.node, 'vrtns:nslabeltag').match(/brands\/([\w-]+)$/)?.[1] ?? null;
  return {
    ...item,
    kind: liveblogId ? 'liveblog' : 'article',
    // The self link is the article page with .rss.xml appended; the alternate is a short link.
    url: self ? self.replace(/\.rss\.xml$/, '/') : item.url,
    categories: section ? [section] : [],
    brand,
    ...(liveblogId && { liveblogId, streamId: `liveblog-${liveblogId}` }),
  };
}

// Feed and list entries of a liveblog show its newest post; the liveblog itself
// has its own title, start time and latest post.
async function enrichLiveblogs(items) {
  return Promise.all(items.map(async item => {
    if (item.kind !== 'liveblog') return item;
    const feedEntry = { url: item.url, title: item.title, section: item.categories[0] ?? null, updatedAt: item.updatedAt };
    const blog = await getLiveblog(item.liveblogId, feedEntry).catch(() => null);
    if (!blog) return item;
    return {
      ...item,
      title: blog.title || item.title,
      summary: item.summary ?? latestPostSummary(blog),
      publishedAt: item.publishedAt ?? blog.startedAt,
      updatedAt: blog.updatedAt ?? item.updatedAt,
      live: blog.status === 'live',
      postCount: blog.postCount,
    };
  }));
}

// url -> lead, for the articles still in the Atom feed.
function feedLeads() {
  return cached('vrt-nws:leads', LIST_TTL_MS, async () => {
    const res = await fetchResource(FEED, { accept: 'application/atom+xml' });
    const leads = new Map();
    for (const entry of parseFeed(res.text).entries) {
      const item = normalize(normalizeEntry(entry), entry);
      if (item.summary) leads.set(item.url, item.summary);
    }
    return leads;
  });
}

// ---------------------------------------------------------------------------
// "Net binnen" section lists

function section(id, path, name, group, topics, description) {
  const url = bffPageUrl(`${SITE}net-binnen/${path}/`);
  return {
    id, name, group, topics, url,
    description: `${description} The 100 newest items of VRT's "Net binnen" page.`,
    load: ({ raw }) => loadList(url, { raw }),
  };
}

// The web backend takes the site URL of any page, base64url-encoded.
function bffPageUrl(pageUrl) {
  return `${BFF_PAGE}${base64url(pageUrl)}?language=nl`;
}

// btoa, not Buffer, so this runs in the wallpaper page too.
function base64url(text) {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function loadList(url, { raw }) {
  const page = await cached(`vrt-nws:list:${url}`, LIST_TTL_MS, async () => {
    const res = await fetchResource(url, { accept: 'application/json' });
    let json;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new HttpError(502, `Not JSON (${url})`);
    }
    return {
      json,
      fetchedAt: Date.now(),
      upstream: { url, finalUrl: res.finalUrl, format: 'vrt-bff-json', status: res.status, contentType: res.contentType, bytes: res.bytes, ms: res.ms },
    };
  });
  const teasers = teasersOf(page.json);
  const leads = await feedLeads().catch(() => new Map());
  const items = teasers.map(t => ({ ...teaserItem(t, leads), ...(raw && { raw: JSON.stringify(t, null, 2) }) }));
  return {
    fetchedAt: page.fetchedAt,
    upstream: { ...page.upstream, title: page.json.pageProperties?.title?.text ?? null, entries: teasers.length },
    items: await enrichLiveblogs(items),
  };
}

// A page is a tree of compositions; the items are its teaser leaves.
function teasersOf(node, out = []) {
  if (node?.type === 'articleTeaser' || node?.type === 'mediaTeaser') out.push(node);
  for (const child of node?.compositions ?? []) teasersOf(child, out);
  return out;
}

function teaserItem(t, leads) {
  const url = t.actions?.[0]?.uri ?? null;
  const liveblogId = url?.match(/\/liveblog\/[^/]*~(\d+)\/$/)?.[1] ?? null;
  const time = t.publication?.timestamp ?? null;
  return {
    id: url,
    kind: liveblogId ? 'liveblog' : t.type === 'mediaTeaser' ? 'video' : 'article',
    url,
    // Teaser titles keep the editors' stray double spaces.
    title: t.title?.text?.replace(/\s+/g, ' ').trim() ?? '',
    summary: leads.get(url) ?? null,
    // A liveblog teaser's time is its newest post's; enrichLiveblogs() adds the start.
    publishedAt: liveblogId ? null : time,
    updatedAt: liveblogId ? time : null,
    authors: [],
    categories: t.tag?.text ? [t.tag.text] : [],
    // Teasers link the original upload (up to 8000 px, several MB); the image host also serves fixed widths.
    image: t.image?.url ? { url: t.image.url.replace('images.vrt.be/orig/', 'images.vrt.be/width1280/'), alt: t.image.alt ?? '', credit: null, width: null, height: null, source: 'teaser' } : null,
    premium: false,
    paragraphs: null,
    ...(t.duration?.seconds && { durationSec: t.duration.seconds }),
    ...(liveblogId && { liveblogId, streamId: `liveblog-${liveblogId}` }),
  };
}

// ---------------------------------------------------------------------------
// Liveblogs

function liveblogStream(id, { name, live = null, updatedAt = null, entry } = {}) {
  return {
    id: `liveblog-${id}`,
    name,
    group: 'Live',
    kind: 'liveblog',
    topics: ['live'],
    live,
    updatedAt,
    description: 'Posts of one liveblog, newest first.',
    load: ({ raw }) => loadLiveblog(id, entry, { raw }),
  };
}

async function loadLiveblog(id, entry, { raw }) {
  const front = entry ? null : await getFront().catch(() => null);
  const feedEntry = entry ?? front?.liveblogs.find(e => e.liveblogId === id);
  const blog = await getLiveblog(id, feedEntry);
  return {
    fetchedAt: Date.now(),
    upstream: { url: liveblogEndpoint(id), format: 'vrt-liveblog-json', status: 200 },
    header: {
      kind: 'liveblog',
      id: blog.id,
      url: blog.url,
      status: blog.status,
      label: blog.label,
      topic: blog.topic,
      title: blog.title,
      intro: blog.intro || null,
      section: blog.section,
      image: itemImage(blog.image, 'liveblog'),
      summary: blog.summary,
      startedAt: blog.startedAt,
      updatedAt: blog.updatedAt,
      postCount: blog.postCount,
    },
    items: blog.posts.map(p => ({
      id: `${blog.id}/${p.id}`,
      kind: 'post',
      url: blog.url,
      title: p.title,
      summary: null,
      publishedAt: p.timestamp,
      updatedAt: null,
      authors: p.author ? [p.author] : [],
      categories: [],
      image: itemImage(p.image, 'liveblog'),
      premium: false,
      paragraphs: p.paragraphs.length ? p.paragraphs : null,
      highlight: p.highlight,
      blocks: p.blocks,
      ...(raw && { raw: JSON.stringify(p, null, 2) }),
    })),
  };
}

async function loadLiveIndex() {
  const front = await getFront();
  const settled = await Promise.allSettled(front.liveblogs.map(e => getLiveblog(e.liveblogId, e)));
  const items = front.liveblogs.map((entry, i) => {
    const blog = settled[i].status === 'fulfilled' ? settled[i].value : null;
    const latest = blog?.posts[0];
    return {
      id: `liveblog-${entry.liveblogId}`,
      kind: 'liveblog',
      url: entry.url,
      title: blog?.title || entry.title,
      summary: (blog && latestPostSummary(blog)) ?? (entry.summary || null),
      publishedAt: entry.publishedAt,
      updatedAt: blog?.updatedAt ?? entry.updatedAt,
      authors: latest?.author ? [latest.author] : [],
      categories: [entry.section].filter(Boolean),
      image: itemImage(blog?.image, 'liveblog') ?? (entry.image ? { url: entry.image.url, alt: '', credit: null, width: null, height: null, source: 'enclosure' } : null),
      premium: false,
      paragraphs: blog?.summary?.points.length ? blog.summary.points : null,
      live: blog ? blog.status === 'live' : null,
      postCount: blog?.postCount ?? null,
      streamId: `liveblog-${entry.liveblogId}`,
    };
  }).sort((a, b) => (b.live === true) - (a.live === true) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return {
    fetchedAt: Date.now(),
    upstream: { url: FEED, format: 'atom + vrt-liveblog-json', status: 200 },
    items,
  };
}

// 'Title of the latest post: its first paragraph'
function latestPostSummary(blog) {
  const latest = blog.posts[0];
  return latest ? [latest.title?.trim(), latest.paragraphs[0]?.trim()].filter(Boolean).join(': ') || null : null;
}

function itemImage(img, source) {
  if (!img?.url) return null;
  return { url: img.url, alt: img.alt ?? '', credit: img.credit ?? null, width: null, height: null, source };
}

const liveblogEndpoint = id =>
  `https://vrtnws-web-bff.vrt.be/vrtnws-bff/web/liveblog/liveblog-${id}/main/list?language=nl`;
