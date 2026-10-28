# Sources

Everything that turns a news outlet into data: the project's backend, except
that it runs wherever the wallpaper page runs. Each outlet we support is a
hand-written module with streams we have checked by hand; nothing here guesses at
an unknown site. The wallpaper presets and the stream explorer (`/explorer/`)
only ever see the normalized shapes below, never an outlet's raw feed.

```
sources/
  index.mjs            the entry: the one module anything outside sources/ imports
  catalog.mjs          the catalog: list outlets and streams, load a stream, health check
  outlets/index.mjs    the registry: one import per outlet
  outlets/<id>.mjs     one outlet: its streams and quirk fixes
  liveblog.mjs         VRT's web backend: front page, liveblogs, wallpaper payload
  frontpage.mjs        the front-page payload with the settings applied; the options to pick from
  lib/feed.mjs         RSS 2.0 / RDF / Atom reader and normalizeEntry()
  lib/http.mjs         fetch with charset handling, user agents, in-memory cache, setTransport()
  lib/reader.mjs       where the payloads read the news from: live, or stored (setReader())
  lib/xml.mjs          small XML parser and query helpers
  lib/html.mjs         HTML to text and paragraphs, entities, inline images
```

## Hosts

The modules are plain JavaScript with no Node or DOM APIs, so they run both in
Node and in the wallpaper page. Import them from `index.mjs` only.

- **The wallpaper page** (`public/host.js`) imports them from `/sources/` and
  runs them itself. That is how both the macOS app and the dev preview show
  the news.
- **The dev server** (`server.mjs`) runs them for the explorer and
  `tools/check-feeds.mjs`, and serves the results as JSON (the HTTP API
  below).

The payloads (`getFrontpage`, `getWallpaper`) read the news
through `lib/reader.mjs`: `loadStream`, `getFront` and `getLiveblog`, live by
default. `setReader({ loadStream, getFront, getLiveblog, now })` swaps in a
reader of news stored earlier, such as the document `public/harvest.js` makes
for the app (`public/host.js` does, with `?data=store`); `now()` is when that
news was fetched, which the payloads give as `generatedAt`. `setReader(null)`
goes back to live. The catalog and the outlets always
load live.

The network is the host's. `setTransport(fn)` replaces the default, the global
fetch. A transport takes fetch's `(url, { headers, signal })` and resolves to
`{ ok, status, url, headers, arrayBuffer() }`, where `url` is the final URL
after redirects. It rejects when the site could not be reached. The page cannot
fetch VRT itself (CORS), so its transport goes through its host. Both hosts
answer the same paths:

| Path | Returns |
| --- | --- |
| `/` | `public/` |
| `/sources/…` | `sources/`, as ES modules |
| `GET /net?url=<url>` | a GET to that URL, made by the host. Only https on the outlets' domains (`vrt.be`, `nytimes.com`, `washingtonpost.com`, `foxnews.com`) and their subdomains, redirects included. The site's status, content type and body come back, plus the URL it ended at in `x-final-url`. When the site did not answer: 504 with the reason in `x-net-error`. The request's `accept` is passed on and `x-user-agent` becomes the user agent. Any other URL is refused with a 4xx |
| `GET /api/news` | the news stored last, as `public/harvest.js` makes it (the app's `news.json`; the dev server's `.dev/news.json`, from `wallpaper-dev fetch`). 503 with `{ error }` when there is none |
| `GET /api/settings` | the `Settings` (see below) |

The page drawn in the app has no `/net`: it reads `/api/news` only. The dev server is `http://localhost:4174/` and the app is `wallpaper://app/`
(`app/Sources/WallpaperCore/Bridge.swift`).

## HTTP API

Served by `server.mjs` (`npm run dev`, port 4174) only. The macOS app does not
serve it.

