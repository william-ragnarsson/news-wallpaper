// Fox News (Fox Corporation, US, English). Its public RSS feeds
// (moxie.foxnews.com/google-publisher): the newest stories site-wide and one
// per section, 25 items each, newest first. There is no feed in home-page
// order, so the front page leads with the newest stories. Items carry a lead,
// a picture and the story's section path (a <category> with domain
// foxnews.com/section-path); the full text they also carry is not kept.
// The feeds are for personal, non-commercial use (foxnews.com/terms-of-use).

import { childrenNamed, textOf } from '../lib/xml.mjs';

const RSS = 'https://moxie.foxnews.com/google-publisher/';

// Section path → label: fox-news/<section> or fs/<sport> (Fox Sports).
const SECTIONS = {
  us: 'U.S.', world: 'World', politics: 'Politics', opinion: 'Opinion', 'outkick-sports': 'Sports',
  tech: 'Tech', health: 'Health', entertainment: 'Entertainment', media: 'Media', travel: 'Travel',
  lifestyle: 'Lifestyle', 'food-drink': 'Food', science: 'Science', 'outkick-culture': 'Culture',
};

export default {
  id: 'fox-news',
  name: 'Fox News',
  owner: 'Fox Corporation',
  language: 'en',
  homepage: 'https://www.foxnews.com/',
  description: 'US cable news network: the newest stories and a stream per section.',
  ttlMs: 120_000,
  frontpage: {
    top: 'latest',
    latest: null,
    live: null,
    sections: ['us', 'politics', 'world', 'opinion', 'sports', 'tech', 'health'],
  },

  streams: [
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
};

function section(id, name, group, topics, description) {
  return { id, name, group, topics, url: `${RSS}${id}.xml`, description: `${description} The section's RSS feed, 25 newest.` };
}

function normalize(item, entry) {
  const path = childrenNamed(entry.node, 'category')
    .find(c => c.attrs.domain === 'foxnews.com/section-path');
  return {
    ...item,
    categories: [sectionOf(path ? textOf(path).trim() : '')].filter(Boolean),
    paragraphs: null,
  };
}

function sectionOf(path) {
  const [site, name] = path.split('/');
  if (site === 'fs') return 'Sports';
  return SECTIONS[name] ?? null;
}
