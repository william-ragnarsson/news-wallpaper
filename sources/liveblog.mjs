// VRT NWS liveblogs and the 'wallpaper' payload of the liveblog designs.
//
// Two upstream sources, both public:
//   - the Atom feed of the newsroom, which lists regular articles and liveblogs
//   - the JSON endpoint of VRT's web backend-for-frontend, which serves a liveblog's posts
//
// Everything leaving this module is normalized into the wallpaper data model
// documented in public/presets/README.md, so presets never see VRT's raw shapes.

import { decodeEntities, htmlToParagraphs, htmlToText, sanitizeHtml } from './lib/html.mjs';
import { cached, fetchText, HttpError } from './lib/http.mjs';
import * as reader from './lib/reader.mjs';

export { HttpError };

const FEED_URL = 'https://www.vrt.be/vrtnws/nl.rss.articles.xml';
const liveblogUrl = id =>
  `https://vrtnws-web-bff.vrt.be/vrtnws-bff/web/liveblog/liveblog-${id}/main/list?language=nl`;

const FEED_TTL_MS = 60_000;
const LIVEBLOG_TTL_MS = 20_000;
// Auto-follow ranks live liveblogs by how many posts they got in this window.
const ACTIVITY_WINDOW_MS = 3 * 60 * 60 * 1000;

export const source = {
  id: 'vrt-nws',
  name: 'VRT NWS',
  language: 'nl',
  homepage: 'https://www.vrt.be/vrtnws/nl/',
};

// ---------------------------------------------------------------------------
// Public API

export async function getFront() {
  return cached('front', FEED_TTL_MS, async () => {
    const xml = await fetchText(FEED_URL, { accept: 'application/atom+xml' });
    const entries = parseFeed(xml);
    return {
      source,
      fetchedAt: new Date().toISOString(),
      headlines: entries.filter(e => e.kind === 'article'),
      liveblogs: entries.filter(e => e.kind === 'liveblog'),
    };
  });
}

export async function getLiveblog(id, feedEntry) {
  if (!/^\d+$/.test(String(id))) throw new HttpError(400, `Invalid liveblog id: ${id}`);
  return cached(`liveblog:${id}`, LIVEBLOG_TTL_MS, async () => {
    const json = JSON.parse(await fetchText(liveblogUrl(id), { accept: 'application/json' }));
    return normalizeLiveblog(String(id), json, feedEntry);
  });
}

// One payload with everything a wallpaper needs: the liveblog in focus, the
// other liveblogs with their latest posts, and the regular headlines.
export async function getWallpaper({ follow = 'auto', maxPosts = 40, maxHeadlines = 16 } = {}) {
  const front = await reader.getFront();
  const entries = [...front.liveblogs];
  if (follow !== 'auto' && !entries.some(e => e.liveblogId === follow)) {
    entries.unshift({ liveblogId: follow });
  }

  const settled = await Promise.allSettled(entries.map(e => reader.getLiveblog(e.liveblogId, e)));
  const liveblogs = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!liveblogs.length) throw new HttpError(502, 'No liveblogs could be loaded from VRT NWS');

  // When the news was loaded: now, or when it was stored.
  const now = reader.now();
  // 'auto', or a followed liveblog that could not be loaded: the most active
  // one. `follow` in the payload still says what was asked for.
  const focus = liveblogs.find(b => b.id === follow)
    ?? pickMostActive(liveblogs.filter(b => b.status === 'live'), now) ?? liveblogs[0];

  return {
    source,
    generatedAt: new Date(now).toISOString(),
    follow,
    focus: { ...focus, posts: focus.posts.slice(0, maxPosts) },
    liveblogs: liveblogs.map(b => ({
      ...withoutPosts(b),
      isFocus: b.id === focus.id,
      postsInWindow: countSince(b, now - ACTIVITY_WINDOW_MS),
      recent: b.posts.slice(0, 3),
    })),
    headlines: front.headlines.slice(0, maxHeadlines),
  };
}

// ---------------------------------------------------------------------------
// Liveblog selection

