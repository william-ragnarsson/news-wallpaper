# Wallpaper presets

A preset turns the normalized news data into a full-screen desktop wallpaper.
The host (`public/app.js`) fetches data, loads the preset, and calls it again
whenever data changes, the minute ticks over, or the screen size changes. It
also follows the settings (in the app, picked in Customize; on the dev server,
`.dev/settings.json`, set with `wallpaper-dev settings set`): when they change
it switches to the picked preset unless the URL pins one (`?preset=`), and
fetches again and re-renders at once. The liveblog designs follow the liveblog
in `?follow=`, else `auto`. A URL that pins both (`?preset=` and `?follow=`)
does not listen for changes. To see a design as the app draws it, use
`wallpaper-dev render --preset <id>` (AGENTS.md).

Each preset lives in its own folder and is registered in `index.js`, where
`data` says which payload it gets: `'front'` (the front page, below) or
`'wallpaper'` (one liveblog, the default):

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

## Marking stories: `data-story`

The app's menu bar lists the articles the picture shows under Articles, and
opens one when it is clicked. Its list comes from the page: mark the element
that shows a story (its block, with the headline) with the story's url,
`dataset: { story: s.url }`. Mark one element a story, and mark every story
the design shows: the lead, the columns, a rail of headlines, a liveblog
(`data.focus`, an entry of `data.liveblogs`), a headline of `data.headlines`.
A post has no url of its own; its liveblog stands for it.

The page lists a marked story when fitting left it in view: not `hidden` or
`display: none`, not `opacity: 0`, and not cut off by the screen or by a box
with `overflow: hidden`. One still fading in (an animation that ends) counts
as shown. It takes the title from the data, so a design may trim its own; a
liveblog's is its topic and its headline, `topic: title`. A story marked
twice (or a liveblog under two slugs) is listed once, where it comes first. `wallpaper.onScreen()` in the page's console
shows the list, and `wallpaper-dev render` prints it as `stories`.

## `ctx`

| field | what |
|---|---|
| `ctx.now` | `Date` of this render |
| `ctx.screen` | `{ width, height }` logical px of the simulated Mac screen |
| `ctx.safe` | `{ top, right, bottom, dockWidth }`: px covered by the menu bar (top), the desktop's files and folders (a column at the right edge, as wide as picked on Customize: `settings.margin`, 0 when none) and the Dock (bottom-center). Also CSS vars `--safe-top`, `--safe-right`, `--safe-bottom`, `--dock-width` on the screen. `top` is 0 when the window already starts below the menu bar (Plash with `?chrome=0`). The Dock area comes from `?dock=WxH`; with `?dock=0` (a Dock that hides itself) `bottom` and `dockWidth` are 0 |
| `ctx.fresh` | `Set` of post ids (story ids for `'front'`) that arrived since the previous refresh (empty on first load) |
| `ctx.image(img, cssWidth)` | URL of the image for `cssWidth` CSS px: a VRT image resized to fit, any other as it is. Accepts an image object or a URL |
| `ctx.pictures` | how many photos the settings ask for: `'none'`, `'one'` (the default) or `'several'`. A design that follows it says `pictures: true` in `index.js` |
| `ctx.color` | `true` for photos in color, `false` (the default) for black and white. A design that follows it says `color: true` in `index.js` |
| `ctx.density` | 1 to 5 (3 by default): from more headlines with little text (1) to fewer stories with more text each (5). A design that follows it says `density: true` in `index.js`; a template reads it through `kit.at()` (Templates) |
| `ctx.lang` | the page's language as a BCP 47 tag, the provider's: `nl-BE` (VRT NWS) or `en-US` (the US outlets). For the `lang` attribute |
| `ctx.t` | the page's own words in that language: `nameplate` (`Het Nieuws` / `The News`), `updated`, `source`, `live`, `liveNow`, `posts`, `new`, `video`, `latest`, `justIn`, `moreNews`, `allStories`, `frontPage`, `noNews`, `yesterday`, `colophon(name)`. Never write a word of the page's own in a preset |
| `ctx.time(ts)` | newsroom time: `20u38` in Dutch, `8:38 PM` in English |
| `ctx.clock(ts)` | `20:38` / `8:38 PM` |
| `ctx.ago(ts)` | `zonet`, `12 min geleden`, `3 uur geleden`, `gisteren 20u38`, `za 17 okt.`; in English `just now`, `12 min ago`, `3 hr ago`, `yesterday 8:38 PM`, `Sat, Oct 17` |
| `ctx.date(ts?, style?)` | `'long'`: `zaterdag 24 oktober 2026` / `Saturday, October 24, 2026`; `'short'`: `za 24 okt.`; `'daymonth'`: `24 oktober` |
| `ctx.h(tag, props, ...children)` | DOM builder. `props.class`, `props.style` (object), `'--var'` props, `dataset` |
| `ctx.html(markup)` | `DocumentFragment` from a post's sanitized `html` |

