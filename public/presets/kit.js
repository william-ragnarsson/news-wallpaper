// M6, the template kit: what the front-page designs (data: 'front') share. A design
// is a template: it says which regions it has and what each one shows; the kit
// fills them by the settings and fits them to the screen. The contract is in
// presets/README.md ("Templates").
//
// 1. Regions: plan(data, ctx, REGIONS). A design declares its regions in the
//    order they take stories, and gets each one back filled:
//
//      const REGIONS = {
//        lead:   { from: 'top', stories: 1, words: [40, 120], points: [0, 4], pictures: 1 },
//        briefs: { from: 'top', stories: [16, 6], words: [0, 60], pictures: [0, 3] },
//        rail:   { from: 'latest', stories: [14, 8] },
//        index:  { from: 'sections', stories: [2, 1], groups: 7 },
//      };
//      const { lead, briefs, rail, index } = kit.plan(data, ctx, REGIONS);
//
//    A value given as [a, b] follows the density setting: a at 1 (more
//    headlines, little text), b at 5 (fewer stories, more text each).
//    Each story is on the page once: a region skips what one before it took.
//
// 2. Settings: page(root, ctx) puts them on the root for the CSS (kit.css):
//    pictures and color, density, and the width the page keeps free for the
//    desktop files (an element with class kit-page keeps it on both sides).
//
// 3. Fitting, in layout(): from what render() built (reset), never
//    overflowing and never leaving a hole. Drop whole items from the end
//    (dropToFit), cut the last text by words (trimToFit) or a row's texts
//    alike (trimEvenly), take in spares
//    where there is room (fill), round a grid down to full rows (fullRows),
//    size type to fill (fitSize), and spread what room is left (spread,
//    spreadColumns).

export const DENSITY = { min: 1, max: 5, default: 3 };

// --- settings ---------------------------------------------------------------

export function density(ctx) {
  const d = Number(ctx.density);
  return Number.isInteger(d) ? Math.max(DENSITY.min, Math.min(DENSITY.max, d)) : DENSITY.default;
}

// A value at this density: `v` itself, or for [a, b] the point between a (at
// 1, more headlines) and b (at 5, more text), rounded when a and b are whole
// numbers. Infinity stays.
export function at(ctx, v) {
  if (!Array.isArray(v)) return v;
  const [a, b] = v;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return density(ctx) < 3 ? a : b;
  const t = (density(ctx) - DENSITY.min) / (DENSITY.max - DENSITY.min);
  const x = a + (b - a) * t;
  return Number.isInteger(a) && Number.isInteger(b) ? Math.round(x) : x;
}

// The settings on the root: is-color, pictures-<none|one|several>,
// density-<1..5> and --density (0 at more headlines, 1 at more text).
export function page(root, ctx) {
  const d = density(ctx);
  root.classList.add('kit', `pictures-${ctx.pictures ?? 'one'}`, `density-${d}`);
  if (ctx.color) root.classList.add('is-color');
  root.style.setProperty('--density', (d - DENSITY.min) / (DENSITY.max - DENSITY.min));
}

// --- regions ----------------------------------------------------------------

