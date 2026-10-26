// Newsprint: VRT NWS's front page set as a classic broadsheet on warm newsprint.
//
// Page anatomy (top to bottom):
//   masthead  left ear (the date), the nameplate, right ear (update time and
//             source), a thick-and-thin double rule
//   front     the lead across most columns: kicker, headline, then the standfirst
//             with a boxed "Nu live" panel beside a big photo; one secondary
//             story per remaining column (photo, headline, summary)
//   index     one row: each section with its newest headline
//   (blank)   bare paper at the bottom for the Dock, down the right edge for
//             the files on the desktop, and as much down the left to center it
//
// The number of columns comes from the screen (geometry()); type scales with
// cqmin. layout() shrinks the lead headline to three lines and gives each
// summary the lines its column has room for. Headlines are never cut short,
// and a summary gets two lines or none (a secondary's at most four).

const NAMEPLATE = 'Het Nieuws';

export default {
  id: 'newsprint',
  name: 'Newsprint',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const geo = geometry(ctx.screen, ctx.safe);
    // TEMP: the riots in Europe lead the page until this is taken out. Matched by
    // the liveblog's id, so the text is VRT's own.
    const riots = (data.live ?? []).find(s => s.id.includes('1792507723130'));
    const top = (data.top ?? []).filter(s => s.id !== riots?.id);
    const [lead, ...rest] = riots ? [riots, ...top] : top;
    const seconds = rest.slice(0, geo.seconds);
    const onFront = new Set([lead, ...seconds].filter(Boolean).map(s => s.id));
    const live = (data.live ?? []).filter(s => !onFront.has(s.id));

    root.setAttribute('lang', 'nl');
    root.append(h('div', {
      class: 'np-page',
      '--cols': geo.cols, '--lead': geo.lead, '--photo': geo.photo, '--side': geo.side,
      '--photo-h': `${geo.photoH}px`, '--mx': `${geo.mx}px`, '--gap': `${geo.gap}px`,
    },
      masthead(data, ctx),
      h('main', { class: 'np-body' },
        lead && leadStory(lead, live, geo, ctx),
        seconds.map(s => h('div', { class: 'np-second', 'data-fit': '' }, story(s, ctx, geo.colW)))),
      sectionIndex(data, geo, ctx)));
  },

  layout(root) {
    // Start from the rendered state, so a second pass (after web fonts load) can
    // bring back what the first one dropped.
    root.querySelectorAll('[hidden]').forEach(el => { el.hidden = false; });
    root.querySelectorAll('.np-hed, .np-dek, .np-standfirst, .np-photo').forEach(el => el.removeAttribute('style'));
    const lead = root.querySelector('.np-lead > .np-hed');
    if (lead) sizeToFit(lead, 3, 0.7, 1.15);
    // Secondaries side by side share one size: the smallest any of them needs.
    const seconds = [...root.querySelectorAll('.np-second .np-hed')];
    seconds.forEach(el => sizeToFit(el, 4, 0.75, 1));
    const size = Math.min(...seconds.map(el => parseFloat(el.style.fontSize)));
    seconds.forEach(el => { el.style.fontSize = `${size}px`; });
    root.querySelectorAll('[data-fit]').forEach(fit);
    // Their photos line up too: all as tall as the shortest.
    const photos = [...root.querySelectorAll('.np-second .np-photo:not([hidden])')];
    const height = Math.min(...photos.map(el => el.offsetHeight));
    photos.forEach(el => { el.style.flex = `0 0 ${height}px`; });
    // Chrome can keep the ellipsis of an earlier, shorter clamp: rebuild the boxes.
    const page = root.querySelector('.np-page');
    page.style.display = 'none';
    void page.offsetHeight;
    page.style.removeProperty('display');
  },
};

// --- geometry ---------------------------------------------------------------