function pickMostActive(blogs, now) {
  return [...blogs].sort((a, b) =>
    countSince(b, now - ACTIVITY_WINDOW_MS) - countSince(a, now - ACTIVITY_WINDOW_MS)
    || b.updatedAt - a.updatedAt,
  )[0];
}

function countSince(blog, since) {
  return blog.posts.filter(p => p.timestamp >= since).length;
}

function withoutPosts({ posts, ...rest }) {
  return rest;
}

// ---------------------------------------------------------------------------
// Atom feed

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, body]) => {
    const links = [...body.matchAll(/<link((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)].map(([, a]) => attributes(a));
    const self = links.find(l => l.rel === 'self')?.href ?? '';
    const liveblogId = self.match(/\/liveblog\/[^/]*~(\d+)\.rss\.xml$/)?.[1] ?? null;
    const image = links.find(l => l.rel === 'enclosure')?.href;
    return {
      id: childText(body, 'id').replace(/^https?:\/\/vrtnws\.be\//, ''),
      kind: liveblogId ? 'liveblog' : 'article',
      liveblogId,
      title: childText(body, 'title'),
      summary: childText(body, 'summary'),
      section: childText(body, 'vrtns:nstag') || null,
      url: self ? self.replace(/\.rss\.xml$/, '/') : links.find(l => l.rel === 'alternate')?.href,
      shortUrl: links.find(l => l.rel === 'alternate')?.href ?? null,
      image: image ? { url: image, alt: '', ratio: '1200/630' } : null,
      publishedAt: Date.parse(childText(body, 'published')) || null,
      updatedAt: Date.parse(childText(body, 'updated')) || null,
    };
  });
}

function childText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : '';
}

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeEntities(v)]),
  );
}

// ---------------------------------------------------------------------------
// Liveblog JSON

function normalizeLiveblog(id, json, feedEntry) {
  const comps = json.compositions ?? [];
  const heading = comps.find(c => c.type === 'liveBlogHeading') ?? {};
  const summary = comps.find(c => c.type === 'liveBlogSummary');
  const posts = comps
    .filter(c => c.type === 'liveBlogPost')
    .map(normalizePost)
    .filter(p => p.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp);

  return {
    id,
    url: feedEntry?.url ?? null,
    status: json.variant === 'live' ? 'live' : 'ended',
    label: heading.tag?.prefix ?? 'Liveblog',
    topic: heading.tag?.text ?? '',
    title: heading.title?.text ?? feedEntry?.title ?? '',
    intro: htmlToParagraphs(heading.subtitle?.html).join('\n\n'),
    section: feedEntry?.section ?? null,
    image: normalizeImage(heading.image),
    summary: summary
      ? {
          title: summary.title?.text?.replace(/:\s*$/, '') ?? 'Samenvatting',
          points: htmlToParagraphs(summary.html).map(s => s.replace(/^•\s*/, '')),
        }
      : null,
    startedAt: posts.at(-1)?.timestamp ?? null,
    updatedAt: posts[0]?.timestamp ?? feedEntry?.updatedAt ?? null,
    postCount: posts.length,
    posts,
  };
}

function normalizePost(post) {
  const time = post.metadata?.find(m => m.type === 'time');
  const timestamp = time?.timestamp ?? (Date.parse(post.seo?.publishedOn) || null);
  const blocks = (post.compositions ?? []).map(normalizeBlock).filter(Boolean);
  const title = blocks.find(b => b.type === 'title');
  const body = blocks.filter(b => b.type !== 'title');
  const paragraphs = body.filter(b => b.type === 'text').flatMap(b => b.paragraphs);
  const visual = body.find(b => b.image)?.image ?? null;

  return {
    id: post.id,
    timestamp,
    time: timestamp ? new Date(timestamp).toISOString() : null,
    title: title?.text ?? '',
    highlight: post.variant === 'highlight' || Boolean(title?.emphasised),
    author: post.author?.text ?? null,
    paragraphs,
    text: paragraphs.join('\n\n'),
    image: visual,
    hasVideo: body.some(b => b.type === 'video'),
    blocks: body,
  };
}

