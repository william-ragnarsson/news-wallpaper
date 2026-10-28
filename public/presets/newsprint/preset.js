// Newsprint: the provider's front page as a classic broadsheet, set like the
// Broadsheet liveblog design: one big lead, its text in columns, one photo.
//
// Page anatomy (top to bottom):
//   masthead  the date in the left ear, the nameplate, the update time in the
//             right ear; a dateline under a heavy rule
//   body      the lead across most columns: kicker, headline, then its summary
//             opening the text columns with a drop cap, and the next top
//             stories as briefs after it. A photo column beside the text: the
//             picture, and one more story in a box under it. A rail on the
//             right with the latest news.
//   index     one row: each picked section with its newest headline (two where
//             a section's share of the row has room for them)
//   (blank)   bare paper at the bottom for the Dock, down the right edge for
//             the files on the desktop, and as much down the left to center it
//
// The number of columns comes from the screen (geometry()); type scales with
// cqmin. layout() fits the headline to three lines, sizes the photo, and lets
// the briefs and the rail drop whole stories from the end, the first one left
// out coming back trimmed to the words that fit.
//
// Settings: ctx.pictures says how many photos ('none': text only; 'one': the
// photo column; 'several': small photos on briefs too), ctx.color whether they
// are printed in color or in black and white. A story with `live: true` gets a
// red LIVE tag.

export default {
  id: 'newsprint',
  name: 'Newsprint',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const pictures = ctx.pictures ?? 'one';
    // top[] leads with the outlet's live stories when liveFirst is on, then the
    // outlet's own order.
    const [lead, ...rest] = (data.top ?? []).filter(s => s?.title);
    // The photo is the lead's, else that of one of the next stories, which then
    // sits in the box under it. The Washington Post's feeds have none.
    const photoStory = pictures === 'none' ? null : [lead, ...rest.slice(0, 4)].find(s => usable(s?.image));
    const boxStory = !photoStory ? null : photoStory !== lead ? photoStory : rest[0] ?? null;
    const briefs = rest.filter(s => s !== boxStory).slice(0, 10);
    const geo = geometry(ctx.screen, ctx.safe, !!photoStory);
    const briefImages = pictures === 'several' ? pickBriefImages(briefs, photoStory, geo) : new Set();

    const used = new Set([lead, boxStory, ...briefs].filter(Boolean).map(storyKey));
    const index = sectionIndex(data, used, geo, ctx);
    const rail = latestRail(data, used, geo, ctx);

    root.setAttribute('lang', ctx.lang);
    root.append(
      h('div', { class: 'np-paper', 'aria-hidden': 'true' }),
      h('div', {
        class: `np-page${ctx.color ? ' is-color' : ''}`,
        '--cols': geo.cols, '--lead-cols': geo.lead, '--rail-cols': geo.rail,
        '--photo-cols': geo.photo, '--flow-cols': geo.lead - geo.photo,
      },
        masthead(data, ctx),
        h('main', { class: 'np-body' },
          lead ? leadPackage(lead, briefs, boxStory, photoStory, briefImages, geo, ctx)
            : h('p', { class: 'np-empty' }, ctx.t.noNews),
          rail),
        index));
  },

  layout(root, ctx) {
    const page = root.querySelector('.np-page');
    if (!page) return;
    // From the rendered state each time, so the pass after web fonts load can
    // bring back what the first one dropped.
    reset(page);
    fitNameplate(page);
    fitHeadline(page, ctx);
    fitPhotoColumn(page);
    fitFlow(page);
    fitRail(page);
    justifyFlow(page);
    justifyRail(page);
  },
};

// --- geometry ---------------------------------------------------------------

