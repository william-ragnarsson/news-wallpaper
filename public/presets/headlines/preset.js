// Headlines: the provider's front page set as ranked headlines, type first.
// A template on the kit (../kit.js, presets/README.md "Templates").
//
//   date ············ nameplate ············ Bijgewerkt 21u44 · Bron
//   ───────────────────────────────────────────────────────────────── fine rule
//   kicker
//   The lead, very large, over 2-3 columns         [photo]
//                                                  its summary
//   ─────────────────────────────────────────────────────────────────
//   second tier: one row of headlines with a short summary
//   third tier: headline-only index, as many rows as fit
//   ─────────────────────────────────────────────────────────────────
//   ● LIVE  the other running liveblogs, on one line
//
// The front page's order is kept: top[0] is the lead (the newest running live
// story when live stories lead, else the provider's own lead), then the tiers
// read left to right.
// Type scales with the screen's short side, so a wider screen simply holds
// more columns. layout() hides whole stories that do not fit, never half a line.

import * as kit from '../kit.js';

// What each region shows, in the order they take stories; [a, b] is a at
// density 1 (more headlines) and b at 5 (fewer stories, more text each).
// `second` and `index` are per column (columnsFor()): tier two is one row, its
// stories each with their picture when there are several. With one picture,
// it is the lead's.
const REGIONS = {
  lead: { from: ['top', 'latest'], stories: 1, words: [24, 80], points: [0, 3], pictures: 1 },
  second: { from: ['top', 'latest'], stories: 1, words: [0, 60], pictures: [0, 1] },
  index: { from: ['top', 'latest'], stories: [8, 5], words: 0 },
};

// The lead keeps to this share of the page's height, its photo to this
// height (in --u, a hundredth of the short side); the index keeps at least
// this many rows, one when tier two has its pictures. The summaries give way
// first.
const LEAD_SHARE = [0.4, 0.55];
const PHOTO_HEIGHT = [20, 30];
const MIN_ROWS = [2, 1];