// Columns of about 19 ems of body text: 5 on a MacBook, 6 at 2560, 8 on an
// ultrawide, counted on the width left of the desktop files (safe.right). The
// page is centered, with as much paper on the left, which only narrows them.
function geometry({ width, height }, safe) {
  const unit = Math.min(width, height) / 100;
  const text = Math.min(22, Math.max(12.5, 1.45 * unit));
  const cols = Math.max(4, Math.min(8, Math.floor((width - safe.right) / (text * 19.5))));
  const seconds = cols >= 8 ? 3 : 2;
  const lead = cols - seconds;
  const photo = Math.min(lead - 1, 3);
  const mx = Math.round(Math.max(24, width * 0.022));
  const gap = Math.round(Math.max(16, 1.9 * unit));
  const colW = (width - 2 * (safe.right + mx) - (cols - 1) * gap) / cols;
  const photoH = Math.round(Math.min((photo * (colW + gap) - gap) * 9 / 16, height * 0.4));
  return { cols, seconds, lead, photo, photoH, side: lead - photo, mx, gap, colW };
}

// --- masthead ---------------------------------------------------------------

function masthead(data, ctx) {
  const { h } = ctx;
  const [weekday, ...day] = ctx.date(ctx.now, 'long').split(' ');
  const updated = Date.parse(data.generatedAt);
  return h('header', { class: 'np-masthead' },
    h('div', { class: 'np-ear' },
      h('b', null, weekday),
      h('span', null, day.join(' '))),
    h('h1', { class: 'np-nameplate' }, NAMEPLATE),
    h('div', { class: 'np-ear np-ear-right' },
      h('b', null, Number.isNaN(updated) ? 'Laatste nieuws'
        : ['Bijgewerkt ', h('span', { class: 'np-time' }, ctx.time(updated))]),
      h('span', null, 'Bron: VRT NWS')),
    h('div', { class: 'np-rule' }));
}

// --- stories ----------------------------------------------------------------

function leadStory(s, live, geo, ctx) {
  const { h } = ctx;
  return h('article', { class: 'np-lead' },
    kicker(s, ctx),
    h('h2', { class: 'np-hed' }, s.title),
    h('div', { class: 'np-lead-body' },
      h('div', { class: 'np-side', 'data-fit': '' },
        s.summary && h('p', { class: 'np-standfirst np-fill' }, s.summary),
        live.length > 0 && livePanel(live, ctx)),
      photo(s.image, geo.photo * (geo.colW + geo.gap), ctx)));
}

function story(s, ctx, photoWidth = 0) {
  const { h } = ctx;
  return h('article', { class: 'np-story np-drop' },
    photoWidth > 0 && photo(s.image, photoWidth, ctx),
    kicker(s, ctx),
    h('h3', { class: 'np-hed' }, s.title),
    s.summary && h('p', { class: 'np-dek' }, s.summary));
}

function photo(image, cssWidth, ctx) {
  if (!image?.url) return null;
  return ctx.h('figure', { class: 'np-photo' },
    ctx.h('img', { src: ctx.image(image, cssWidth), alt: image.alt || '', decoding: 'async' }));
}

// Section label with the small marks: LIVE, a play mark for video, "Nieuw".
function kicker(s, ctx, label = s.section) {
  const { h } = ctx;
  return h('p', { class: 'np-kicker' },
    s.kind === 'liveblog' && s.live && h('span', { class: 'np-tag-live' }, 'Live'),
    s.kind === 'video' && h('span', { class: 'np-tag-video', title: 'Video' }),
    label && h('span', null, label),
    ctx.fresh?.has(s.id) && h('span', { class: 'np-tag-new' }, 'Nieuw'),
    ' ');
}

function livePanel(live, ctx) {
  const { h } = ctx;
  return h('section', { class: 'np-live' },
    h('h4', { class: 'np-live-head' }, 'Nu live'),
    h('ul', null, live.map(s => h('li', { class: 'np-drop' },
      h('p', { class: 'np-live-title' }, s.title),
      h('p', { class: 'np-live-meta' },
        h('span', { class: 'np-tag-live' }, 'Live'),
        s.postCount ? ` · ${s.postCount} berichten` : '')))));
}