// Columns of about 33 characters, as many as fit between the margins for the
// desktop files (safe.right), kept on both sides so the page stays centered:
// 5 on a MacBook, 6 at 2560, 8 on an ultrawide. The rail takes one, two from 8.
function geometry({ width, height }, safe, photo) {
  const u = Math.min(width, height) / 100; // 1cqmin
  const mx = Math.max(28, 2.4 * u + 0.011 * width);
  const gap = 2.2 * u;
  const inner = width - 2 * (mx + safe.right);
  const cols = Math.max(4, Math.min(11, Math.floor((inner + gap) / (22 * u + gap))));
  const rail = cols >= 8 ? 2 : 1;
  const lead = cols - rail;
  return { cols, rail, lead, photo: photo ? Math.round(lead * 0.42) : 0, u, gap, inner, colW: (inner - (cols - 1) * gap) / cols };
}

// --- masthead ---------------------------------------------------------------

function masthead(data, ctx) {
  const { h } = ctx;
  const now = ctx.now.getTime();
  // "dinsdag 27 oktober 2026", "Tuesday, October 27, 2026"
  const long = ctx.date(ctx.now, 'long');
  const weekday = long.split(' ')[0].replace(/,$/, '');
  const year = long.match(/\d{4}/)?.[0] ?? '';
  const updated = Date.parse(data.generatedAt);
  const source = data.source?.name ?? 'VRT NWS';
  return h('header', { class: 'np-mast' },
    h('div', { class: 'np-flagrow' },
      h('div', { class: 'np-ear' },
        h('span', { class: 'np-ear-label' }, weekday),
        h('span', { class: 'np-ear-main' }, ctx.date(ctx.now, 'daymonth')),
        h('span', { class: 'np-ear-sub' }, year)),
      h('h1', { class: 'np-nameplate' }, h('span', null, ctx.t.nameplate)),
      h('div', { class: 'np-ear np-ear-right' },
        h('span', { class: 'np-ear-label' }, ctx.t.updated),
        h('span', { class: 'np-ear-main' }, Number.isNaN(updated) ? '–' : ctx.time(updated)),
        h('span', { class: 'np-ear-sub' }, Number.isNaN(updated) ? '' : cap(ctx.ago(updated, now))))),
    h('div', { class: 'np-dateline' },
      h('span', { class: 'np-dateline-side' }, ctx.t.colophon(source)),
      h('span', { class: 'np-dateline-mid' }, ctx.t.frontPage),
      h('span', { class: 'np-dateline-side np-source' }, `${ctx.t.source}: ${source}`)));
}

// --- lead package -----------------------------------------------------------

function leadPackage(lead, briefs, boxStory, photoStory, briefImages, geo, ctx) {
  const { h } = ctx;
  const headline = typo(lead.title);
  // The box's story waits, hidden, at the head of the briefs: it takes its
  // place there if the box finds no room under the photo.
  const dup = boxStory && photoStory ? brief(boxStory, ctx, false, true) : null;
  const flow = h('div', { class: 'np-flow' },
    lead.summary ? h('div', { class: 'np-leadtext' }, para(lead.summary, 'np-opener')) : null,
    briefs.length || dup ? h('h4', { class: 'np-flow-head' }, h('span', null, ctx.t.moreNews)) : null,
    dup,
    briefs.map(s => brief(s, ctx, briefImages.has(s.id))));
  return h('article', { class: `np-lead${photoStory ? '' : ' no-photo'}` },
    kicker(lead, ctx, true),
    h('h2', { class: 'np-headline', dataset: { len: headline.length } }, headline),
    flow,
    photoStory ? photoColumn(photoStory, photoStory === lead ? boxStory : photoStory, geo, ctx) : null);
}

// An earlier story in the columns: headline, then its summary after a run-in
// dateline (section and time). A picture sits above the headline, the two in
// one block so a column break never comes between them.
function brief(s, ctx, withImage, dup = false) {
  const { h } = ctx;
  const dateline = h('b', { class: 'np-dl' }, `${[s.section, when(s, ctx)].filter(Boolean).join(' · ')} — `);
  const title = h('h3', { class: 'np-brief-title' }, liveTag(s, ctx), newTag(s, ctx), typo(s.title));
  const el = h('article', { class: 'np-brief', dataset: { drop: 'brief', ...(dup && { dup: '' }) } },
    withImage ? h('div', { class: 'np-brief-head' },
      h('figure', { class: 'np-brief-fig' },
        h('div', { class: 'np-imgwrap' }, h('img', { src: ctx.image(s.image, 420), alt: s.image.alt || '', decoding: 'async' })),
        creditFor(s.image) ? h('figcaption', null, h('span', { class: 'np-credit' }, creditFor(s.image))) : null),
      title) : title,
    s.summary ? para(s.summary, 'np-first', dateline) : h('p', { class: 'np-first' }, dateline));
  if (dup) el.hidden = true;
  return el;
}