| Route | Returns |
| --- | --- |
| `GET /api/outlets` | `{ outlets: Outlet[] }` |
| `GET /api/outlets/:outlet/streams` | `{ outlet, streams: Stream[] }`, sorted by group |
| `GET /api/outlets/:outlet/streams/:stream` | a `StreamPayload`; add `?raw=1` for each item's source |
| `GET /api/outlets/:outlet/health` | a `HealthReport` for that outlet's listed streams |
| `GET /api/health` | a `HealthReport` for every outlet |
| `GET /api/settings` | the `Settings` |
| `GET /api/settings/events` | server-sent events: `settings` with the `Settings` on connect and after every change |

Errors come back as `{ error }` with the upstream's status where it makes sense:
404 for an unknown outlet or stream, 502 when the upstream answered with
something that is not a feed, 504 when it did not answer. A known route asked
with another method gets 405.

`npm run check` runs the health report from the command line and exits non-zero
when a stream fails (see `tools/check-feeds.mjs`).

## Wallpaper settings

What the wallpaper shows, picked in the app's Customize window or with
`wallpaper-dev settings set` (AGENTS.md). The rules (the defaults, what each field may be,
the options) are one module, `public/settings.js`, which every keeper runs: the
app and `wallpaper-dev` in a web view (`app/Sources/WallpaperCore/SettingsService.swift`),
the dev server in Node (`settings.mjs`, which only reads them). Each keeps a
`settings.json`:

- the app: `~/Library/Application Support/WallpaperHeadlines/settings.json`
- the dev server and `wallpaper-dev`: `.dev/settings.json` in the worktree (gitignored)

A missing file means the defaults; a field that is no longer valid (a preset or
section that was removed) falls back to its default. Saves run one at a time and
replace the file in one step (a temp file, then a rename). The page fills in the
defaults.

### Settings

```js
{
  preset: 'newsprint',           // a preset id from public/presets/index.js
  provider: 'vrt-nws',           // the outlet the front page comes from, and the only one the app
                                 // fetches: 'vrt-nws', 'nyt', 'washington-post' or 'fox-news'
  liveFirst: true,               // running live stories (liveblogs, live pages) lead the front page
  sections: ['binnenland', …],   // section stream ids below the front page, in order; none to all
  margin: 104,                   // points kept blank at the right edge for the desktop's files and
                                 // folders (ctx.safe.right), 0 to 320; centered designs keep as much left
  pictures: 'one',               // how many photos the front page shows: 'none', 'one' or 'several'
                                 // (ctx.pictures)
  color: false,                  // photos in color (true) or in black and white (false) (ctx.color)
  updatedAt: '2026-10-26T16:29:29.263Z' | null,  // ISO time of the last save; null for the defaults
}
```

Defaults: `preset: 'newsprint'`, `provider: 'vrt-nws'`, `liveFirst: true`,
`sections: ['binnenland', 'buitenland', 'politiek', 'economie', 'sport', 'cultuur', 'wetenschap']`,
`margin: 104`, `pictures: 'one'`, `color: false`. The sections are the
provider's own pick (its `frontpage.sections`).