## Front-page data (`data: 'front'`)

From `getFrontpage(settings)` (`sources/frontpage.mjs`), which the page runs.
The provider's own front page, in its order, with the newest stories per
section and, for VRT NWS, the running liveblogs. A story is in `top` or in one
section, never both; `live` and `latest` may repeat them. Titles and summaries
are trimmed plain text.

The settings picked on Customize shape it, and a preset keeps their order:

- `top` is the provider's front page. With "Running live stories first"
  (`liveFirst`, on by default) it starts with the running live stories, newest
  first: liveblogs, and live pages (NYT, Washington Post, Fox News) that are
  articles with `live: true`. Then the front page follows, so `top[0]` is the
  newest live story, else the provider's own lead. Show the Live mark for any
  story with `live: true`, whatever its `kind`.
- `sections` are the ones picked there, in the order picked: any of the
  section streams, possibly none. Show them in that order; do not sort them or
  assume a fixed set. Leave out a section with no stories.
- `live` is VRT NWS's running liveblogs, for the designs that list them; empty
  for the other providers.
- A liveblog in `top` can also be in `live` and `latest`. Its URL slug follows
  its headline, so the same blog can come with two ids: match it by the number
  at the end of its URL (`…~1792507723130`), not only by `id`.

```js
{
  source: { id: 'vrt-nws', name: 'VRT NWS', language: 'nl', homepage },
  generatedAt: '2026-10-25T21:44:05.451Z',
  top: Story[],             // the running live stories (liveFirst), then the provider's front page:
                            // top[0] is the lead (about 40)
  sections: [{              // in the order picked on Customize (default: Binnenland, Buitenland, Politiek,
                            // Economie, Sport, Cultuur, Wetenschap); can be empty
    id: 'binnenland', name: 'Binnenland',
    stories: Story[],       // newest first, up to 6; most have no summary
  }],
  live: Story[],            // VRT NWS's running liveblogs, latest activity first; else empty
  latest: Story[],          // the whole site, newest first (20)
}

Story = {
  id, url,                  // id is the URL
  kind: 'article' | 'liveblog' | 'video',
  title: 'Storm Boelo trekt stilaan weg',
  summary: '…' | null,      // 1-3 sentences; always set in `top`, `live` and `latest`
  section: 'Binnenland' | null,   // the outlet's tag: a section, country or topic ("Europa", "Weer")
  image: { url, alt, credit } | null,   // pass to ctx.image(story.image, cssWidth)
  time,                     // publishedAt; for a liveblog its latest post
  live: true | false,       // on every story: a running liveblog or live page (its newest
                            // update under 12 hours old)
  points: ['…'],            // a running VRT NWS liveblog's summary points, else absent
  // kind 'liveblog' only (its summary is its latest post):
  postCount: 339 | null, startedAt,
  // kind 'video' only:
  durationSec: 34,
}
```

## Templates (M6)