// A paragraph. The text sits in its own span so layout() can trim it and put it
// back without touching the run-in dateline.
function para(text, cls, runIn) {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  if (runIn) p.append(runIn);
  const t = document.createElement('span');
  t.className = 'np-t';
  t.textContent = typo(text);
  p.append(t);
  return p;
}

function photoColumn(s, box, geo, ctx) {
  const { h } = ctx;
  const img = s.image;
  const caption = captionFor(img);
  const credit = creditFor(img);
  return h('div', { class: 'np-photocol' },
    h('figure', { class: 'np-figure' },
      h('div', { class: 'np-imgwrap' },
        h('img', { src: ctx.image(img, Math.round(geo.photo * geo.colW * 1.1)), alt: img.alt || '', decoding: 'async' })),
      caption || credit ? h('figcaption', null,
        caption ? h('span', { class: 'np-cap' }, caption) : null,
        credit ? h('span', { class: 'np-credit' }, credit) : null) : null),
    box ? h('section', { class: 'np-box' },
      kicker(box, ctx, true),
      h('h3', { class: 'np-box-title' }, typo(box.title)),
      box.summary ? para(box.summary, 'np-box-text') : null) : null);
}

// Section label with the small marks: a red LIVE tag, the time, "Nieuw".
function kicker(s, ctx, withTime = false) {
  const { h } = ctx;
  const now = ctx.now.getTime();
  const today = s.time && sameDay(s.time, now);
  return h('p', { class: 'np-kicker' },
    liveTag(s, ctx),
    s.section ? h('span', { class: 'np-kicker-tag' }, s.section) : null,
    withTime && today ? h('span', { class: 'np-kicker-time' }, ctx.time(s.time)) : null,
    withTime && s.time ? h('span', null, ctx.ago(s.time, now)) : null,
    newTag(s, ctx));
}

function liveTag(s, ctx) {
  return s.live === true ? ctx.h('span', { class: 'np-live' }, ctx.t.live) : null;
}

function newTag(s, ctx) {
  return ctx.fresh?.has(s.id) ? ctx.h('span', { class: 'np-new' }, ctx.t.new) : null;
}

// The time today, the day before that.
function when(s, ctx) {
  if (!s.time) return null;
  return sameDay(s.time, ctx.now.getTime()) ? ctx.time(s.time) : ctx.ago(s.time, ctx.now.getTime());
}

// --- rail -------------------------------------------------------------------

// The latest news that is not on the page already, newest first.
function latestRail(data, used, geo, ctx) {
  const { h } = ctx;
  const items = (data.latest ?? []).filter(s => s?.title && !used.has(storyKey(s))).slice(0, 14);
  if (!items.length) return null;
  items.forEach(s => used.add(storyKey(s)));
  return h('aside', { class: 'np-rail' },
    h('div', { class: 'np-rail-flow' },
      h('section', { class: 'np-rail-sec' },
        h('h4', { class: 'np-rail-head' }, h('span', null, ctx.t.latest)),
        items.map(s => h('article', { class: 'np-other', dataset: { drop: 'other' } },
          h('p', { class: 'np-other-topic' }, liveTag(s, ctx), s.section ? h('span', null, s.section) : null),
          h('h5', { class: 'np-other-title' }, newTag(s, ctx), typo(s.title)),
          when(s, ctx) ? h('p', { class: 'np-other-meta' }, when(s, ctx)) : null)))));
}

// --- section index ----------------------------------------------------------

