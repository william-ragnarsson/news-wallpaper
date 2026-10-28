// Fox News (Fox Corporation, US, English). Its public RSS feeds
// (moxie.foxnews.com/google-publisher): the newest stories site-wide and one
// per section, 25 items each, newest first. There is no feed in home-page
// order; the site-wide one is mostly sport (OutKick) and celebrity news, so the
// front page leads with the newest of U.S., Politics and World. Items carry a lead,
// a picture and the story's section path (a <category> with domain
// foxnews.com/section-path); the full text they also carry is not kept.
// The feeds are for personal, non-commercial use (foxnews.com/terms-of-use).
// Live: Fox's live pages are at /live-news/, and their titles often start
// "LIVE UPDATES:". None was in the feeds when this was written (October 2026),
// so the rule is untested against a real item.
// What is weak:
//   - No home-page order: the front page is the newest hard news, not what
//     Fox's editors put on top.
//   - Pictures are 931px wide, the largest the feeds give.

import { childrenNamed, textOf } from '../lib/xml.mjs';

const RSS = 'https://moxie.foxnews.com/google-publisher/';

// Section path → label: fox-news/<section> or fs/<sport> (Fox Sports).
const SECTIONS = {
  us: 'U.S.', world: 'World', politics: 'Politics', opinion: 'Opinion', 'outkick-sports': 'Sports',
  tech: 'Tech', health: 'Health', entertainment: 'Entertainment', media: 'Media', travel: 'Travel',
  lifestyle: 'Lifestyle', 'food-drink': 'Food', science: 'Science', 'outkick-culture': 'Culture',
};

// Not stories: the "how to watch" TV and streaming guides sports runs for each game.
const NOT_STORY = /^https:\/\/www\.foxnews\.com\/[\w-]+\/how-to-watch-/;
const LIVE = /^https:\/\/www\.foxnews\.com\/live-news\//;
const LIVE_TITLE = /^live(?: updates)?:/i;

export default {
  id: 'fox-news',
  name: 'Fox News',
  owner: 'Fox Corporation',
  language: 'en',
  homepage: 'https://www.foxnews.com/',
  description: 'US cable news network: the newest stories and a stream per section.',
  ttlMs: 120_000,
  frontpage: {
    top: 'top',
    latest: 'latest',
    live: null,
    sections: ['us', 'politics', 'world', 'opinion', 'sports', 'tech', 'health'],
  },

  streams: [
    { id: 'top', name: 'Top news', group: 'Top stories', topics: ['general', 'front page'],
      description: 'The 30 newest stories from U.S., Politics and World together.',
      load: loadTopNews },
    { id: 'latest', name: 'Latest', group: 'Top stories', url: `${RSS}latest.xml`, topics: ['general'],
      description: 'The 25 newest stories across the site.' },

    section('us', 'U.S.', 'News', ['united states'], 'National news.'),
    section('politics', 'Politics', 'Politics', ['politics', 'us politics'], 'US politics.'),
    section('world', 'World', 'World', ['international'], 'International news.'),
    section('opinion', 'Opinion', 'Opinion', ['opinion'], 'Opinion columns.'),
    section('sports', 'Sports', 'Sport', ['sport'], 'Sports, from Fox Sports and OutKick.'),
    section('tech', 'Tech', 'Science & Tech', ['technology'], 'Technology.'),
    section('health', 'Health', 'Lifestyle', ['health'], 'Health.'),
    section('entertainment', 'Entertainment', 'Culture', ['culture', 'entertainment'], 'Entertainment.'),
    section('media', 'Media', 'Culture', ['media'], 'News about the media.'),
    section('lifestyle', 'Lifestyle', 'Lifestyle', ['lifestyle'], 'Lifestyle.'),
    section('travel', 'Travel', 'Lifestyle', ['travel'], 'Travel.'),
  ],

  normalize,
  enrich: items => items.filter(i => !NOT_STORY.test(i.url)),
};

function section(id, name, group, topics, description) {
  return { id, name, group, topics, url: `${RSS}${id}.xml`, description: `${description} The section's RSS feed, 25 newest.` };
}

function normalize(item, entry) {
  const path = childrenNamed(entry.node, 'category')
    .find(c => c.attrs.domain === 'foxnews.com/section-path');
  return {
    ...item,
    live: LIVE.test(item.url) || LIVE_TITLE.test(item.title),
    categories: [sectionOf(path ? textOf(path).trim() : '')].filter(Boolean),
    paragraphs: null,
  };
}

function sectionOf(path) {
  const [site, name] = path.split('/');
  if (site === 'fs') return 'Sports';
  return SECTIONS[name] ?? null;
}

// The newest TOP_COUNT only, so the U.S., Politics and World sections below
// the front page keep stories of their own.
const TOP_COUNT = 30;
const TOP_STREAMS = ['us', 'politics', 'world'];

// A feed that fails is left out; only all three failing fails the front page.
async function loadTopNews({ loadStream }) {
  const settled = await Promise.allSettled(TOP_STREAMS.map(id => loadStream(id)));
  const loaded = TOP_STREAMS.filter((_, i) => settled[i].status === 'fulfilled');
  if (!loaded.length) throw settled[0].reason;
  const parts = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
  const items = [...new Map(parts.flatMap(p => p.items).map(i => [i.id, i])).values()]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  return {
    fetchedAt: Math.min(...parts.map(p => p.fetchedAt)),
    upstream: { format: 'merged', status: 200, streams: loaded, entries: parts.reduce((n, p) => n + p.items.length, 0) },
    items: items.slice(0, TOP_COUNT),
  };
}