A front-page design is best written as a template on the kit
(`presets/kit.js`, `presets/kit.css`): it says which regions it has and what
each one shows, and the kit fills them by the settings and fits them to the
screen, so every template follows Pictures, Color, Density and the width for
the desktop files alike, never overflows and leaves no holes. Newsprint,
Evening Edition, Homepage and Headlines are templates. The others predate it
and do not follow Pictures, Color or Density.

How it connects: Customize › Appearance (M4) saves the settings; the page
(`app.js`, drawn by WallpaperRender, M3) passes them in `ctx`; the template
declares its regions and the kit (M6) turns the two into stories and fits
them. Appearance knows a template only by its flags in `index.js` (`TEMPLATE`:
`margin`, `pictures`, `color`, `density`), which light up those settings; it
never sees the kit. A design imports only the kit, never another design, and
the kit imports nothing (`tools/check-boundaries.sh`).

```
presets/<id>/preset.js    import * as kit from '../kit.js';
presets/<id>/preset.css   @import url('../kit.css');   (first)
presets/index.js          { id, data: 'front', ...TEMPLATE, … }
```

### 1. Regions: `kit.plan(data, ctx, REGIONS)`

```js
// [a, b] is a at density 1 (more headlines) and b at 5 (more text each).
const REGIONS = {
  lead:     { from: 'top', stories: 1, words: [40, 120], points: [0, 4], pictures: 1 },
  briefs:   { from: 'top', stories: [16, 6], spares: 2, words: [0, 60], pictures: [0, 3] },
  latest:   { from: ['latest', 'top'], newest: true, stories: [14, 8] },
  sections: { from: 'sections', stories: [2, 1], groups: 7 },
};
const { lead: [lead] = [], briefs, latest, sections } = kit.plan(data, ctx, REGIONS);
```

Regions take stories in the order they are declared, and a story is on the
page once: a region skips what one before it took.

| key | what |
|---|---|
| `from` | `'top'`, `'latest'`, `'live'` or `'sections'`, or a list of them taken in turn. `'sections'` gives `[{ id, name, items }]`, in the order picked on Customize, a section with nothing left left out |
| `stories` | how many at most (per section for `'sections'`) |
| `groups` | `'sections'` only: how many sections at most |
| `spares` | how many more it takes as spares: they start hidden and come in when there is room (`fill`) |
| `words` | the summary cut to this many words; `0` for none; left out, all of it |
| `points` | how many of a liveblog's summary points |
| `pictures` | how many of its stories may carry their own picture: a number, or `[with 'one', with 'several']`. With `'one'` the page has one picture in all, at the first region that allows one; with `'none'`, none |
| `filter` | `(story) => boolean`, the stories it may take |
| `newest` | `true` to have what it took newest first |

Any number can be `[a, b]`, which `kit.at(ctx, [a, b])` turns into the value
at the density setting (between a at 1 and b at 5, rounded when both are
whole; `Infinity` is a below 3 and b from 3). A template's own sizes and
shares follow density the same way: `kit.at(ctx, LEAD_SHARE)`.

Each region comes back as items: `{ story, summary, points, picture, spare }`,
the summary and points to show, the story's picture (an image object for
`kit.photo`) or `null`, and whether it is a spare. Build a spare with
`kit.spare(el, item)` so it starts hidden.

### 2. Settings on the page: `kit.page(root, ctx)`

Call it first in `render()`. It puts the settings on the root for the CSS:
the classes `kit`, `pictures-none|one|several`, `density-1…5`, `is-color`,
and `--density` (0 at 1, 1 at 5). From `kit.css`:

- `[hidden]` hides with `display: none !important`, whatever display a design
  gives the element: fitting hides with the attribute.
- An element with class `kit-page` keeps the width for the desktop files:
  padding left and right of `var(--mx) + var(--safe-right)`, so the page stays
  centered. The design sets `--mx`, its own outer margin, and only the top and
  bottom padding of its `kit-page`.