// One row, the picked sections in order, each with its newest headline that is
// not on the page yet. Where a section's share of the row is as wide as two
// body columns (few sections, a wide screen) it shows two. With no sections
// the latest news fills the row.
function sectionIndex(data, used, geo, ctx) {
  const { h } = ctx;
  const secs = (data.sections ?? []).filter(sec => sec.stories?.length).slice(0, geo.cols + 1);
  const n = secs.length || geo.cols;
  const per = (geo.inner - (n - 1) * geo.gap) / n >= 2 * geo.colW + geo.gap ? 2 : 1;
  const pick = (stories, k) => {
    const out = stories.filter(s => s?.title && !used.has(storyKey(s))).slice(0, k);
    if (!out.length && stories[0]) out.push(stories[0]);
    out.forEach(s => used.add(storyKey(s)));
    return out;
  };
  const item = s => h('article', { class: 'np-entry-item' },
    h('h5', { class: 'np-entry-hed' }, liveTag(s, ctx), newTag(s, ctx), typo(s.title)),
    when(s, ctx) ? h('p', { class: 'np-entry-meta' }, when(s, ctx)) : null);
  const entries = secs.length
    ? secs.map(sec => h('section', { class: 'np-entry' },
      h('p', { class: 'np-entry-label' }, sec.name),
      h('div', { class: 'np-entry-items' }, pick(sec.stories, per).map(item))))
    : pick(data.latest ?? [], geo.cols).map(s => h('section', { class: 'np-entry' },
      h('p', { class: 'np-entry-label' }, s.section ?? ctx.t.latest),
      h('div', { class: 'np-entry-items' }, item(s))));
  if (!entries.length) return null;
  return h('footer', { class: 'np-index', '--n': entries.length, '--per': per }, entries);
}

// A liveblog's URL slug follows its headline, so the same blog can come in
// under two ids; the ~number at the end stays.
function storyKey(s) {
  return s.id?.match(/~(\d+)\/?$/)?.[1] ?? s.id;
}

// --- layout: fit and fill ---------------------------------------------------

function reset(page) {
  page.querySelectorAll('[data-hidden]').forEach(el => { el.hidden = false; delete el.dataset.hidden; });
  page.querySelectorAll('[data-dup]').forEach(el => { el.hidden = true; });
  page.querySelectorAll('[data-full]').forEach(el => { el.textContent = el.dataset.full; delete el.dataset.full; });
  page.querySelectorAll('[data-trimmed]').forEach(el => delete el.dataset.trimmed);
  page.querySelectorAll('.np-nameplate, .np-headline').forEach(el => el.style.removeProperty('font-size'));
  page.querySelectorAll('.np-imgwrap').forEach(el => el.style.removeProperty('height'));
  page.querySelectorAll('[data-vj]').forEach(el => {
    ['margin-top', 'padding-top', 'padding-bottom'].forEach(k => el.style.removeProperty(k));
    delete el.dataset.vj;
  });
}

function hide(el) {
  el.hidden = true;
  el.dataset.hidden = '';
}

// The nameplate steps down to fit between the ears.
function fitNameplate(page) {
  const plate = page.querySelector('.np-nameplate');
  const span = plate?.firstElementChild;
  if (!span) return;
  const max = parseFloat(getComputedStyle(plate).fontSize);
  const w = span.getBoundingClientRect().width;
  if (w > plate.clientWidth) plate.style.fontSize = `${Math.max(max * 0.5, max * plate.clientWidth / w * 0.98)}px`;
}

// The largest size at which the headline takes at most three lines and about a
// third of the lead's height. Short headlines may run very large.
function fitHeadline(page, ctx) {
  const el = page.querySelector('.np-headline');
  const lead = page.querySelector('.np-lead');
  if (!el || !lead) return;
  const u = Math.min(ctx.screen.width, ctx.screen.height) / 100;
  const len = Number(el.dataset.len) || 80;
  const wide = Math.min(1.3, Math.max(1, Math.sqrt(ctx.screen.width / ctx.screen.height / 1.6)));
  const hi = (len < 45 ? 8.6 * u : len < 80 ? 7.4 * u : 6.4 * u) * wide;
  const lo = 3.2 * u;
  const budget = lead.clientHeight * 0.34;
  const fits = size => {
    el.style.fontSize = `${size}px`;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.04;
    const height = el.getBoundingClientRect().height;
    return Math.round(height / lh) <= 3 && height <= budget;
  };
  if (fits(hi)) return;
  let a = lo, b = hi;
  for (let i = 0; i < 10; i++) {
    const m = (a + b) / 2;
    if (fits(m)) a = m; else b = m;
  }
  el.style.fontSize = `${a}px`;
}