// --- section index ----------------------------------------------------------

// One row, a section per column, in VRT's section order. When sections are
// missing (an upstream failed) the latest news fills the row; a leftover
// column gets the colophon, so the row never ends in a hole.
function sectionIndex(data, geo, ctx) {
  const { h } = ctx;
  const used = new Set([...(data.live ?? []), ...(data.top ?? [])].map(s => s.id));
  const entry = (s, label) => {
    used.add(s.id);
    return h('div', { class: 'np-entry' }, kicker(s, ctx, label), h('p', { class: 'np-entry-hed' }, s.title));
  };
  const entries = (data.sections ?? []).map(sec => {
    const s = sec.stories?.find(st => !used.has(st.id)) ?? sec.stories?.[0];
    return s && entry(s, sec.name);
  }).filter(Boolean).slice(0, geo.cols);
  for (const s of data.latest ?? []) {
    if (entries.length >= geo.cols - 1) break;
    if (!used.has(s.id)) entries.push(entry(s));
  }
  if (entries.length < geo.cols) {
    entries.push(h('div', { class: 'np-entry np-colophon' },
      h('p', { class: 'np-colophon-name' }, NAMEPLATE),
      h('p', null, 'Een bureaubladkrant met het nieuws van VRT NWS')));
  }
  return h('footer', { class: 'np-index' }, entries);
}

// --- fitting ----------------------------------------------------------------

function overflows(el) { return el.scrollHeight > el.clientHeight + 1; }

// Lines of text in an element, clamped ones included.
const lineCount = el => Math.round(el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight));

// Shrink a headline until it takes `lines` lines (down to `min` times its
// size), or grow it (up to `max` times) as long as it needs no extra line.
function sizeToFit(el, lines, min, max) {
  const base = parseFloat(getComputedStyle(el).fontSize);
  const set = f => { el.style.fontSize = `${base * f}px`; };
  let f = 1;
  while (lineCount(el) > lines && f > min) set(f *= 0.95);
  if (f < 1) return;
  const start = lineCount(el);
  while (f * 1.05 <= max) {
    set(f * 1.05);
    if (lineCount(el) > start) break;
    f *= 1.05;
  }
  set(f);
}

// Drop whole items from the end of a region until it fits, then give the
// region's flexible text (the standfirst, or the last summary) the lines left.
// If a headline still does not fit, a secondary gives up its photo, then
// stories leave from the end; a live panel with no rows left goes too.
function fit(region) {
  const over = () => overflows(region);
  const drops = [...region.querySelectorAll('.np-drop')];
  while (over() && drops.length > 1) drops.pop().hidden = true;
  fillLines(region, over);
  const photo = region.querySelector('.np-photo');
  if (over() && photo) {
    photo.hidden = true;
    fillLines(region, over);
  }
  while (over() && drops.length) drops.pop().hidden = true;
  for (const live of region.querySelectorAll('.np-live')) {
    if (!live.querySelector('li:not([hidden])')) live.hidden = true;
  }
}

// Two lines or none: a summary is never cut to one. A secondary's summary
// stops at four, so the columns do not turn into a wall of text.
function fillLines(region, over) {
  const el = region.querySelector('.np-fill')
    ?? [...region.querySelectorAll('.np-dek')].filter(d => !d.parentElement.closest('[hidden]')).at(-1);
  if (!el) return;
  el.hidden = false;
  const max = el.classList.contains('np-dek') ? 4 : 24;
  for (let n = 1; n <= max; n++) {
    el.style.webkitLineClamp = n;
    if (over()) {
      if (n <= 2) el.hidden = true;
      else el.style.webkitLineClamp = n - 1;
      return;
    }
    if (!overflows(el)) return;
  }
}