- `kit.photo(ctx, picture, cssWidth, { cls, caption, credit })` builds
  `figure.kit-photo > div.kit-frame > img.kit-img`: the design sizes the frame
  (`aspect-ratio`, a height), the image covers it. Black and white uses
  `--photo-filter`, color (`is-color`) `--photo-filter-color`; set them on the
  design's root to tint the photos. Filters only: WebKit leaves an image with
  `mix-blend-mode` out of a 2× snapshot.

Also for `render()`: `kit.prose(ctx, text, cls)` (a paragraph whose text the
fitting can cut: build every summary and point with it), `kit.typo(title)`
(curly quotes, dashes, ellipses), `kit.when(story, ctx)`, `kit.storyKey(story)`.

### 3. Fitting, in `layout()`

`layout()` starts with `kit.reset(root)`: it shows again what fitting hid,
hides the spares again, and takes back cut texts and sizes, so it can run
again (fonts loading, a resize) from what `render()` built. Then, region by
region, until nothing overflows (`kit.overflows(el)`) and nothing leaves a
hole:

| helper | what |
|---|---|
| `dropToFit(items, over, { trim })` | hides items from the end while `over()`; with `trim` (words), the first one hidden comes back cut to what fits |
| `fill(items, over, { trim })` | once all of a region's own items fit, its spares come in while they fit |
| `trimToFit(box, over, minWords)` | cuts the last text (`kit.prose`) in `box` by words while `over()`; a text left with fewer than `minWords` goes, and the one before it is cut |
| `trimEvenly(paras, over, minWords)` | cuts a row of texts to the same number of words, so the row stays even |
| `picturesToFit(box, room)` | hides a picture whose block leaves less than `room` px of the box's height (columns would slice it) |
| `fullRows(grid, items)` | rounds a grid down to full rows |
| `fitSize(el, lo, hi, ok)` | the largest font size between `lo` and `hi` px for which `ok()` holds |
| `spread(box, items)`, `grow(el, prop, by)` | gives the room left between items, or to one property |
| `columnsOf(box)`, `spreadColumns(box, unitsFor)` | balances text columns |
| `hide`, `show`, `setStyle(el, prop, value)` | what fitting does by hand; `reset()` undoes it |

The order is the template's own: what gives way first. In Headlines, for
example, tier two's summaries are cut first, then the lead's summary, then
tier two's pictures, then the lead's photo; the lead's headline then grows
(`fitSize`) into what room is left, and the index takes the rest in full rows.

### Checking a template

Render it at every setting with `wallpaper-dev render` (AGENTS.md), for
example `--preset headlines --settings '{"density": 1}'`, then 5,
`'{"pictures": "none"}'`, `'{"pictures": "several", "color": true}'`,
`'{"margin": 0}'` and `'{"margin": 240}'`, at 1680x1050 and 1512x982, for
each outlet (`settings set provider=…`, then `fetch`). Look for overflow,
holes, a page that does not change with the setting, and empty picture boxes.

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
else `auto`.

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
- The provider's language and conventions: Dutch with Belgian ones (`20u38`,
  `zaterdag 24 oktober`) for VRT NWS, English with US ones (`8:38 PM`,
  `Saturday, October 24`) for the US outlets. Words and times come from `ctx`.
- Some providers' stories have no pictures (The Washington Post's never do):
  a front-page design fills the space with text, never an empty box.
- Pictures are a seasoning: one photo keeps a page text-led. Follow
  `ctx.pictures` and `ctx.color` where a design has photos, and tint them with
  CSS `filter` alone: WebKit leaves an image with `mix-blend-mode` out of a 2×
  snapshot, so it comes out as an empty box on the desktop.
- Customize shows each design as a card with a small picture of it, drawn as
  the desktop picture is (scale 0.25), so a design must also read at that size.
- Credit the source (`data.source.name`) visibly but quietly. Do not copy an
  outlet's logo or brand styling.
