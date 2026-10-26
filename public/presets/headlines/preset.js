// Headlines: VRT NWS's front page set as ranked headlines, type only.
//
//   date ············ NAMEPLATE ············ Bijgewerkt 21u44 · Bron
//   ───────────────────────────────────────────────────────────────── fine rule
//   kicker
//   The lead, very large, over 2-3 columns         its summary
//   ─────────────────────────────────────────────────────────────────
//   second tier: one row of headlines with a short summary
//   third tier: headline-only index, as many rows as fit
//   ─────────────────────────────────────────────────────────────────
//   ● LIVE  the other running liveblogs, on one line
//
// The front page's order is kept: top[0] is the lead (the first liveblog picked
// on Customize, else VRT's own lead), then the tiers read left to right.
// Type scales with the screen's short side, so a wider screen simply holds
// more columns. layout() hides whole stories that do not fit, never half a line.

const NAMEPLATE = 'Het Nieuws';
const INDEX_ROWS = 4; // most rows the index renders before layout() trims it

export default {
  id: 'headlines',
  name: 'Headlines',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const cols = columnsFor(ctx.screen);
    const [lead, ...rest] = data.top ?? [];
    const second = rest.slice(0, cols);
    const indexCols = cols === 3 ? 4 : cols;
    const index = rest.slice(cols, cols + indexCols * INDEX_ROWS);
    // Liveblogs already in the lead or tier two stay out of the foot line;
    // layout() also hides those the index ends up showing.
    const above = new Set([lead, ...second].filter(Boolean).map(storyKey));
    const live = (data.live ?? []).filter(s => s.live && !above.has(storyKey(s)));
    const leadSpan = cols <= 2 ? cols : Math.ceil(cols * 0.6);

    root.append(h('div', {
      class: 'hl-page',
      lang: 'nl',
      '--cols': String(cols),
      '--index-cols': String(indexCols),
      '--lead-span': String(leadSpan),
      '--summary-col': cols <= 2 ? '1 / -1' : `${leadSpan + 1} / span 1`,
    },
      masthead(data, ctx),
      lead ? leadStory(lead, ctx) : h('p', { class: 'hl-empty' }, 'Geen nieuws beschikbaar.'),
      second.length ? h('section', { class: 'hl-second' }, second.map(s => story(s, ctx, true))) : null,
      h('section', { class: 'hl-index' }, index.map(s => story(s, ctx, false))),
      live.length ? liveLine(live, ctx) : null,
    ));
  },

  // Runs again once web fonts land, so start from everything shown.
  layout(root) {
    const page = root.querySelector('.hl-page');
    if (!page) return;
    const foot = page.querySelector('.hl-foot');
    page.classList.remove('is-set');
    if (foot) foot.hidden = false;
    const index = page.querySelector('.hl-index');
    fitRows(index);
    // The index now shrinks to its rows and the spare room goes between tiers.
    page.classList.add('is-set');
    if (foot) {
      const shown = new Set([...index.children].filter(el => !el.hidden).map(el => el.dataset.key));
      foot.hidden = !fitLine(foot.querySelector('.hl-foot-items'), shown);
    }
  },
};

// Narrow screens get two columns, a MacBook three (its index four), 16:9 four,
// ultrawide five.
function columnsFor({ width, height }) {
  const ratio = width / height;
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
    h('h1', { class: 'hl-nameplate' }, NAMEPLATE),
    h('p', { class: 'hl-credit' },
      Number.isFinite(updated) ? h('span', null, 'Bijgewerkt ', h('span', { class: 'hl-time' }, ctx.time(updated))) : null,
      h('span', null, 'Bron: VRT NWS'),
    ),
  );
}

function leadStory(s, ctx) {
  const { h } = ctx;
  const title = smarten(s.title);
  const size = title.length > 115 ? ' is-long' : title.length < 60 ? ' is-short' : '';
  return h('section', { class: `hl-lead${size}` },
    kicker(s, ctx),
    headline(h, 'h2', 'hl-lead-title', title),
    s.summary ? h('p', { class: 'hl-lead-summary' }, smarten(s.summary)) : null,
  );
}

function story(s, ctx, withSummary) {
  const { h } = ctx;
  return h('article', { class: 'hl-story', dataset: { key: storyKey(s) } },
    kicker(s, ctx),
    headline(h, 'h3', 'hl-title', smarten(s.title)),
    withSummary && s.summary ? h('p', { class: 'hl-summary' }, smarten(s.summary)) : null,
  );
}

// LIVE · Nieuw · SECTION · 21u44
function kicker(s, ctx) {
  const { h } = ctx;
  return h('p', { class: 'hl-kicker' },
    s.kind === 'liveblog' && s.live ? h('span', { class: 'hl-live' }, 'Live') : null,
    s.kind === 'video' ? h('span', { class: 'hl-video' }, h('i', { class: 'hl-play' }), 'Video') : null,
    ctx.fresh.has(s.id) ? h('span', { class: 'hl-new' }, 'Nieuw') : null,
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
    h('span', { class: 'hl-live' }, 'Live'),
    h('p', { class: 'hl-foot-items' },
      stories.map(s => h('span', { class: 'hl-foot-item', dataset: { key: storyKey(s) } },
        s.section ? h('b', null, s.section) : null,
        smarten(s.title),
      )),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fitting: hide whole stories from the end until the region fits.

function fitRows(region) {
  const items = [...region.children];
  items.forEach(el => { el.hidden = false; });
  // A headline longer than its clamp would end in "…": leave that story out.
  items.forEach(el => { el.hidden = clipped(el.querySelector('.hl-title')); });
  const shown = items.filter(el => !el.hidden);
  while (shown.length && region.scrollHeight > region.clientHeight) shown.pop().hidden = true;
  // Finish on a full row, so the index never ends in a ragged gap.
  const perRow = getComputedStyle(region).gridTemplateColumns.split(' ').length;
  while (shown.length > perRow && shown.length % perRow) shown.pop().hidden = true;
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

// A liveblog's URL slug follows its current headline, so the same blog can
// turn up in top[] and live[] under two ids; the ~number at the end is stable.
function storyKey(s) {
  return s.id?.match(/~(\d+)\/?$/)?.[1] ?? s.id;
}

// Today: 21u44. Yesterday: gisteren 21u44. Older: za 17 okt.
function stamp(ts, ctx) {
  const d = new Date(ts);
  const day = new Date(ctx.now);
  if (d.toDateString() === day.toDateString()) return ctx.time(ts);
  day.setDate(day.getDate() - 1);
  if (d.toDateString() === day.toDateString()) return `gisteren ${ctx.time(ts)}`;
  return ctx.date(ts, 'short');
}

// Typographic quotes and dashes.
function smarten(s) {
  return (s ?? '')
    .replace(/\s+-\s+/g, ' – ')
    .replace(/(^|[\s(\[–—])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[–—])'/g, '$1‘')
    .replace(/'/g, '’');
}