// Each region of `regions` filled from `data`, in order:
// - from: 'top' | 'latest' | 'live' | 'sections', or a list of them taken in
//   turn ('sections' gives groups, below)
// - stories: how many at most (per section for 'sections'; `groups` caps
//   the sections)
// - spares: how many more it takes as spares (per section too), which start
//   hidden (spare()) and come in when there is room left (fill())
// - words: its summary cut to this many words; 0 for none; all of it if left out
// - points: how many of the story's summary points (VRT NWS liveblogs)
// - pictures: how many of its stories may carry their own picture (per
//   section for 'sections'): a number, or [with 'one', with 'several']. With
//   'one' the page has one picture in all: the first region that allows one
//   gives it to its first story with a usable image. With 'none', none.
// - filter: (story) => boolean, the stories it may take
// - newest: true to have what it took newest first, its own then its spares
//   (a list of the latest that also takes from 'top' when the regions
//   before it took most of 'latest')
// Returns { [region]: Item[] }, or for 'sections' { [region]: [{ id, name,
// items: Item[] }] } (a section with nothing left is left out). An Item is
// { story, summary, points, picture, spare }: the summary and points to show,
// the story's own image or null, and whether it is one of the spares.
export function plan(data, ctx, regions) {
  const used = new Set();
  const out = {};
  const pictures = ctx.pictures ?? 'one';
  let ones = pictures === 'one' ? 1 : 0;
  const shown = new Set();
  const free = s => s?.title && !used.has(storyKey(s));
  const item = (s, spec, allowed) => {
    const words = at(ctx, spec.words);
    const picture = allowed.n > 0 && usable(s.image) && !shown.has(s.image.url) ? s.image : null;
    if (picture) { allowed.n--; shown.add(picture.url); if (pictures === 'one') ones--; }
    used.add(storyKey(s));
    return {
      story: s,
      summary: words === 0 ? null : cutWords(s.summary, words),
      points: (s.points ?? []).slice(0, at(ctx, spec.points ?? 0)),
      picture,
    };
  };
  for (const [name, spec] of Object.entries(regions)) {
    const [whenOne, whenSeveral] = Array.isArray(spec.pictures) ? spec.pictures : [spec.pictures ?? 0, spec.pictures ?? 0];
    const allowance = () => ({ n: pictures === 'several' ? at(ctx, whenSeveral) : pictures === 'one' ? Math.min(ones, whenOne) : 0 });
    const n = at(ctx, spec.stories ?? Infinity);
    const ok = s => free(s) && (!spec.filter || spec.filter(s));
    const take = (pool, allowed) => {
      const picked = pick(pool, ok, n + at(ctx, spec.spares ?? 0));
      if (spec.newest) picked.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
      return picked.map((s, i) => ({ ...item(s, spec, allowed), spare: i >= n }));
    };
    const from = [spec.from ?? 'top'].flat();
    if (from.includes('sections')) {
      out[name] = (data.sections ?? []).slice(0, at(ctx, spec.groups ?? Infinity))
        .map(sec => ({ id: sec.id, name: sec.name, items: take(sec.stories ?? [], allowance()) }))
        .filter(g => g.items.length);
    } else {
      out[name] = take(from.flatMap(f => data[f] ?? []), allowance());
    }
  }
  return out;
}

// The first n stories `ok` takes, in order (a story listed twice once). The
// first of them with a usable image get the region's pictures (item()).
function pick(pool, ok, n) {
  const out = [];
  const seen = new Set();
  for (const s of pool) {
    if (out.length >= n) break;
    if (!ok(s) || seen.has(storyKey(s))) continue;
    seen.add(storyKey(s));
    out.push(s);
  }
  return out;
}

// A liveblog's URL slug follows its headline, so the same blog can come in
// under two ids; the ~number at the end stays.
export function storyKey(s) {
  return s.id?.match(/~(\d+)\/?$/)?.[1] ?? s.id;
}

export function usable(img) {
  return !!(img && img.url && !img.sensitive);
}

// --- building ---------------------------------------------------------------

// Text that layout() may cut by words, and reset() puts back: a span of class
// kit-t in a paragraph (with a run-in before it, if any).
export function prose(ctx, text, cls, runIn) {
  return ctx.h('p', { class: cls }, runIn, ctx.h('span', { class: 'kit-t' }, typo(text)));
}

// A story's own picture: a frame that crops it (sized by the design) and,
// when asked, its caption and credit. kit.css tints it by the color setting.
export function photo(ctx, image, cssWidth, { caption = false, credit = caption, cls } = {}) {
  const { h } = ctx;
  const cap = caption ? captionFor(image) : null;
  const by = credit ? creditFor(image) : null;
  return h('figure', { class: ['kit-photo', cls].filter(Boolean).join(' ') },
    h('div', { class: 'kit-frame' },
      // Decoded when painted: the picture is taken as soon as the page says it
      // is drawn, and an image decoded on the side can still be blank then.
      h('img', { class: 'kit-img', src: ctx.image(image, Math.round(cssWidth)), alt: image.alt || '', decoding: 'sync' })),
    cap || by ? h('figcaption', { class: 'kit-caption' },
      cap ? h('span', { class: 'kit-cap' }, cap) : null,
      by ? h('span', { class: 'kit-credit' }, by) : null) : null);
}

export function captionFor(img) {
  let alt = typo(img?.alt);
  if (img?.credit) alt = alt.replace(img.credit, '').trim();
  alt = alt.replace(/^Foto\s+/i, '').replace(/\s*Foto:.*$/i, '').trim();
  return alt || null;
}

export function creditFor(img) {
  if (!img?.credit) return null;
  return img.credit.trim().replace(/\.$/, '').replace(/^Foto:\s*/i, 'Foto ');
}

// The time today, the day before that.
export function when(s, ctx) {
  if (!s.time) return null;
  return sameDay(s.time, ctx.now.getTime()) ? ctx.time(s.time) : ctx.ago(s.time, ctx.now.getTime());
}

