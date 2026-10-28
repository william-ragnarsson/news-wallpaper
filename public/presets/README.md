# Wallpaper presets

A preset turns the normalized news data into a full-screen desktop wallpaper.
The host (`public/app.js`) fetches data, loads the preset, and calls it again
whenever data changes, the minute ticks over, or the screen size changes. It
also follows the settings (in the app, picked in Customize; on the dev server,
`.dev/settings.json`, set with `wallpaper-dev settings set`): when they change
it switches to the picked preset unless the URL pins one (`?preset=`), follows
the first picked liveblog unless the URL pins one (`?follow=`), and fetches
again and re-renders at once. A URL that pins both does not listen for
changes. To see a design as the app draws it, use `wallpaper-dev render
--preset <id>` (AGENTS.md).

Each preset lives in its own folder and is registered in `index.js`, where
`data` says which payload it gets: `'front'` (the front page, below) or
`'wallpaper'` (one liveblog, the default):

```
presets/<id>/preset.js    ES module, default-exports the preset object
presets/<id>/preset.css   all styles, scoped under .preset-<id>
```

That is all a new design needs. Customize shows each one in `index.js` as a
card with its `name`, its `description` and a small picture of it, which the
app draws from the stored news as it draws the desktop picture: there is no
screenshot to make or keep up to date.

## The preset object

```js
export default {
  id: 'broadsheet',
  name: 'Broadsheet',
  // Brightness of the wallpaper behind the macOS menu bar: 'light' gives dark
  // menu-bar text, 'dark' gives white text.
  tone: 'light',

  // Required. Build the wallpaper inside `root` (an empty element that fills
  // the screen). Called on every update: build from scratch, keep no state.
  render(root, data, ctx) {},

  // Optional. Runs after render and again once web fonts load. Use it to
  // measure and drop items that overflow, never to fetch.
  layout(root, ctx) {},
};
```

`root` gets the class `preset-<id>`. Scope every CSS rule under it. The
screen is a CSS size container, so `cqw`, `cqh`, `cqmin` work and refer to the
simulated screen (not the browser window).

## `ctx`

| field | what |
|---|---|
| `ctx.now` | `Date` of this render |
| `ctx.screen` | `{ width, height }` logical px of the simulated Mac screen |
| `ctx.safe` | `{ top, right, bottom, dockWidth }`: px covered by the menu bar (top), the desktop's files and folders (a column at the right edge, as wide as picked on Customize: `settings.margin`, 0 when none) and the Dock (bottom-center). Also CSS vars `--safe-top`, `--safe-right`, `--safe-bottom`, `--dock-width` on the screen. `top` is 0 when the window already starts below the menu bar (Plash with `?chrome=0`). The Dock area comes from `?dock=WxH`; with `?dock=0` (a Dock that hides itself) `bottom` and `dockWidth` are 0 |
| `ctx.fresh` | `Set` of post ids (story ids for `'front'`) that arrived since the previous refresh (empty on first load) |
| `ctx.image(img, cssWidth)` | URL of a VRT image resized for `cssWidth` CSS px. Accepts an image object or a URL |
| `ctx.time(ts)` | Flemish newsroom time: `20u38` |
| `ctx.clock(ts)` | `20:38` |
| `ctx.ago(ts)` | `zonet`, `12 min geleden`, `3 uur geleden`, `gisteren 20u38`, `za 17 okt.` |
| `ctx.date(ts?, style?)` | `'long'`: `zaterdag 24 oktober 2026`; `'short'`: `za 24 okt.`; `'daymonth'`: `24 oktober` |
| `ctx.h(tag, props, ...children)` | DOM builder. `props.class`, `props.style` (object), `'--var'` props, `dataset` |
| `ctx.html(markup)` | `DocumentFragment` from a post's sanitized `html` |

## Front-page data (`data: 'front'`)

From `getFrontpage(settings)` (`sources/frontpage.mjs`), which the page runs. VRT NWS's own front page, in its order,
with the newest stories per section and the running liveblogs. A story is in
`top` or in one section, never both; `live` and `latest` may repeat them.
Titles and summaries are trimmed plain text.

The settings picked on Customize shape it, and a preset keeps their order:

- `top` starts with the liveblogs picked there (`featured: true`, the first
  one is the lead), then VRT's front page follows. Without picks, `top[0]` is
  VRT's own lead. A picked liveblog that is live shows its Live mark like any
  other.
- `sections` are the ones picked there, in the order picked: any of the
  section streams, possibly none. Show them in that order; do not sort them or
  assume a fixed set. Leave out a section with no stories.
- `live` is empty when "other liveblogs" is off there (the picked ones already lead `top`).
- A liveblog in `top` can also be in `live` and `latest`. Its URL slug follows
  its headline, so the same blog can come with two ids: match it by the number
  at the end of its URL (`…~1792507723130`), not only by `id`.