A change (`SettingsService.update`) takes any of the fields but `updatedAt`;
each one sent replaces the saved value (arrays whole), and the keeper sets
`updatedAt`. It saves all or nothing: an unknown key or an invalid value is
turned down. A section id
is the provider's stream of the same id. Another provider brings its own
sections, and Newsprint if the design in use is a liveblog
design (those show VRT's liveblogs), unless the same change sets them.
A settings file may still hold `liveblogs` and `otherLiveblogs` (picked
liveblogs, before `liveFirst`): they are ignored when read, dropped on the next
save, and turned down in a change.

### SettingsOptions

What there is to pick from (`SettingsService.options`, `wallpaper-dev options`).
Nothing in it is fetched.

```js
{
  presets: [{                    // public/presets/index.js, in order
    id: 'newsprint', name: 'Newsprint', description: '…',
    data: 'front',               // a front-page design (getFrontpage); absent for
                                 // the liveblog designs (getWallpaper)
    sections: true,              // front-page designs that show `sections`; absent otherwise
    live: true,                  // front-page designs that list the running liveblogs (`live`):
                                 // Evening Edition and Headlines; absent otherwise
    margin: true,                // designs that keep the `margin` clear; absent otherwise
    pictures: true,              // designs that follow `pictures`; absent otherwise
    color: true,                 // designs that follow `color`; absent otherwise
  }],
  providers: [{                  // the outlets a front page can come from (sources/frontpage.mjs)
    id: 'vrt-nws', name: 'VRT NWS', owner: 'VRT', language: 'nl', homepage: 'https://…', description: '…',
    sections: [{ id: 'binnenland', name: 'Binnenland', group: 'News' }],  // its section streams
    defaultSections: ['binnenland', …],  // its own pick
    liveblogs: true,             // whether it has liveblogs to follow (VRT NWS only)
  }],
  maxMargin: 320,
}
```

### Events

`GET /api/settings/events` is a `text/event-stream`: `retry: 2000`, then an
event `settings` with the `Settings` as JSON right after connecting and again
after every change. A `: ping` comment every 30 s keeps the connection open.
`EventSource` reconnects by itself after a server restart and gets the current
settings again on connect.

```js
new EventSource('/api/settings/events').addEventListener('settings', e => apply(JSON.parse(e.data)));
```

### The front page with the settings applied

`getFrontpage(settings)`, which the page calls on every refresh, gives
`{ source, generatedAt, top, sections, live, latest }`, each list of `Story`:

- `top` is the provider's own front page (its `frontpage.top` stream). With
  `liveFirst`, the running live stories lead it, newest first: those on the
  front page, and those the front page's feed leaves out but the site's newest
  (`frontpage.latest`) has (NYT's home feed omits its live blogs).
- `sections` come in the settings order, each with up to 6 stories not already
  in `top` or an earlier section. A section that fails to load is left out.
- `live` is the running liveblogs from `frontpage.live` (VRT NWS only), for the
  designs that list them; they may repeat stories in `top`.
- `latest` is the newest across the site (`frontpage.latest`, else the newest
  of what was loaded).
- `preset` does not change the payload: the wallpaper page reads it.

`getHeadlines({ provider, perSection = 3 })` gives what Customize's Sources
pane lists, from the same reader: `{ provider, live, sections }`, with `live`
the running live stories in the order `liveFirst` leads `top` with them, and
`sections` each of the provider's sections' first `perSection` stories, by
section id (`{ us: [Story] }`). It throws when the news has not got the
provider's front page. `options()` in public/settings.js passes it on as
`headlines`.

```js
// Story
{
  id: 'https://…',               // the URL
  kind: 'article' | 'liveblog' | 'video',
  url, title,
  summary: '…' | null,           // a liveblog's: its latest post, without the headline again
  section: 'Politiek' | null,
  image: { url, alt, credit } | null,
  time: 1792939473618 | null,    // a liveblog's latest post, else publishedAt
  live: true | false,            // a running live blog or live page, as the outlet marks it
                                 // (VRT liveblogs with status live; NYT /live/ URLs; WaPo and Fox
                                 // live-updates URLs or "Live updates:" titles), and only while
                                 // its newest update is under 12 hours old
  points: ['…'],                 // a running VRT NWS liveblog's summary points, else absent
  postCount: 82 | null,          // kind 'liveblog' only
  startedAt: 1792507723130,      // kind 'liveblog' only
  durationSec: 95 | null,        // kind 'video' only
}
```

## Shapes

Times are epoch milliseconds (UTC). Absent values are `null`, never `undefined`
or `''`. Lists are always present, possibly empty.

### Outlet

```js
{
  id: 'vrt-nws',                 // stable, kebab-case
  name: 'VRT NWS',
  owner: 'VRT',                  // the media group, for grouping and attribution
  language: 'nl',                // the outlet's main language; a stream can differ
  homepage: 'https://www.vrt.be/vrtnws/nl/',
  description: '…' | null,
  streamCount: 9,                // listed streams (liveblogs not included)
  hasLive: true,                 // the outlet adds streams at runtime
}
```

### Stream

One thing a reader can follow: a section feed, a filtered view of a feed, a
section list from an outlet's own backend, a liveblog, or an index of liveblogs.

```js
{
  id: 'politiek',                // unique within the outlet
  name: 'Politiek',              // the outlet's own wording
  group: 'Politics',             // one of catalog.GROUPS, for the sidebar
  kind: 'feed' | 'index' | 'liveblog',
  language: 'nl',
  description: '…' | null,       // what is in it, in plain words
  topics: ['politics', 'belgian politics'],  // loose English tags for picking streams later
  url: 'https://…' | null,       // the upstream feed, when there is one
  derived: true,                 // a filter over a shared feed, not its own URL
  live: true | false | null,     // liveblogs: still running?
  updatedAt: 1792939473618 | null,  // liveblogs: time of the latest post
}
```

Groups, in sidebar order: Top stories, Live, News, Politics, World, Economy,
Regional, Sport, Culture, Science & Tech, Opinion, Lifestyle, In English, Other.

### StreamPayload

```js
{
  outlet: Outlet,                // without streamCount / hasLive
  stream: Stream,
  fetchedAt: 1792939473618,      // when the upstream was last fetched (it may be cached)
  upstream: {
    url, finalUrl,               // finalUrl after redirects
    format: 'rss2' | 'rdf' | 'atom' | 'vrt-bff-json' | 'vrt-liveblog-json' | …,
    status, contentType, bytes, ms,
    title,                       // the feed's own title
    entries,                     // entries in the feed, before the stream's filter
  },
  header: LiveblogHeader | null, // set for liveblog streams
  stats: {
    count,
    newestAt, oldestAt,          // by activity time (see below)
    coverage: { date, image, summary, author, categories, body },  // share of items, 0..1
    premium,                     // items behind a paywall
  },
  items: Item[],                 // newest first, unless the stream keeps its own order
}
```

### Item

```js
{
  id: '…',                       // the feed's guid, else the URL; unique within the stream
  kind: 'article' | 'liveblog' | 'video' | 'post',
  url: 'https://…',              // the canonical page, tracking parameters removed
  title: '…',                    // plain text
  summary: '…' | null,           // plain text lead; never just the title again
  publishedAt: 1792939473618 | null,
  updatedAt: 1792939473618 | null,   // only when it differs from publishedAt
  authors: ['Jan Peeters'],      // names only; e-mail addresses dropped
  categories: ['Politiek'],      // the outlet's own section or tag names
  image: {
    url, alt, credit,            // alt '' when unknown, credit null when unknown
    width, height,               // null when the feed does not say
    source: 'media:content' | 'enclosure' | 'image' | 'media:thumbnail' | 'html' | …,
  } | null,
  premium: false,                // behind the outlet's paywall
  paragraphs: ['…'] | null,      // full text, when the feed carries more than one paragraph

  // Optional, depending on the outlet and kind:
  brand: 'radio-2',              // VRT: which newsroom published it
  durationSec: 95,               // kind 'video'
  liveblogId: '1792507723130',   // kind 'liveblog': open it as a stream with…
  streamId: 'liveblog-1792507723130',
  live: true,                    // a running live blog or live page (each outlet module sets it;
                                 // false or absent otherwise)
  postCount: 74,
  highlight: true,               // kind 'post': the newsroom marked it as key
  blocks: Block[],               // kind 'post': the post body as typed blocks
  raw: '<entry>…</entry>',       // only with ?raw=1: the source XML or JSON
}
```

Liveblogs start days or weeks before their latest post, so sorting and
freshness use an item's activity time: `updatedAt ?? publishedAt` for kind
`liveblog`, `publishedAt` for everything else.

`Block` is one piece of a liveblog post, in order. `image` inside a block is
`{ url, alt, credit }`.

| `type` | Fields |
| --- | --- |
| `title` | `text, emphasised` |
| `text` | `paragraphs, html` (sanitized), `emphasised` |
| `image` | `image` |
| `video` | `image, ratio, durationSec, name` (a poster frame; no playable URL) |
| `audio` | `title, show, duration` |
| `quote` | `text, by` |
| `teaser` | `label, title, url, image` (a link to another article) |
| `embed` | `network` (`x`, `youtube`, `datawrapper`, `instagram`, …), `text, title, attribution, url` |

### LiveblogHeader

```js
{
  kind: 'liveblog', id, url,
  status: 'live' | 'ended',
  label, topic, section,          // VRT's kicker, topic and section names
  title, intro,
  image: Image | null,
  summary: { title, points: ['…'] } | null,  // the newsroom's "in short" box
  startedAt, updatedAt, postCount,
}
```

### HealthReport

```js
{
  checkedAt,
  streams: [{
    outletId, streamId, name, group, url,
    ok: true, upstream, stats,    // as in StreamPayload
    staleAfterDays,               // the stream's threshold for the stale warning
    warnings: ['empty' | 'N% of items have no date' | 'stale: …' | 'same items as <stream>'],
  } | {
    outletId, streamId, name, group, url,
    ok: false, error, status, warnings: [],
  }],
}
```

"same items as" flags two streams of one outlet that return identical items,
which usually means a section URL silently serves the main feed.

## Writing an outlet module

An outlet module default-exports a plain object. Only list streams you have
opened and checked: the right section, current items, dates present.

```js
export default {
  id, name, owner, language, homepage, description,
  ttlMs: 60_000,                   // optional: cache time for this outlet's feeds (default 90 s)
  timeoutMs: 30_000,               // optional: per-request timeout (default 15 s)
  retries: 1,                      // optional: extra tries after a timeout or 5xx (default 0)
  userAgent: BROWSER_USER_AGENT,   // optional: for CDNs that refuse the default agent
  headers: { … },                  // optional: extra request headers

  // Optional: the outlet can be a provider, the one the front page comes from.
  // Stream ids: the front page itself (required), the whole site newest first,
  // the index of running liveblogs, and the sections picked by default. Any
  // but `top` may be null; without `latest` the newest of what was loaded
  // stands in. The page's words and times follow `language` ('nl' or 'en').
  frontpage: { top: 'home', latest: 'recent', live: null, sections: ['us', 'world', …] },

  streams: [{
    id, name, group, topics, description,
    url,                           // the feed; streams that share a URL share one fetch
    language,                      // optional: when it differs from the outlet's
    filter: item => …,             // optional: keep some items of the feed
    keepOrder: true,               // optional: keep the loader's order instead of newest first
    ttlMs, timeoutMs,              // optional: per-stream overrides
    staleAfterDays: 21,            // optional: for slow sections; the health check warns after this (default 7)
    load: async ({ raw, loadStream }) => ({ fetchedAt, upstream, header?, items }),  // optional: not a
                                   // feed; loadStream(id) gives another stream of the outlet (Fox's top merges three)
  }],

  normalize(item, entry, stream) { return { ...item, … } },  // optional: fix quirks per item
  async enrich(items, stream) { return items },              // optional: fill gaps from another source
  async liveStreams() { return [Stream…] },                  // optional: streams that come and go
  resolveStream(streamId) { return Stream | null },          // optional: unlisted ids (ended liveblogs)
};
```

`normalize` gets the generic item from `normalizeEntry()` and the parsed feed
entry (`entry.node` is the XML element), so it can read outlet-specific tags.
Typical fixes: the paywall marker, a better image size from a URL template, the
section from a category scheme, the canonical URL.

`enrich` runs once per load on the filtered items of a feed stream and may
fetch: VRT uses it to fill liveblog summaries from the liveblog itself. Cache
what it fetches (`cached()` in `lib/http.mjs`) so a refresh does not refetch.

Try a new module with `npm run check -- --module sources/outlets/<id>.mjs`
(it is registered for that run only), then add it to `outlets/index.mjs` and
open it in the explorer.