export function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Newspaper typography: curly quotes, real apostrophes, ellipses, dashes.
export function typo(s) {
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

// The first n words of a text, with an ellipsis if that is not all of it; or
// up to the last full sentence in them, if that keeps most of them.
export function cutWords(text, n) {
  if (!text) return null;
  const words = text.trim().split(/\s+/);
  if (!Number.isFinite(n) || words.length <= n) return words.join(' ');
  const head = words.slice(0, n).join(' ');
  const end = [...head.matchAll(/[.!?…][”’"]?(?=\s+[A-ZÀ-Ý“‘"])/g)].at(-1);
  if (end && end.index > head.length * 0.6) return head.slice(0, end.index + end[0].length);
  return cut(words, n);
}

function cut(words, n) {
  if (n >= words.length) return words.join(' ');
  return words.slice(0, n).join(' ').replace(/[,;:–—-]+$/, '') + ' …';
}

// --- fitting ----------------------------------------------------------------

// Back to what render() built: what fitting hid, cut, sized or spread.
export function reset(root) {
  root.querySelectorAll('[data-kit-hidden]').forEach(show);
  root.querySelectorAll('[data-kit-spare]').forEach(el => { el.hidden = true; });
  root.querySelectorAll('[data-kit-full]').forEach(el => { el.textContent = el.dataset.kitFull; delete el.dataset.kitFull; });
  root.querySelectorAll('[data-kit-trimmed]').forEach(el => delete el.dataset.kitTrimmed);
  root.querySelectorAll('[data-kit-style]').forEach(el => {
    el.dataset.kitStyle.split(' ').forEach(k => el.style.removeProperty(k));
    delete el.dataset.kitStyle;
  });
}

export function hide(el) {
  if (!el || el.hidden) return;
  el.hidden = true;
  el.dataset.kitHidden = '';
}

export function show(el) {
  el.hidden = false;
  delete el.dataset.kitHidden;
}

// The element render() built for a planned item: a spare one (plan: spares)
// starts hidden, for fill().
export function spare(el, item) {
  if (item?.spare) { el.hidden = true; el.dataset.kitSpare = ''; }
  return el;
}

// Once all of a region's own items fit, its spares come in, in order, while
// they fit: a region of short stories takes another story rather than leaving
// a hole. With `trim`, the first that does not fit whole comes in cut, as in
// dropToFit().
export function fill(items, over, { trim = 0 } = {}) {
  const isSpare = el => 'kitSpare' in el.dataset;
  if (items.some(el => el.hidden && !isSpare(el))) return;
  for (const el of items.filter(el => el.hidden && isSpare(el))) {
    el.hidden = false;
    if (!over()) continue;
    if (trim) keepTrimmed(el, over, trim);
    else el.hidden = true;
    return;
  }
}

// A style fitting set, which reset() takes away again.
export function setStyle(el, prop, value) {
  el.style.setProperty(prop, value);
  const set = new Set((el.dataset.kitStyle ?? '').split(' ').filter(Boolean));
  set.add(prop);
  el.dataset.kitStyle = [...set].join(' ');
}

// Whether an element's content runs out of its box: down, or for a box of
// columns (multicol) into a column more than it has.
export function overflows(el) {
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 2;
}

// Hide items from the end while `over()`. With `trim` (a number of words), the
// first one hidden comes back cut to the words that fit, if at least that
// many do, so the region ends on a full line rather than on a hole; one left
// with a headline and none of its text stays hidden.
// Returns the items still shown.
export function dropToFit(items, over, { trim = 0 } = {}) {
  const shown = items.filter(el => !el.hidden);
  let i = shown.length - 1;
  while (i >= 0 && over()) hide(shown[i--]);
  if (trim && i < shown.length - 1) {
    show(shown[i + 1]);
    keepTrimmed(shown[i + 1], over, trim);
  }
  return items.filter(el => !el.hidden);
}

// An item cut to the words that fit, hidden again when that leaves too few
// (trimToFit), or a headline with none of its text.
function keepTrimmed(el, over, minWords) {
  const text = () => el.querySelector('p:not([hidden]) .kit-t');
  const had = text();
  if (over() && (!trimToFit(el, over, minWords) || (had && !text()))) hide(el);
}

// The pictures (kit.photo) in a box that are too tall for it: each goes when
// the block it is in (the picture and what stays with it, say its headline)
// leaves less than `room` px of the box's height, as in a low box of columns,
// which would slice it.
export function picturesToFit(box, room) {
  for (const fig of box.querySelectorAll('.kit-photo:not([hidden])')) {
    if (fig.parentElement.offsetHeight + room > box.clientHeight) hide(fig);
  }
}