function normalizeBlock(c) {
  switch (c.type) {
    case 'liveBlogPostTitle':
      return { type: 'title', text: c.title?.text ?? '', emphasised: Boolean(c.isEmphasised) };
    case 'liveBlogPostText':
      return {
        type: 'text',
        paragraphs: htmlToParagraphs(c.text?.html),
        html: sanitizeHtml(c.text?.html ?? ''),
        emphasised: Boolean(c.isEmphasised),
      };
    case 'liveBlogPostImage':
      return { type: 'image', image: normalizeImage(c.image) };
    case 'liveBlogPostVideo': {
      const media = c.action?.analytics?.ebaContexts?.find(x => x.data?.mediatype)?.data;
      return {
        type: 'video',
        image: normalizeImage(c.action?.image ?? c.image),
        ratio: c.action?.aspectRatio ?? null,
        durationSec: media?.medialength ? Math.round(media.medialength / 1000) : null,
        name: media?.medianame ?? null,
      };
    }
    case 'liveBlogPostAudio':
      return {
        type: 'audio',
        title: c.title?.text || c.action?.subtitle?.text || '',
        show: c.metadata?.filter(m => m.prefix || !m.icon).map(m => [m.prefix, m.text].filter(Boolean).join(' · ')).join(' · ') || null,
        duration: c.metadata?.find(m => m.icon)?.text ?? null,
      };
    case 'liveBlogPostQuote':
      return { type: 'quote', text: c.title?.text ?? '', by: c.subtitle?.text ?? null };
    case 'liveBlogPostInternalTeaser':
      return {
        type: 'teaser',
        label: c.label?.text ?? null,
        title: c.title?.text ?? '',
        url: c.actions?.find(a => a.uri)?.uri ?? null,
        image: normalizeImage(c.image),
      };
    case 'liveBlogPostEmbed':
      return normalizeEmbed(c.html ?? '');
    default:
      return null;
  }
}

function normalizeEmbed(html) {
  if (html.includes('twitter-tweet')) {
    const quote = html.match(/<blockquote[\s\S]*?<\/blockquote>/)?.[0] ?? '';
    const text = htmlToParagraphs(quote.match(/<p[\s\S]*?<\/p>/)?.[0]).join(' ')
      .replace(/\s*(pic\.twitter\.com|https?:\/\/t\.co)\/\S+/g, '').trim();
    const attribution = htmlToText(quote.replace(/<p[\s\S]*?<\/p>/, '').replace(/<a[^>]*>[^<]*<\/a>\s*$/, ''))
      .replace(/^[\s—–-]+/, '').trim();
    const url = [...quote.matchAll(/href="([^"]+)"/g)].map(m => m[1]).at(-1) ?? null;
    return { type: 'embed', network: 'x', text, attribution: attribution || null, url: url && decodeEntities(url) };
  }
  const src = decodeEntities(html.match(/<iframe[^>]*\ssrc="([^"]+)"/)?.[1] ?? '');
  const title = decodeEntities(html.match(/<iframe[^>]*\stitle="([^"]+)"/)?.[1] ?? '');
  const network = src.includes('datawrapper') ? 'datawrapper'
    : src.includes('truthsocial') ? 'truthsocial'
    : src.includes('facebook') ? 'facebook'
    : src.includes('instagram') ? 'instagram'
    : src.includes('youtube') ? 'youtube'
    : 'other';
  const attribution = network === 'truthsocial' ? src.match(/truthsocial\.com\/(@[^/]+)/)?.[1] ?? null : null;
  return { type: 'embed', network, text: '', title: title.replace(/\s*\(Copy\)$/, '') || null, attribution, url: src || null };
}

function normalizeImage(img) {
  if (!img?.url) return null;
  return {
    url: img.url,
    alt: img.alt ?? '',
    caption: img.title?.text ?? null,
    credit: img.subtitle?.text?.replace(/^©\s*/, '') ?? null,
    ratio: img.aspectRatio ?? null,
    sensitive: Boolean(img.isSensitiveContent),
  };
}
