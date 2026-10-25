# Wallpaper presets

A preset turns the normalized news data into a full-screen desktop wallpaper.
The host (`public/app.js`) fetches data, loads the preset, and calls it again
whenever data changes, the minute ticks over, or the screen size changes.

Each preset lives in its own folder and is registered in `index.js`:

```
presets/<id>/preset.js    ES module, default-exports the preset object
presets/<id>/preset.css   all styles, scoped under .preset-<id>
```

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
| `ctx.safe` | `{ top, bottom, dockWidth }`: px covered by the menu bar (top) and the Dock (bottom-center). Also CSS vars `--safe-top`, `--safe-bottom`, `--dock-width` on the screen |
| `ctx.fresh` | `Set` of post ids that arrived since the previous refresh (empty on first load) |
| `ctx.image(img, cssWidth)` | URL of a VRT image resized for `cssWidth` CSS px. Accepts an image object or a URL |
| `ctx.time(ts)` | Flemish newsroom time: `20u38` |
| `ctx.clock(ts)` | `20:38` |
| `ctx.ago(ts)` | `zonet`, `12 min geleden`, `3 uur geleden`, `gisteren 20u38`, `za 17 okt.` |
| `ctx.date(ts?, style?)` | `'long'`: `zaterdag 24 oktober 2026`; `'short'`: `za 24 okt.`; `'daymonth'`: `24 oktober` |
| `ctx.h(tag, props, ...children)` | DOM builder. `props.class`, `props.style` (object), `'--var'` props, `dataset` |
| `ctx.html(markup)` | `DocumentFragment` from a post's sanitized `html` |

## `data`

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

Live data: `curl localhost:4174/api/vrt-nws/wallpaper` (add `?follow=<id>` to
pick a liveblog; ids are in `liveblogs[].id`).

## Designing for a wallpaper

- It is read at a glance, from a distance, between windows. Hierarchy first:
  one thing should be readable in under a second.
- Keep text out of the menu bar band (`--safe-top`) and the Dock area
  (bottom-center, `--safe-bottom` by `--dock-width`). Images and texture may
  run underneath both.
- Nothing is clickable or scrollable. Content that does not fit must be cut
  cleanly (drop whole items, clamp lines), never overflow or scroll.
- It must work from 1440×900 up to 2560×1440 and a 3440×1440 ultrawide.
- Calm motion only. A new post can fade in or carry a small marker via
  `ctx.fresh`; nothing loops faster than a slow pulse.
- Dutch content, Belgian conventions: `20u38`, `zaterdag 24 oktober`.
- Credit the source (`VRT NWS`) visibly but quietly. Do not copy VRT's logo or
  brand styling.
