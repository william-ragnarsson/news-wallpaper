# Integrations

Everything that turns a news outlet into data. Each outlet we support is a
hand-written module with streams we have checked by hand; nothing here guesses at
an unknown site. The wallpaper presets and the stream explorer (`/explorer/`)
only ever see the normalized shapes below, never an outlet's raw feed.

```
integrations/
  catalog.mjs          the catalog: list outlets and streams, load a stream, health check
  outlets/index.mjs    the registry: one import per outlet
  outlets/<id>.mjs     one outlet: its streams and quirk fixes
  vrt-nws.mjs          VRT's web backend: front page, liveblogs, wallpaper payload
  lib/feed.mjs         RSS 2.0 / RDF / Atom reader and normalizeEntry()
  lib/http.mjs         fetch with charset handling, user agents, in-memory cache
  lib/xml.mjs          small XML parser and query helpers
  lib/html.mjs         HTML to text and paragraphs, entities, inline images
```

## HTTP API

Served by `server.mjs` (`npm run dev`, port 4174).

| Route | Returns |
| --- | --- |
| `GET /api/outlets` | `{ outlets: Outlet[] }` |
| `GET /api/outlets/:outlet/streams` | `{ outlet, streams: Stream[] }`, sorted by group |
| `GET /api/outlets/:outlet/streams/:stream` | a `StreamPayload`; add `?raw=1` for each item's source |
| `GET /api/outlets/:outlet/health` | a `HealthReport` for that outlet's listed streams |
| `GET /api/health` | a `HealthReport` for every outlet |

Errors come back as `{ error }` with the upstream's status where it makes sense:
404 for an unknown outlet or stream, 502 when the upstream answered with
something that is not a feed, 504 when it did not answer.

`npm run check` runs the health report from the command line and exits non-zero
when a stream fails (see `tools/check-feeds.mjs`).

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
  live: true,                    // kind 'liveblog' in an index
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

  streams: [{
    id, name, group, topics, description,
    url,                           // the feed; streams that share a URL share one fetch
    language,                      // optional: when it differs from the outlet's
    filter: item => …,             // optional: keep some items of the feed
    keepOrder: true,               // optional: keep the loader's order instead of newest first
    ttlMs, timeoutMs,              // optional: per-stream overrides
    staleAfterDays: 21,            // optional: for slow sections; the health check warns after this (default 7)
    load: async ({ raw }) => ({ fetchedAt, upstream, header?, items }),  // optional: not a feed
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

Try a new module with `npm run check -- --module integrations/outlets/<id>.mjs`
(it is registered for that run only), then add it to `outlets/index.mjs` and
open it in the explorer.