// The photo column: the picture at 3:2, cropped at most a little, and the box
// under it with what is left. The box's text gives way by words first; a box
// that still does not fit goes, and its story joins the briefs. Alone, the
// picture may be cropped taller to fill its column.
function fitPhotoColumn(page) {
  const col = page.querySelector('.np-photocol');
  if (!col) return;
  const wrap = col.querySelector('.np-imgwrap');
  const fig = col.querySelector('.np-figure');
  const box = col.querySelector('.np-box');
  const w = wrap.clientWidth;
  const H = col.clientHeight;
  const capH = fig.getBoundingClientRect().height - wrap.getBoundingClientRect().height;
  const natural = w / 1.5;
  const over = () => col.scrollHeight > col.clientHeight + 1;
  let imgH = Math.min(natural, H - capH);
  wrap.style.height = `${imgH}px`;

  if (box) {
    if (over()) {
      const need = col.scrollHeight - col.clientHeight;
      if (imgH - need >= natural * 0.82) {
        imgH -= need;
        wrap.style.height = `${imgH}px`;
      } else {
        imgH = Math.max(natural * 0.82, Math.min(natural, H - capH) * 0.82);
        wrap.style.height = `${imgH}px`;
        const text = box.querySelector('.np-box-text');
        if (text && over() && !trimTo(box, over, 12)) hide(text);
        if (over()) hide(box);
      }
    }
    if (!box.hidden) {
      // The picture grows into any room left under the box.
      const slack = H - fig.getBoundingClientRect().height - box.getBoundingClientRect().height - gapOf(col);
      if (slack > 0) wrap.style.height = `${Math.min(w / 1.05, imgH + slack)}px`;
      return;
    }
    const dup = page.querySelector('.np-flow [data-dup]');
    if (dup) dup.hidden = false;
  }
  wrap.style.height = `${Math.max(Math.min(natural, H - capH), Math.min(H - capH, w / 0.9))}px`;
}

function gapOf(el) {
  return parseFloat(getComputedStyle(el).rowGap) || 0;
}

// Columns: drop whole briefs from the end, then re-admit the dropped ones in
// turn (dropBriefs), so the last column ends on a full line.
// A head left alone at the foot of a column, its first story in the next, goes,
// and so does a brief's picture that, with its headline, did not fit at the
// foot of a column and left a hole there; the columns are fitted again without.
function fitFlow(page) {
  const flow = page.querySelector('.np-flow');
  if (!flow) return;
  const head = flow.querySelector('.np-flow-head');
  const out = [];
  for (;;) {
    dropBriefs(flow);
    const first = [...flow.querySelectorAll('.np-brief')].find(el => !el.hidden);
    const lonely = head && !head.hidden && first
      && Math.abs(head.getBoundingClientRect().left - first.getBoundingClientRect().left) >= 2;
    const drop = lonely ? head : pictureAfterHole(flow);
    if (!drop) return;
    flow.querySelectorAll('[data-hidden]').forEach(el => { el.hidden = false; delete el.dataset.hidden; });
    flow.querySelectorAll('[data-full]').forEach(el => { el.textContent = el.dataset.full; delete el.dataset.full; });
    flow.querySelectorAll('[data-trimmed]').forEach(el => delete el.dataset.trimmed);
    out.push(drop);
    out.forEach(hide);
  }
}

// A brief's picture that opens a column (under the brief's rule at most) after
// one that ends lines early.
function pictureAfterHole(flow) {
  const { r, colAt, ends, line, bottom } = columnsOf(flow);
  const end = ends();
  return [...flow.querySelectorAll('.np-brief:not([hidden]) .np-brief-fig:not([hidden])')].find(fig => {
    const q = fig.getClientRects()[0];
    const c = q ? colAt(q.left) : 0;
    return c > 0 && q.top < r.top + line * 2 && bottom - end[c - 1] > line * 3;
  });
}