```js
{
  source: { id: 'vrt-nws', name: 'VRT NWS', language: 'nl', homepage },
  generatedAt: '2026-10-25T21:44:05.451Z',
  top: Story[],             // the picked liveblogs, then the front page in VRT's order: top[0] is the lead (about 40)
  sections: [{              // in the order picked on Customize (default: Binnenland, Buitenland, Politiek,
                            // Economie, Sport, Cultuur, Wetenschap); can be empty
    id: 'binnenland', name: 'Binnenland',
    stories: Story[],       // newest first, up to 6; most have no summary
  }],
  live: Story[],            // running liveblogs, latest activity first; empty when "other liveblogs" is off
  latest: Story[],          // the whole site, newest first (20)
}

Story = {
  id, url,                  // id is the URL
  kind: 'article' | 'liveblog' | 'video',
  title: 'Storm Boelo trekt stilaan weg',
  summary: '…' | null,      // 1-3 sentences; always set in `top`, `live` and `latest`
  section: 'Binnenland' | null,   // VRT's tag: a section, country or topic ("Europa", "Weer")
  image: { url, alt, credit } | null,   // pass to ctx.image(story.image, cssWidth)
  time,                     // publishedAt; for a liveblog its latest post
  // kind 'liveblog' only:
  live: true, postCount: 339, startedAt,
  featured: true,           // only on liveblogs picked on Customize, at the start of `top`;
                            // their summary is the latest post ("post title: first paragraph")
  // kind 'video' only:
  durationSec: 34,
}
```

## Liveblog data (`data: 'wallpaper'`)

All timestamps are epoch milliseconds. Text is plain unless the field is
named `html`.

```js
{
  source: { id: 'vrt-nws', name: 'VRT NWS', language: 'nl', homepage },
  generatedAt: '2026-10-24T19:20:00.000Z',
  follow: 'auto' | '<liveblog id>',

  // The liveblog the wallpaper is about. Auto = most active live liveblog.
  focus: Liveblog,          // with posts (newest first, up to 40)

  // Every liveblog VRT currently lists, newest activity first, focus included.
  liveblogs: [Liveblog & {
    isFocus: boolean,
    postsInWindow: number,   // posts in the last 3 hours
    recent: Post[],          // newest 3 posts
  }],                        // these entries have no `posts` field

  // Regular (non-liveblog) articles from the main feed, newest first.
  headlines: [{
    id, kind: 'article', title, summary, section /* 'Binnenland' | null */,
    url, image: { url, alt, ratio } | null, publishedAt, updatedAt,
  }],
}

Liveblog = {
  id, url,
  status: 'live' | 'ended',
  label: 'Liveblog' | 'Einde liveblog',
  topic: 'Protest en rellen in Europa',     // short running name, like a rubric
  title: 'Bijna 1.000 betogers opgepakt …',  // current headline of the liveblog (long)
  intro: 'In Frankrijk zijn er grote …',     // 1-3 sentences
  section: 'Binnenland' | null,
  image: Image | null,                       // lead photo
  summary: { title: 'Kort samengevat', points: [string] } | null,
  startedAt, updatedAt, postCount,
  posts: Post[],
}

Post = {
  id, timestamp, time /* ISO */,
  title: string,            // can be '' (rare)
  highlight: boolean,       // VRT marked it as important
  author: string | null,
  paragraphs: [string],     // plain text; list items start with '• '
  text: string,             // paragraphs joined with blank lines
  image: Image | null,      // first image, video poster or teaser image
  hasVideo: boolean,
  blocks: Block[],          // full body in order, see below
}

Image = { url, alt, caption, credit, ratio /* '16/9', '9/16', '8/5' */, sensitive }

Block =
  | { type: 'text', paragraphs, html, emphasised }
  | { type: 'image', image }
  | { type: 'video', image, ratio, durationSec, name }
  | { type: 'audio', title, show, duration }
  | { type: 'quote', text, by }
  | { type: 'teaser', label, title, url, image }
  | { type: 'embed', network: 'x' | 'datawrapper' | 'truthsocial' | 'facebook' | …, text, title?, attribution, url }
```

The data a design got: `wallpaper.state.data` in the page's console. The host
follows the liveblog in the page's `?follow=` (ids are in `liveblogs[].id`),
else the first one picked on Customize, else `auto`.

## Designing for a wallpaper

- It is read at a glance, from a distance, between windows. Hierarchy first:
  one thing should be readable in under a second.
- Keep text out of the menu bar band (`--safe-top`), the desktop files column
  (`--safe-right`) and the Dock area (bottom-center, `--safe-bottom` by
  `--dock-width`). Images and texture may run underneath them.
- Nothing is clickable or scrollable. Content that does not fit must be cut
  cleanly (drop whole items, clamp lines), never overflow or scroll.
- It must work from 1440×900 up to 2560×1440 and a 3440×1440 ultrawide.
- Calm motion only. A new post can fade in or carry a small marker via
  `ctx.fresh`; nothing loops faster than a slow pulse.
- Dutch content, Belgian conventions: `20u38`, `zaterdag 24 oktober`.
- Credit the source (`VRT NWS`) visibly but quietly. Do not copy VRT's logo or
  brand styling.