export default {
  id: 'headlines',
  name: 'Headlines',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    kit.page(root, ctx);
    const cols = columnsFor(ctx.screen, ctx.safe);
    const indexCols = cols === 3 ? 4 : cols;
    const times = (v, n) => (Array.isArray(v) ? v.map(x => x * n) : v * n);
    const per = (spec, n) => ({ ...spec, stories: kit.at(ctx, spec.stories) * n, pictures: times(spec.pictures ?? 0, n) });
    const { lead: [lead] = [], second, index } = kit.plan(data, ctx, {
      lead: REGIONS.lead,
      second: per(REGIONS.second, cols),
      index: per(REGIONS.index, indexCols),
    });
    // Liveblogs already in the lead or tier two stay out of the foot line;
    // layout() also skips those the index ends up showing.
    const above = new Set([lead, ...second].filter(Boolean).map(i => kit.storyKey(i.story)));
    const live = (data.live ?? []).filter(s => s.live && !above.has(kit.storyKey(s)));
    const leadSpan = cols <= 2 ? cols : Math.ceil(cols * 0.6);
    const colPx = (ctx.screen.width - 2 * ctx.safe.right) / cols;

    root.append(h('div', {
      class: 'hl-page kit-page',
      lang: ctx.lang,
      '--cols': String(cols),
      '--index-cols': String(indexCols),
      '--lead-span': String(leadSpan),
      '--summary-col': cols <= 2 ? '1 / -1' : `${leadSpan + 1} / span 1`,
      '--photo-height': String(kit.at(ctx, PHOTO_HEIGHT)),
    },
      masthead(data, ctx),
      lead ? leadStory(lead, ctx, { narrow: cols <= 2, photoPx: colPx }) : h('p', { class: 'hl-empty' }, ctx.t.noNews),
      second.length ? h('section', { class: 'hl-second' }, second.map(item => story(item, ctx, colPx))) : null,
      h('section', { class: 'hl-index' }, index.map(item => story(item, ctx))),
      live.length ? liveLine(live, ctx) : null,
    ));
  },

  // Runs again once web fonts land, so start from everything shown.
  layout(root, ctx) {
    const page = root.querySelector('.hl-page');
    if (!page) return;
    kit.reset(page);
    page.classList.remove('is-set');
    const lead = page.querySelector('.hl-lead');
    const title = lead?.querySelector('.hl-lead-title');
    const side = lead?.querySelector('.hl-lead-side');
    const text = lead?.querySelector('.hl-lead-text');
    const photo = lead?.querySelector('.hl-photo');
    const base = title ? parseFloat(getComputedStyle(title).fontSize) : 0;
    const index = page.querySelector('.hl-index');
    const items = [...index.children];
    const over = () => kit.overflows(index);
    const share = () => lead.offsetHeight > page.clientHeight * kit.at(ctx, LEAD_SHARE);
    // On two columns the photo stands beside the text: with none left, it goes.
    const alone = () => lead.classList.contains('is-narrow') && !photo.hidden && !text?.querySelector('p:not([hidden])');
    // Without the photo the lead's text has its room: it comes back, cut again.
    const dropPhoto = test => {
      kit.hide(photo);
      if (text) { kit.reset(text); kit.trimToFit(text, test, 8); }
    };
    // With neither photo nor summary the headline runs across; it then keeps
    // to the lead's share, else to the room beside the photo and summary.
    const bare = () => {
      if ((!photo || photo.hidden) && !text?.querySelector('p:not([hidden])')) kit.hide(side);
    };
    const room = () => (side.hidden ? !share() : title.offsetTop >= side.offsetTop);

    // An index headline longer than its clamp would end in "…": that story stays out.
    items.forEach(el => { if (clipped(el.querySelector('.hl-title'))) kit.hide(el); });

    // The lead keeps to its share of the page: its summary gives way.
    if (text) kit.trimToFit(text, share, 8);
    if (photo && alone()) dropPhoto(share);
    if (lead) bare();
    // The index keeps its first rows (one beside tier two's pictures).
    const thumbs = [...page.querySelectorAll('.hl-thumb')];
    const perRow = getComputedStyle(index).gridTemplateColumns.split(' ').length;
    const rows = thumbs.length ? 1 : kit.at(ctx, MIN_ROWS);
    const rest = items.filter(el => !el.hidden).slice(perRow * rows);
    rest.forEach(kit.hide);

    // The headline grows into that room, up to 1.3 times, before what is below
    // is fitted, so it is the summaries that make way for it; tier two's
    // pictures do not.
    if (title) growTitle(title, base, () => room() && !(thumbs.length && over()));

    // Then the summaries of tier two give way evenly, the lead's summary, tier
    // two's pictures (the summaries then cut again from their full length),
    // the lead's photo.
    const second = page.querySelector('.hl-second');
    const cut = () => {
      if (over() && second) kit.trimEvenly([...second.querySelectorAll('.hl-summary')], over, 10);
      if (!text || !over()) return;
      kit.trimToFit(text, () => share() || over(), 8);
      // When the grown headline holds the lead's height, cutting the summary
      // frees nothing and it all goes: the headline is back at its size and
      // the summary is cut again.
      if (title && (over() || !text.querySelector('p:not([hidden])'))) {
        kit.setStyle(title, 'font-size', `${base}px`);
        kit.reset(text);
        kit.trimToFit(text, () => share() || over(), 8);
      }
    };
    cut();
    if (over() && thumbs.length) {
      kit.reset(second);
      thumbs.forEach(kit.hide);
      if (text) kit.reset(text);
      cut();
    }
    if (photo && !photo.hidden && (over() || alone())) dropPhoto(() => share() || over());
    if (lead) bare();
    // Then it settles: as large as still fits beside them, the index its rows.
    if (title) growTitle(title, base, () => room() && !over());
    rest.forEach(kit.show);

    // As many rows as fit, full ones; the spare room then goes between tiers.
    kit.dropToFit(items, over);
    kit.fullRows(index, items);
    page.classList.add('is-set');

    const foot = page.querySelector('.hl-foot');
    if (foot) {
      const shown = new Set(items.filter(el => !el.hidden).map(el => el.dataset.key));
      if (!fitLine(foot.querySelector('.hl-foot-items'), shown)) kit.hide(foot);
    }
  },
};