function dropBriefs(flow) {
  const over = () => flow.scrollWidth > flow.clientWidth + 2;
  const head = flow.querySelector('.np-flow-head');
  const briefs = [...flow.querySelectorAll('[data-drop="brief"]')].filter(el => !el.hidden);
  if (over()) {
    let i = briefs.length - 1;
    while (i >= 0 && over()) hide(briefs[i--]);
    // Then each dropped one in turn comes back if it fits: whole, without its
    // picture, or trimmed by words.
    for (const b of briefs.slice(i + 1)) {
      if (over()) break;
      b.hidden = false;
      delete b.dataset.hidden;
      if (!over()) continue;
      const fig = b.querySelector('.np-brief-fig:not([hidden])');
      if (fig) hide(fig);
      if (over() && !trimTo(b, over, 8)) {
        if (fig) { fig.hidden = false; delete fig.dataset.hidden; }
        hide(b);
      }
    }
    // Even the lead's own text is too long: trim it.
    const lead = flow.querySelector('.np-leadtext');
    if (over() && lead) trimTo(lead, over, 6);
  }
  if (head && !briefs.some(b => !b.hidden)) hide(head);
}

// Trim the text of a container's last paragraph(s) word by word until `over`
// is false. Returns false if not even `minWords` fit.
function trimTo(container, over, minWords) {
  const paras = [...container.querySelectorAll('p')].filter(p => !p.hidden && p.querySelector('.np-t'));
  while (paras.length) {
    const p = paras.at(-1);
    const span = p.querySelector('.np-t');
    const full = span.dataset.full ?? span.textContent;
    span.dataset.full = full;
    const words = full.split(/\s+/);
    let lo = 0, hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      span.textContent = cut(words, mid);
      if (over()) hi = mid - 1; else lo = mid;
    }
    if (lo >= Math.min(minWords, words.length) && lo > 0) {
      span.textContent = cut(words, lo);
      if (lo < words.length) p.dataset.trimmed = '';
      return !over();
    }
    span.textContent = full;
    hide(p);
    paras.pop();
    if (!over()) return paras.length > 0;
  }
  return false;
}

function cut(words, n) {
  if (n >= words.length) return words.join(' ');
  return words.slice(0, n).join(' ').replace(/[,;:–—-]+$/, '') + ' …';
}

function fitRail(page) {
  const col = page.querySelector('.np-rail-flow');
  if (!col) return;
  const over = () => col.scrollWidth > col.clientWidth + 2 || col.scrollHeight > col.clientHeight + 1;
  const items = [...col.querySelectorAll('[data-drop="other"]')];
  while (over() && items.length) hide(items.pop());
}

// Vertical justification. A column that ends early, because the next item
// would not fit, gets the spare space spread over its separators, as a
// compositor would, so the column bottoms line up. Nothing moves between
// columns; if anything would, the column is left as it was.
function justifyFlow(page) {
  const flow = page.querySelector('.np-flow');
  if (!flow) return;
  justifyColumns(flow, () => {
    const units = [];
    const head = flow.querySelector('.np-flow-head');
    if (head && !head.hidden) units.push({ el: head, apply: e => grow(head, 'margin-top', e) });
    flow.querySelectorAll('.np-brief').forEach(el => {
      if (el.hidden || el === flow.querySelector('.np-brief:not([hidden])')) return;
      units.push({ el, apply: e => { grow(el, 'margin-top', e / 2); grow(el, 'padding-top', e / 2); } });
    });
    return units;
  });
}

function justifyRail(page) {
  const box = page.querySelector('.np-rail-flow');
  if (!box) return;
  justifyColumns(box, () => {
    const items = [...box.querySelectorAll('[data-drop]')].filter(el => !el.hidden);
    return items.slice(1).map((el, k) => ({
      el, apply: e => { grow(items[k], 'padding-bottom', e / 2); grow(el, 'padding-top', e / 2); },
    }));
  }, true);
}

