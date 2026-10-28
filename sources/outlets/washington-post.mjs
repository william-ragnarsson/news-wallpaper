// The Washington Post (WP Company, US, English). Its RSS feeds come from its
// publishing system (washingtonpost.com/arcio/rss): one site-wide and one per
// section, newest first. Items carry a title, lead, author and time, but no
// picture, and there is no feed in home-page order. The site-wide feed is
// mostly agency copy (AP, Reuters) the Post republishes, so the front page
// leads with the Post's own stories from it. The section comes from the URL.
// feeds.washingtonpost.com, the older address, no longer answers.
// Terms: personal, non-commercial use, as for the site (washingtonpost.com/terms-of-service).

const RSS = 'https://www.washingtonpost.com/arcio/rss/';

const SECTIONS = {
  politics: 'Politics', world: 'World', national: 'National', nation: 'National', business: 'Business',
  technology: 'Technology', health: 'Health', wellness: 'Wellness', sports: 'Sports', opinions: 'Opinions',
  style: 'Style', 'dc-md-va': 'Local', local: 'Local', 'climate-environment': 'Climate', investigations: 'Investigations',
  'national-security': 'National Security', food: 'Food', advice: 'Advice', weather: 'Weather', obituaries: 'Obituaries',
  education: 'Education', immigration: 'Immigration', elections: 'Elections', 'home-garden': 'Home', travel: 'Travel',
};

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
};

function section(id, name, group, topics, description) {
  return { id, name, group, topics, url: `${RSS}category/${id}/`, description: `${description} The section's RSS feed.` };
}

function normalize(item) {
  const first = item.url.match(/^https:\/\/www\.washingtonpost\.com\/([\w-]+)\//)?.[1];
  return { ...item, categories: [SECTIONS[first]].filter(Boolean) };
}
