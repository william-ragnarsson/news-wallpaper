// The Washington Post (WP Company, US, English). Its RSS feeds come from its
// publishing system (washingtonpost.com/arcio/rss): one site-wide and one per
// section, newest first. Items carry a title, lead, author and time, but no
// picture, and there is no feed in home-page order. The site-wide feed is
// mostly agency copy (AP, Reuters) the Post republishes, so the front page
// leads with the Post's own stories from it. The section comes from the URL.
// feeds.washingtonpost.com, the older address, no longer answers.
// Terms: personal, non-commercial use, as for the site (washingtonpost.com/terms-of-service).
// Live: the Post's live pages have "live-updates" (or live-results, live-coverage)
// in the URL, and some titles start "Live updates:". None was in the feeds when
// this was written (October 2026), so the rule is untested against a real item.
// What is weak:
//   - No pictures in any feed, and none can be derived from the items.
//   - No feed in home-page order: the front page is the Post's own newest
//     stories, so a soft feature can lead over the big story of the day.

const RSS = 'https://www.washingtonpost.com/arcio/rss/';

const SECTIONS = {
  politics: 'Politics', world: 'World', national: 'National', nation: 'National', business: 'Business',
  technology: 'Technology', health: 'Health', wellness: 'Wellness', sports: 'Sports', opinions: 'Opinions',
  style: 'Style', 'dc-md-va': 'Local', local: 'Local', 'climate-environment': 'Climate', investigations: 'Investigations',
  'national-security': 'National Security', food: 'Food', advice: 'Advice', weather: 'Weather', obituaries: 'Obituaries',
  education: 'Education', immigration: 'Immigration', elections: 'Elections', 'home-garden': 'Home', home: 'Home',
  travel: 'Travel', science: 'Science', 'business/technology': 'Technology', 'arts-entertainment': 'Arts',
  entertainment: 'Arts', books: 'Books', 'style/media': 'Media',
};

// Not stories: newsletters (Tracking Trump, the WP Intelligence briefs) and recipes.
const NOT_STORY = /^https:\/\/www\.washingtonpost\.com\/(?:the-seven-trump|wp-intelligence|newsletters|recipes|podcasts)\//;
const LIVE = /[/-]live-(?:updates|results|coverage)\b/;
const LIVE_TITLE = /^live(?: updates)?:/i;

const AGENCY = /\|\s*(AP|Reuters|Bloomberg|AFP)$|^(The )?Associated Press$|^Reuters$|^Bloomberg$/;

export default {
  id: 'washington-post',
  name: 'The Washington Post',
  owner: 'WP Company',
  language: 'en',
  homepage: 'https://www.washingtonpost.com/',
  description: 'US national newspaper: its own newest stories and a stream per section. The feeds carry no pictures.',
  ttlMs: 120_000,
  frontpage: {
    top: 'top',
    latest: 'all',
    live: null,
    sections: ['politics', 'national', 'world', 'business', 'technology', 'opinions', 'sports'],
  },

  streams: [
    { id: 'top', name: 'From the Post', group: 'Top stories', url: RSS, topics: ['general'],
      filter: item => !item.authors.some(a => AGENCY.test(a)),
      description: 'The newest stories by the Post\'s own reporters, without agency copy.' },
    { id: 'all', name: 'All stories', group: 'Top stories', url: RSS, topics: ['general'],
      description: 'Everything the site publishes, newest first, agency copy included.' },

    section('politics', 'Politics', 'Politics', ['politics', 'us politics'], 'US politics.'),
    section('national', 'National', 'News', ['united states'], 'National news.'),
    section('world', 'World', 'World', ['international'], 'International news.'),
    section('business', 'Business', 'Economy', ['business', 'economy'], 'Business and the economy.'),
    section('local', 'Local', 'Regional', ['regional', 'washington dc'], 'Washington, Maryland and Virginia.'),
    section('technology', 'Technology', 'Science & Tech', ['technology'], 'Technology.'),
    section('health', 'Health', 'Lifestyle', ['health'], 'Health.'),
    section('sports', 'Sports', 'Sport', ['sport'], 'Sports.'),
    section('style', 'Style', 'Culture', ['culture'], 'Culture, arts and style.'),
    section('lifestyle', 'Lifestyle', 'Lifestyle', ['lifestyle'], 'Lifestyle, food and advice.'),
    section('opinions', 'Opinions', 'Opinion', ['opinion'], 'Columns, editorials and letters.'),
  ],

  normalize,
  enrich: items => items.filter(i => !NOT_STORY.test(i.url)),
};

function section(id, name, group, topics, description) {
  return { id, name, group, topics, url: `${RSS}category/${id}/`, description: `${description} The section's RSS feed.` };
}

function normalize(item) {
  const path = item.url.match(/^https:\/\/www\.washingtonpost\.com\/([\w-]+)\/([\w-]+)\//);
  const section = path && (SECTIONS[`${path[1]}/${path[2]}`] ?? SECTIONS[path[1]]);
  return {
    ...item,
    live: LIVE.test(item.url) || LIVE_TITLE.test(item.title),
    categories: [section].filter(Boolean),
  };
}