function grow(el, prop, by) {
  const now = parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
  el.style.setProperty(prop, `${now + by}px`);
  el.dataset.vj = '';
}

// Where each column's text ends, for a multicol box.
function columnsOf(box) {
  const cs = getComputedStyle(box);
  const n = parseInt(cs.columnCount, 10) || 1;
  const gap = parseFloat(cs.columnGap) || 0;
  const r = box.getBoundingClientRect();
  const colW = (box.clientWidth - (n - 1) * gap) / n;
  const colAt = x => Math.max(0, Math.min(n - 1, Math.floor((x - r.left + gap / 2) / (colW + gap))));
  const ends = () => {
    const out = new Array(n).fill(-Infinity);
    const range = document.createRange();
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const take = q => { if (q.width && q.height) { const c = colAt(q.left); out[c] = Math.max(out[c], q.bottom); } };
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim()) continue;
      range.selectNodeContents(t);
      for (const q of range.getClientRects()) take(q);
    }
    box.querySelectorAll('.np-imgwrap').forEach(el => { for (const q of el.getClientRects()) take(q); });
    return out;
  };
  const line = parseFloat(getComputedStyle(box.querySelector('p') || box).lineHeight) || 20;
  return { r, colAt, ends, line, bottom: r.top + box.clientHeight };
}

function justifyColumns(box, unitsFor, withLast = false) {
  const { r, colAt, ends, line, bottom } = columnsOf(box);
  let before = ends();
  const last = before.findLastIndex(v => v > -Infinity);
  const width = box.scrollWidth;
  for (let c = 0; c < last + (withLast ? 1 : 0); c++) {
    const slack = bottom - before[c] - 3;
    if (slack < line * (c === last ? 0.8 : 1.4)) continue;
    const here = unitsFor().filter(u => {
      const q = u.el.getClientRects()[0];
      return q && colAt(q.left) === c && q.top > r.top + 2;
    });
    if (!here.length) continue;
    // One separator alone may not open a hole; it takes a line or so.
    const most = c === last ? 0.9 : here.length > 1 ? 2.6 : 1.2;
    const full = Math.min(slack / here.length, line * most);
    for (const f of [1, 0.75, 0.5, 0.25]) {
      const e = full * f;
      here.forEach(u => u.apply(e));
      const after = ends();
      const moved = box.scrollWidth > width + 1
        || after.some((v, k) => k !== c && Math.abs(v - before[k]) > 1) || after[c] > bottom + 1;
      if (!moved) { before = after; break; }
      here.forEach(u => u.apply(-e));
    }
  }
}

// --- data helpers -----------------------------------------------------------

// With several pictures, one or two briefs carry a small one, where the text
// columns are wide enough to take it.
function pickBriefImages(briefs, photoStory, geo) {
  const ids = new Set();
  const flow = geo.lead - geo.photo;
  const max = flow >= 4 ? 3 : flow >= 2 ? 2 : 1;
  for (const s of briefs.slice(0, 6)) {
    if (ids.size >= max) break;
    if (usable(s.image) && s.image.url !== photoStory?.image?.url) ids.add(s.id);
  }
  return ids;
}

function usable(img) {
  return !!(img && img.url && !img.sensitive);
}

function captionFor(img) {
  let alt = typo(img.alt);
  if (img.credit) alt = alt.replace(img.credit, '').trim();
  alt = alt.replace(/^Foto\s+/i, '').replace(/\s*Foto:.*$/i, '').trim();
  return alt || null;
}

function creditFor(img) {
  if (!img?.credit) return null;
  return img.credit.trim().replace(/\.$/, '').replace(/^Foto:\s*/i, 'Foto ');
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function cap(s) {
  s = String(s ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Newspaper typography: curly quotes, real apostrophes, ellipses, dashes.
function typo(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s(\[—–/-])'(s|t|n)\b/g, '$1’$2')
    .replace(/(^|[\s(\[—–/-])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[—–/-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/\.\.\./g, '…')
    .replace(/ - /g, ' – ');
}
