// The New York Times (The New York Times Company, US, English). Its public RSS
// feeds (rss.nytimes.com): the home page in home-page order, the newest
// stories site-wide, and one per section. Items carry a lead, authors, subject
// tags and a picture; the section comes from the article's URL.
// The feeds are for personal, non-commercial use (nytimes.com/rss). Stories
// past the paywall are not marked as such in the feeds, so nothing is premium.
// Live: a live blog's URL starts /live/; the blog is live while it is in the feeds.
// What is weak:
//   - The home feed leaves out running live blogs; they come in through Latest
//     and the sections (frontpage.mjs's liveFirst puts them on top).
//   - Pictures are 1800px squares: the landscape crops' file names differ per
//     crop and can't be derived from the feed's square one.
//   - Videos and a few articles have no picture.

const RSS = 'https://rss.nytimes.com/services/xml/rss/nyt/';

// URL path → section label: /2026/10/27/<section>/<subsection>/slug.html.
const SECTIONS = {
  us: 'U.S.', 'us/politics': 'Politics', world: 'World', business: 'Business', technology: 'Technology',
  science: 'Science', health: 'Health', well: 'Well', climate: 'Climate', nyregion: 'New York', arts: 'Arts',
  books: 'Books', movies: 'Movies', theater: 'Theater', style: 'Style', dining: 'Food', travel: 'Travel',
  realestate: 'Real Estate', sports: 'Sports', athletic: 'Sports', opinion: 'Opinion', magazine: 'Magazine',
  upshot: 'The Upshot', weather: 'Weather', briefing: 'Briefing', education: 'Education', obituaries: 'Obituaries',
  't-magazine': 'T Magazine', 'your-money': 'Business', insider: 'Times Insider', fashion: 'Style',
};

// Not stories: games, newsletters and podcasts, and the single posts of a live
// blog (/live/<date>/<section>/<blog>/<post>), which the sections list next to the blog.
const NOT_STORY = /^https:\/\/www\.nytimes\.com\/(?:crosswords|puzzles|games|briefing|podcasts|newsletters)\/|\/\d{4}\/\d\d\/\d\d\/briefing\/|-podcast[-.]|\/live\/\d{4}\/\d\d\/\d\d\/[\w-]+\/[\w-]+\/[\w-]+/;
const LIVE = /^https:\/\/www\.nytimes\.com\/live\//;

export default {
  id: 'nyt',
  name: 'The New York Times',
  owner: 'The New York Times Company',
  language: 'en',
  homepage: 'https://www.nytimes.com/',
  description: 'US national newspaper: the home page in its own order, the newest stories, and a stream per section.',
  ttlMs: 120_000,
  frontpage: {
    top: 'home',
    latest: 'recent',
    live: null,
    sections: ['us', 'world', 'politics', 'business', 'technology', 'science', 'arts'],
  },

  streams: [
    { id: 'home', name: 'Home Page', group: 'Top stories', url: `${RSS}HomePage.xml`, topics: ['general', 'front page'],
      keepOrder: true, description: 'What the home page shows now, in home-page order.' },
    { id: 'recent', name: 'Latest', group: 'Top stories', url: `${RSS}recent.xml`, topics: ['general'],
      description: 'The newest stories across the site.' },

    section('us', 'US', 'U.S.', 'News', ['united states'], 'National news.'),
    section('politics', 'Politics', 'Politics', 'Politics', ['politics', 'us politics'], 'US politics.'),
    section('world', 'World', 'World', 'World', ['international'], 'International news.'),
    section('business', 'Business', 'Business', 'Economy', ['business', 'economy'], 'Business and the economy.'),
    section('nyregion', 'NYRegion', 'New York', 'Regional', ['regional', 'new york'], 'New York City and region.'),
    section('technology', 'Technology', 'Technology', 'Science & Tech', ['technology'], 'Technology.'),
    section('science', 'Science', 'Science', 'Science & Tech', ['science'], 'Science.'),
    section('climate', 'Climate', 'Climate', 'Science & Tech', ['climate', 'environment'], 'Climate and environment.'),
    section('health', 'Health', 'Health', 'Lifestyle', ['health'], 'Health.'),
    section('arts', 'Arts', 'Arts', 'Culture', ['culture', 'arts'], 'Arts, books, film, music and television.'),
    section('opinion', 'Opinion', 'Opinion', 'Opinion', ['opinion'], 'Columns, guest essays and editorials.'),
  ],

  normalize,
  // Videos stay where the home page puts them; elsewhere they mostly repeat a
  // story or column next to them, often without a picture.
  enrich: (items, stream) => items.filter(i => !NOT_STORY.test(i.url) && (i.kind !== 'video' || stream.id === 'home')),
};

function section(id, feed, name, group, topics, description) {
  return { id, name, group, topics, url: `${RSS}${feed}.xml`, description: `${description} The section's RSS feed.` };
}

function normalize(item) {
  return {
    ...item,
    kind: /^https:\/\/www\.nytimes\.com\/video\//.test(item.url) ? 'video' : item.kind,
    live: LIVE.test(item.url),
    categories: [sectionOf(item.url)].filter(Boolean),
    // The Latest feed's pictures are 75px thumbnails; the same crop comes larger.
    image: item.image && {
      ...item.image,
      url: item.image.url.replace(/-thumbStandard(\.\w+)$/, '-mediumSquareAt3X$1'),
      ...(/-thumbStandard\.\w+$/.test(item.image.url) && { width: 1800, height: 1800 }),
    },
  };
}

function sectionOf(url) {
  const path = url.match(/^https:\/\/www\.nytimes\.com\/(?:\d{4}\/\d\d\/\d\d\/|(?:live|interactive)\/\d{4}\/\d\d\/\d\d\/|interactive\/\d{4}\/|video\/)?([\w-]+)(?:\/([\w-]+)\/)?/);
  if (!path) return null;
  return SECTIONS[`${path[1]}/${path[2]}`] ?? SECTIONS[path[1]] ?? null;
}