// Cut the text (kit-t spans) of a container's last paragraphs word by word
// until `over()` is false, hiding a paragraph that keeps fewer than
// `minWords`. False if it still does not fit.
export function trimToFit(container, over, minWords = 6) {
  const paras = [...container.querySelectorAll('p')].filter(p => !p.hidden && p.querySelector('.kit-t'));
  while (paras.length) {
    const p = paras.at(-1);
    const span = p.querySelector('.kit-t');
    const full = span.dataset.kitFull ?? span.textContent;
    span.dataset.kitFull = full;
    const words = full.split(/\s+/);
    let lo = 0, hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      span.textContent = cut(words, mid);
      if (over()) hi = mid - 1; else lo = mid;
    }
    if (lo >= Math.min(minWords, words.length) && lo > 0) {
      span.textContent = cut(words, lo);
      if (lo < words.length) p.dataset.kitTrimmed = '';
      return !over();
    }
    span.textContent = full;
    hide(p);
    paras.pop();
    if (!over()) return true;
  }
  return !over();
}

// Cut a row's texts (the kit-t spans of `paras`) to the same number of words:
// the most at which `over()` is false, so the row stays even. A text left with
// fewer than `minWords` goes. False if it still does not fit.
export function trimEvenly(paras, over, minWords = 6) {
  const spans = paras.filter(p => !p.hidden).map(p => p.querySelector('.kit-t')).filter(Boolean);
  const words = spans.map(span => (span.dataset.kitFull ??= span.textContent).split(/\s+/));
  const set = n => spans.forEach((span, i) => { span.textContent = cut(words[i], n); });
  let lo = 0, hi = Math.max(0, ...words.map(w => w.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    set(mid);
    if (over()) hi = mid - 1; else lo = mid;
  }
  set(lo);
  spans.forEach((span, i) => {
    if (lo < Math.min(minWords, words[i].length)) hide(span.parentElement);
    else if (lo < words[i].length) span.parentElement.dataset.kitTrimmed = '';
  });
  return !over();
}

// A grid's items rounded down to full rows: the last row, if not full, goes
// (unless it is the only one). Returns the items still shown.
export function fullRows(grid, items) {
  const shown = items.filter(el => !el.hidden);
  const per = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  if (shown.length > per) shown.slice(shown.length - (shown.length % per)).forEach(hide);
  return items.filter(el => !el.hidden);
}

// The largest font size between lo and hi (px) at which `ok()` holds; lo if
// none does.
export function fitSize(el, lo, hi, ok) {
  const set = px => setStyle(el, 'font-size', `${px}px`);
  set(hi);
  if (ok()) return hi;
  let a = lo, b = hi;
  for (let i = 0; i < 10; i++) {
    const m = (a + b) / 2;
    set(m);
    if (ok()) a = m; else b = m;
  }
  set(a);
  return a;
}

// A stack (a box whose items run down) that ends short: its spare height
// spread over the gaps between the items shown, at most `most` px each.
export function spread(box, items, most = Infinity) {
  const shown = items.filter(el => !el.hidden);
  if (shown.length < 2) return;
  const last = shown.at(-1).getBoundingClientRect().bottom;
  const spare = box.getBoundingClientRect().top + box.clientHeight - last
    - (parseFloat(getComputedStyle(box).paddingBottom) || 0);
  if (spare < 2) return;
  const e = Math.min(most, spare / (shown.length - 1));
  shown.slice(1).forEach(el => grow(el, 'margin-top', e));
}

export function grow(el, prop, by) {
  const now = parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
  setStyle(el, prop, `${now + by}px`);
}

// Where each column's text ends, for a box of columns (multicol).
export function columnsOf(box) {
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
    box.querySelectorAll('.kit-frame').forEach(el => { for (const q of el.getClientRects()) take(q); });
    return out;
  };
  const line = parseFloat(getComputedStyle(box.querySelector('p') || box).lineHeight) || 20;
  return { r, n, colAt, ends, line, bottom: r.top + box.clientHeight };
}

// Vertical justification for a box of columns: a column that ends early,
// because the next item would not fit, gets its spare space spread over its
// separators, as a compositor would, so the column bottoms line up. Nothing
// moves between columns; if anything would, the column is left as it was.
// `unitsFor()` gives the separators: [{ el, apply(px) }].
export function spreadColumns(box, unitsFor, withLast = false) {
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