// Narrow screens get two columns, a MacBook three (its index four), 16:9 four,
// ultrawide five, by the width the margin for the desktop files (safe.right)
// leaves.
function columnsFor({ width, height }, safe) {
  const ratio = (width - 2 * safe.right) / height;
  if (ratio < 1.3) return 2;
  if (ratio < 1.7) return 3;
  if (ratio < 2.1) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Blocks

function masthead(data, ctx) {
  const { h } = ctx;
  const updated = Date.parse(data.generatedAt);
  return h('header', { class: 'hl-masthead' },
    h('p', { class: 'hl-date' }, ctx.date(ctx.now, 'long')),
    h('h1', { class: 'hl-nameplate' }, ctx.t.nameplate),
    h('p', { class: 'hl-credit' },
      Number.isFinite(updated) ? h('span', null, `${ctx.t.updated} `, h('span', { class: 'hl-time' }, ctx.time(updated))) : null,
      h('span', null, `${ctx.t.source}: ${data.source?.name ?? 'VRT NWS'}`),
    ),
  );
}

// The photo heads the summary's column; on two columns it stands beside the
// summary, under the headline.
function leadStory(item, ctx, { narrow, photoPx }) {
  const { h } = ctx;
  const { story: s } = item;
  const title = kit.typo(s.title);
  const size = title.length > 115 ? ' is-long' : title.length < 60 ? ' is-short' : '';
  return h('section', { class: `hl-lead${size}${narrow ? ' is-narrow' : ''}` },
    kicker(s, ctx),
    headline(h, 'h2', 'hl-lead-title', title),
    h('div', { class: 'hl-lead-side' },
      item.picture ? kit.photo(ctx, item.picture, photoPx, { cls: 'hl-photo' }) : null,
      h('div', { class: 'hl-lead-text' },
        item.summary ? kit.prose(ctx, item.summary, 'hl-lead-summary') : null,
        item.points.map(p => kit.prose(ctx, p, 'hl-point')),
      ),
    ),
  );
}

function story(item, ctx, thumbPx) {
  const { h } = ctx;
  const { story: s } = item;
  return h('article', { class: 'hl-story', dataset: { key: kit.storyKey(s) } },
    item.picture ? kit.photo(ctx, item.picture, thumbPx, { cls: 'hl-thumb' }) : null,
    kicker(s, ctx),
    headline(h, 'h3', 'hl-title', kit.typo(s.title)),
    item.summary ? kit.prose(ctx, item.summary, 'hl-summary') : null,
  );
}

// LIVE · Nieuw · SECTION · 21u44
function kicker(s, ctx) {
  const { h } = ctx;
  return h('p', { class: 'hl-kicker' },
    s.live ? h('span', { class: 'hl-live' }, ctx.t.live) : null,
    s.kind === 'video' ? h('span', { class: 'hl-video' }, h('i', { class: 'hl-play' }), ctx.t.video) : null,
    ctx.fresh.has(s.id) ? h('span', { class: 'hl-new' }, ctx.t.new) : null,
    s.section ? h('span', { class: 'hl-section' }, s.section) : null,
    s.time ? h('span', { class: 'hl-time' }, stamp(s.time, ctx)) : null,
  );
}

// An opening quote hangs into the margin so the left edge stays straight.
function headline(h, tag, cls, text) {
  return h(tag, { class: `${cls}${/^[“‘]/.test(text) ? ' hangs' : ''}` }, text);
}

function liveLine(stories, ctx) {
  const { h } = ctx;
  return h('footer', { class: 'hl-foot' },
    h('span', { class: 'hl-live' }, ctx.t.live),
    h('p', { class: 'hl-foot-items' },
      stories.map(s => h('span', { class: 'hl-foot-item', dataset: { key: kit.storyKey(s) } },
        s.section ? h('b', null, s.section) : null,
        kit.typo(s.title),
      )),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fitting

// The lead's headline set as large as ok() allows, from its size in the
// stylesheet up to 1.3 times, keeping its lines.
function growTitle(title, base, ok) {
  kit.fitSize(title, base, base * 1.3, () => !clipped(title) && ok());
}

// Descenders overhang a little, so only a hidden half line or more counts.
function clipped(el) {
  return Boolean(el) && el.scrollHeight - el.clientHeight > parseFloat(getComputedStyle(el).lineHeight) / 2;
}

// Fills one line with the liveblogs not already on the page, in order,
// skipping any that would not fit. Returns how many it shows.
function fitLine(line, onPage) {
  const items = [...line.children];
  items.forEach(el => { el.hidden = true; el.classList.remove('is-squeezed'); });
  let shown = 0;
  for (const el of items.filter(el => !onPage.has(el.dataset.key))) {
    el.hidden = false;
    if (line.scrollWidth <= line.clientWidth) shown++;
    else if (shown) el.hidden = true;
    else {
      // A first liveblog that is too long on its own ends in an ellipsis.
      el.classList.add('is-squeezed');
      return 1;
    }
  }
  return shown;
}

// ---------------------------------------------------------------------------
// Text

// Today: 21u44. Yesterday: gisteren 21u44. Older: za 17 okt.
function stamp(ts, ctx) {
  const d = new Date(ts);
  const day = new Date(ctx.now);
  if (d.toDateString() === day.toDateString()) return ctx.time(ts);
  day.setDate(day.getDate() - 1);
  if (d.toDateString() === day.toDateString()) return `${ctx.t.yesterday} ${ctx.time(ts)}`;
  return ctx.date(ts, 'short');
}
