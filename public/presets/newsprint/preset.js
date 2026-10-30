// Newsprint: the provider's front page as a classic broadsheet, set like the
// Broadsheet liveblog design: one big lead with its own photo, text in columns.
// A template on the kit (../kit.js, presets/README.md "Templates").
//
// Page anatomy (top to bottom):
//   masthead  the date in the left ear, the nameplate, the update time in the
//             right ear; a dateline under a heavy rule
//   body      the lead across most columns, as one package: kicker (section,
//             time), headline, and its own photo beside its text (summary with
//             a drop cap, a liveblog's summary points). A lead with little
//             text has its headline beside the photo instead. Under a rule,
//             "More news": the next top stories as briefs in columns. A rail
//             on the right with the latest news.
//   index     one row: each picked section with its newest headline (two where
//             a section's share of the row has room for them)
//   (blank)   bare paper at the bottom for the Dock, down the right edge for
//             the files on the desktop, and as much down the left to center it
//
// The number of columns comes from the screen (geometry()); type scales with
// cqmin. layout() fits the headline, sizes the photo and the lead's text to
// one row, and lets the briefs and the rail drop whole stories from the end,
// the first one left out coming back trimmed to the words that fit.
//
// Without a photo for the lead (pictures 'none', or none in the feed) its text
// opens the columns, as a broadsheet's text-only lead does. A story with
// `live: true` gets a red LIVE tag.

import * as kit from '../kit.js';

// What each region shows; [a, b] is a at density 1 (more headlines) and b at
// 5 (fewer stories, more text each). The lead's photo is its own story's.
const REGIONS = {
  lead: { from: 'top', stories: 1, words: [40, Infinity], points: [0, 4], pictures: 1 },
  briefs: { from: 'top', stories: [16, 8], words: [0, 70], pictures: [1, 3] },
  rail: { from: 'latest', stories: 14, words: [0, 30] },
  index: { from: 'sections', stories: [2, 1] },
};

// The lead's photo row may take this share of the room under the headline,
// leaving the briefs under it at least this many lines.
const LEAD_ROW = [0.44, 0.64];
const FLOW_LINES = [12, 8];

export default {
  id: 'newsprint',
  name: 'Newsprint',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    kit.page(root, ctx);
    const geo = geometry(ctx.screen, ctx.safe);
    const idx = indexRegion(data, geo, ctx);
    const { lead: [lead] = [], briefs, rail, index } = kit.plan(data, ctx, { ...REGIONS, index: idx.spec });

    root.setAttribute('lang', ctx.lang);
    root.append(
      h('div', { class: 'np-paper', 'aria-hidden': 'true' }),
      h('div', {
        class: 'np-page kit-page',
        '--cols': geo.cols, '--lead-cols': geo.lead, '--rail-cols': geo.rail,
        '--photo-cols': geo.photo, '--deck-cols': geo.lead - geo.photo,
      },
        masthead(data, ctx),
        h('main', { class: 'np-body' },
          lead ? leadPackage(lead, briefs, geo, ctx) : h('p', { class: 'np-empty' }, ctx.t.noNews),
          latestRail(rail, ctx)),
        sectionIndex(index, idx.per, ctx)));
  },

  layout(root, ctx) {
    const page = root.querySelector('.np-page');
    if (!page) return;
    // From the rendered state each time, so the pass after web fonts load can
    // bring back what the first one dropped.
    kit.reset(page);
    fitNameplate(page);
    fitLead(page, ctx);
    fitFlow(page);
    fitRail(page);
    justifyFlow(page);
    justifyRail(page);
  },
};

// --- geometry ---------------------------------------------------------------

// Columns of about 33 characters, as many as fit between the margins for the
// desktop files (safe.right), kept on both sides so the page stays centered:
// 5 on a MacBook, 6 at 2560, 8 on an ultrawide. The rail takes one, two from 8;
// the lead's photo about two fifths of the rest.
function geometry({ width, height }, safe) {
  const u = Math.min(width, height) / 100; // 1cqmin
  const mx = Math.max(28, 2.4 * u + 0.011 * width);
  const gap = 2.2 * u;
  const inner = width - 2 * (mx + safe.right);
  const cols = Math.max(4, Math.min(11, Math.floor((inner + gap) / (22 * u + gap))));
  const rail = cols >= 8 ? 2 : 1;
  const lead = cols - rail;
  const colW = (inner - (cols - 1) * gap) / cols;
  return { cols, rail, lead, photo: Math.max(1, Math.round(lead * 0.42)), u, gap, inner, colW };
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

// The lead and the briefs under it. With a photo, three ways:
//   across  kicker and headline over the lead's columns, then a row: its text
//           in columns beside its photo
//   side    (little text) kicker, headline and text beside the photo
//   none    no photo: its text opens the columns the briefs run on in
function leadPackage(lead, briefs, geo, ctx) {
  const { h } = ctx;
  const s = lead.story;
  const headline = kit.typo(s.title);
  const kick = kicker(s, ctx, true);
  const hed = h('h2', { class: 'np-headline', dataset: { len: headline.length, story: s.url } }, headline);
  const head = briefs.length ? h('h4', { class: 'np-flow-head' }, h('span', null, ctx.t.moreNews)) : null;
  const items = briefs.map(b => brief(b, ctx));
  if (!lead.picture) {
    return h('article', { class: 'np-lead' }, kick, hed,
      h('div', { class: 'np-flow' }, deck(lead, ctx, 'np-leadtext'), head, items));
  }
  const deckCols = geo.lead - geo.photo;
  const words = [lead.summary, ...lead.points].join(' ').split(/\s+/).filter(Boolean).length;
  const side = words < 22 * deckCols;
  const photo = kit.photo(ctx, lead.picture, geo.photo * (geo.colW + geo.gap), { caption: true, cls: 'np-leadphoto' });
  return h('article', { class: `np-lead has-photo${side ? ' is-side' : ''}` },
    side ? null : kick,
    side ? null : hed,
    h('div', { class: 'np-leadrow' },
      side ? h('div', { class: 'np-stack' }, kick, hed, deck(lead, ctx, 'np-deck')) : deck(lead, ctx, 'np-deck'),
      photo),
    head,
    h('div', { class: 'np-flow' }, items));
}

// The lead's own text: its summary, then its summary points (VRT NWS
// liveblogs), each a paragraph layout() can cut by words.
function deck(lead, ctx, cls) {
  if (!lead.summary && !lead.points.length) return null;
  return ctx.h('div', { class: cls },
    lead.summary ? kit.prose(ctx, lead.summary, 'np-opener') : null,
    lead.points.map(p => kit.prose(ctx, p, 'np-point')));
}

// An earlier story in the columns: headline, then its summary after a run-in
// dateline (section and time). A picture sits above the headline, the two in
// one block so a column break never comes between them. That block, or the
// headline alone, is the first line of the summary's paragraph, so the
// paragraph's orphans keep it with the dateline and text that follow.
function brief({ story: s, summary, picture }, ctx) {
  const { h } = ctx;
  const meta = [s.section, kit.when(s, ctx)].filter(Boolean).join(' · ');
  const title = h('h3', { class: 'np-brief-title' }, liveTag(s, ctx), newTag(s, ctx), kit.typo(s.title));
  const head = picture ? h('div', { class: 'np-brief-head' },
    kit.photo(ctx, picture, 420, { credit: true, cls: 'np-brief-fig' }), title) : title;
  return h('article', { class: 'np-brief', dataset: { drop: 'brief', story: s.url } },
    summary ? kit.prose(ctx, summary, 'np-first', [head, meta ? h('b', { class: 'np-dl' }, `${meta} — `) : null])
      : h('p', { class: 'np-first' }, head, meta ? h('b', { class: 'np-dl' }, meta) : null));
}

// Section label with the small marks: a red LIVE tag, the time, "Nieuw".
function kicker(s, ctx, withTime = false) {
  const { h } = ctx;
  const now = ctx.now.getTime();
  const today = s.time && kit.sameDay(s.time, now);
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

// --- rail -------------------------------------------------------------------

// The latest news that is not on the page already, newest first; with more
// text (density), a line or two of each.
function latestRail(items, ctx) {
  const { h } = ctx;
  if (!items.length) return null;
  return h('aside', { class: 'np-rail' },
    h('div', { class: 'np-rail-flow' },
      h('section', { class: 'np-rail-sec' },
        h('h4', { class: 'np-rail-head' }, h('span', null, ctx.t.latest)),
        items.map(({ story: s, summary }) => h('article', { class: 'np-other', dataset: { drop: 'other', story: s.url } },
          h('p', { class: 'np-other-topic' }, liveTag(s, ctx), s.section ? h('span', null, s.section) : null),
          h('h5', { class: 'np-other-title' }, newTag(s, ctx), kit.typo(s.title)),
          summary ? kit.prose(ctx, summary, 'np-other-text') : null,
          kit.when(s, ctx) ? h('p', { class: 'np-other-meta' }, kit.when(s, ctx)) : null)))));
}

// --- section index ----------------------------------------------------------

// One row, the picked sections in order, each with its newest headlines that
// are not on the page yet: two where a section's share of the row is as wide
// as two body columns (few sections, a wide screen) and the density asks for
// them. With no sections the latest news fills the row.
function indexRegion(data, geo, ctx) {
  const n = Math.min((data.sections ?? []).filter(s => s.stories?.length).length, geo.cols + 1);
  if (!n) return { spec: { from: 'latest', stories: geo.cols }, per: 1 };
  const room = (geo.inner - (n - 1) * geo.gap) / n >= 2 * geo.colW + geo.gap;
  const per = room ? kit.at(ctx, REGIONS.index.stories) : 1;
  return { spec: { ...REGIONS.index, stories: per, groups: geo.cols + 1 }, per };
}

function sectionIndex(index, per, ctx) {
  const { h } = ctx;
  // Sections, or the latest stories each under its own section's name.
  const groups = index.map(x => x.items ? x : { name: x.story.section ?? ctx.t.latest, items: [x] });
  if (!groups.length) return null;
  const item = ({ story: s }) => h('article', { class: 'np-entry-item', dataset: { story: s.url } },
    h('h5', { class: 'np-entry-hed' }, liveTag(s, ctx), newTag(s, ctx), kit.typo(s.title)),
    kit.when(s, ctx) ? h('p', { class: 'np-entry-meta' }, kit.when(s, ctx)) : null);
  return h('footer', { class: 'np-index', '--n': groups.length, '--per': per },
    groups.map(g => h('section', { class: 'np-entry' },
      h('p', { class: 'np-entry-label' }, g.name),
      h('div', { class: 'np-entry-items' }, g.items.map(item)))));
}

// --- layout: fit and fill ---------------------------------------------------

// The nameplate steps down to fit between the ears.
function fitNameplate(page) {
  const plate = page.querySelector('.np-nameplate');
  const span = plate?.firstElementChild;
  if (!span) return;
  const max = parseFloat(getComputedStyle(plate).fontSize);
  const w = span.getBoundingClientRect().width;
  if (w > plate.clientWidth) kit.setStyle(plate, 'font-size', `${Math.max(max * 0.5, max * plate.clientWidth / w * 0.98)}px`);
}

// The lead: its headline as large as fits, and with a photo, one row of photo
// and text. The row may take a share of the room under the headline (by
// density), and leaves the briefs under it FLOW_LINES, or with several
// pictures room for one and its headline in a column; the photo is 3:2, or cropped to the row, never wider than about
// 2.3:1 unless the row is too low for that. Its text is set larger to fill
// the row, or cut by words to fit it.
function fitLead(page, ctx) {
  const lead = page.querySelector('.np-lead');
  if (!lead) return;
  const hed = lead.querySelector('.np-headline');
  const u = Math.min(ctx.screen.width, ctx.screen.height) / 100;
  const len = Number(hed.dataset.len) || 80;
  const wide = Math.min(1.3, Math.max(1, Math.sqrt(ctx.screen.width / ctx.screen.height / 1.6)));
  const hi = (len < 45 ? 8.6 * u : len < 80 ? 7.4 * u : 6.4 * u) * wide;
  const lo = 3.2 * u;
  const lines = () => Math.round(hed.getBoundingClientRect().height / (parseFloat(getComputedStyle(hed).lineHeight) || 1));
  const photo = lead.querySelector('.np-leadphoto');
  if (!photo) {
    kit.fitSize(hed, lo, hi, () => lines() <= 3 && hed.getBoundingClientRect().height <= lead.clientHeight * 0.34);
    return;
  }
  const frame = photo.querySelector('.kit-frame');
  const row = lead.querySelector('.np-leadrow');
  const text = row.querySelector('.np-deck');
  const capH = photo.getBoundingClientRect().height - frame.getBoundingClientRect().height;
  const w = frame.clientWidth;
  const height = el => el.getBoundingClientRect().height;
  const share = kit.at(ctx, LEAD_ROW);
  const stack = row.querySelector('.np-stack');
  const below = () => lead.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
  const flow = () => {
    const head = lead.querySelector('.np-lead > .np-flow-head');
    const line = parseFloat(getComputedStyle(lead).lineHeight) || 20;
    const headH = head ? head.getBoundingClientRect().height + 3 * line / 2 : 0;
    const least = kit.at(ctx, FLOW_LINES) * line;
    const pic = lead.querySelector('.np-flow .np-brief-head');
    const withPic = pic ? Math.max(least, pic.offsetHeight + 2 * line) : least;
    // Not at the cost of the lead's own photo: then the briefs' go.
    return (below() - withPic - headH >= w / 2.3 + capH ? withPic : least) + headH;
  };
  let most;
  if (stack) {
    // Side: the headline as large as lets kicker, headline and text fit
    // beside the photo, at most four lines.
    most = Math.min(w / 1.5 + capH, lead.clientHeight * share, below() - flow());
    kit.fitSize(hed, lo, hi, () => lines() <= 4 && height(stack) <= most);
    if (text && height(stack) > most) {
      const over = () => height(stack) > most;
      if (!kit.trimToFit(text, over, 6)) kit.hide(text);
    }
  } else {
    kit.fitSize(hed, lo, hi, () => lines() <= 3 && height(hed) <= lead.clientHeight * 0.26);
    most = Math.min(w / 1.5 + capH, below() * share, below() - flow());
    if (text) {
      const body = parseFloat(getComputedStyle(text).fontSize);
      kit.fitSize(text, body, body * 1.45, () => height(text) <= most);
      if (height(text) > most) {
        kit.setStyle(text, 'height', `${most}px`);
        if (!kit.trimToFit(text, () => kit.overflows(text), 6)) kit.hide(text);
      }
    }
  }
  const content = stack ? height(stack) : text && !text.hidden ? height(text) : 0;
  const rowH = Math.min(most, Math.max(content, w / 2.3 + capH));
  kit.setStyle(frame, 'aspect-ratio', 'auto');
  kit.setStyle(frame, 'height', `${Math.max(rowH - capH, 0)}px`);
  // The side's text sits at the foot of the row, by the caption.
  if (stack) kit.setStyle(stack, 'height', `${rowH}px`);
}

// Columns: drop whole briefs from the end, the first one left out coming back
// trimmed to the words that fit, so the last column ends on a full line.
// A head left alone at the foot of a column, its first story in the next, goes.
// A brief's picture that would fill most of a column (a low row under the
// lead) goes. A brief that, with its picture or a long headline, did not fit
// at the foot of a column and left a hole there: while some briefs are left
// out, it opens the column after all, with two lines of its text, if the rules
// over it come closer, or else the brief before it (not a live one) is cut by
// a few lines, unless the columns then end with fewer stories or more room;
// else it loses its picture, or goes, if the column then ends fuller. Each
// hole once, a few tries.
function fitFlow(page) {
  const flow = page.querySelector('.np-flow');
  if (!flow) return;
  const lead = flow.closest('.np-lead');
  const head = lead.querySelector('.np-flow-head');
  const briefs = [...flow.querySelectorAll('[data-drop="brief"]')];
  const over = () => kit.overflows(flow);
  const line = parseFloat(getComputedStyle(flow).lineHeight) || 20;
  const out = [];
  const ups = [];
  const fit = () => {
    kit.reset(flow);
    out.forEach(kit.hide);
    kit.picturesToFit(flow, 2 * line);
    ups.forEach(up => up());
    kit.dropToFit(briefs, over, { trim: 8 });
    // Even the lead's own text is too long (it opens the columns): cut it.
    const text = flow.querySelector('.np-leadtext');
    if (over() && text) kit.trimToFit(text, over, 6);
  };
  fit();
  const shown = () => briefs.filter(el => !el.hidden).length;
  const tried = new Set();
  for (let k = 0; k < 6; k++) {
    const first = briefs.find(el => !el.hidden);
    if (head && flow.contains(head) && !head.hidden && first
      && Math.abs(head.getBoundingClientRect().left - first.getBoundingClientRect().left) >= 2) {
      out.push(head);
      fit();
      continue;
    }
    const hole = afterHole(flow, tried);
    if (!hole) break;
    const b = hole.el.closest('.np-brief');
    tried.add(b);
    const a = briefs.slice(0, briefs.indexOf(b)).findLast(el => !el.hidden);
    // With every brief shown, closer rules or a cut bring nothing more in.
    const up = shown() < briefs.length && (closeUp(flow, b, hole.col) ?? (a && cutFor(flow, a, b, hole.col)));
    if (up) {
      const n = shown(), room = roomIn(flow);
      ups.push(up);
      fit();
      if (shown() > n || (shown() === n && roomIn(flow) <= room)) continue;
      ups.pop();
    }
    out.push(hole.el);
    fit();
    if (holeIn(flow, hole.col) > hole.size - hole.line) {
      out.pop();
      fit();
    }
  }
  // A brief whose headline ends a column without two lines of its text under
  // it: the rules over it come closer, or else it loses its picture, if it
  // then opens there with them, the column ends at most two lines short and
  // no story goes.
  for (const b of briefs) {
    const top = (b.querySelector('.np-brief-fig:not([hidden])') ?? b.querySelector('.np-brief-title'))?.getClientRects()[0];
    if (b.hidden || !top) continue;
    const { colAt } = kit.columnsOf(flow);
    const col = colAt(top.left);
    if (opensIn(b, col, colAt)) continue;
    const n = shown();
    const opens = () => shown() >= n && opensIn(b, col, kit.columnsOf(flow).colAt)
      && holeIn(flow, col) <= 2 * line;
    const up = closeUp(flow, b, col);
    if (up) {
      ups.push(up);
      fit();
      if (opens()) continue;
      ups.pop();
      fit();
    }
    const fig = b.querySelector('.np-brief-fig:not([hidden])');
    if (!fig) continue;
    out.push(fig);
    fit();
    if (!opens()) {
      out.pop();
      fit();
    }
  }
  if (head && !briefs.some(el => !el.hidden)) kit.hide(head);
}

// A brief not tried yet that opens a column (under its rule at most) after one
// that ends more lines early than spreading can fill: {el: its picture or the
// brief, col: the column that ends early, size, line}.
function afterHole(flow, tried) {
  const { r, colAt, line } = kit.columnsOf(flow);
  for (const b of flow.querySelectorAll('.np-brief:not([hidden])')) {
    if (tried.has(b)) continue;
    const el = b.querySelector('.np-brief-fig:not([hidden])') ?? b;
    const q = el.getClientRects()[0];
    const c = q ? colAt(q.left) : 0;
    if (c === 0 || q.top > r.top + line * 2) continue;
    const size = holeIn(flow, c - 1);
    if (size > line * 3) return { el, col: c - 1, size, line };
  }
  return null;
}

// Brief a's text, unless a is live, cut by the words of three lines at most
// (back to a sentence's end only within them), so that brief b, after it,
// opens in column col, at its foot, and nothing before it moves: what cuts
// it again, or null.
function cutFor(flow, a, b, col) {
  const span = a.querySelector('.np-first .kit-t');
  if (!span || a.querySelector('.np-live')) return null;
  const { colAt, ends } = kit.columnsOf(flow);
  const before = ends().slice(0, col);
  const full = span.textContent;
  const words = full.split(/\s+/);
  const least = Math.max(8, words.length - Math.ceil(3 * words.length / span.getClientRects().length));
  const opens = n => {
    span.textContent = kit.cutWords(full, n);
    return span.textContent.split(/\s+/).length >= least && opensIn(b, col, colAt);
  };
  let lo = least;
  let hi = words.length - 1;
  if (lo > hi || !opens(lo)) {
    span.textContent = full;
    return null;
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (opens(mid)) lo = mid; else hi = mid - 1;
  }
  opens(lo);
  const moved = ends().slice(0, col).some((v, k) => Math.abs(v - before[k]) > 1);
  span.textContent = full;
  if (moved) return null;
  return () => {
    span.dataset.kitFull ??= span.textContent;
    span.textContent = kit.cutWords(span.textContent, lo);
  };
}

// The rules in column col, and the one over brief b, closer by two fifths of
// their space, so that b opens in col after all, at its foot: what brings
// them closer again, or null.
function closeUp(flow, b, col) {
  const { r, colAt } = kit.columnsOf(flow);
  const rules = [...flow.querySelectorAll('.np-brief:not([hidden])')].filter(el => {
    const q = el.getClientRects()[0];
    return el === b || (q && colAt(q.left) === col && q.top > r.top + 2
      && parseFloat(getComputedStyle(el).borderTopWidth) > 0);
  });
  const by = e => rules.forEach(el => {
    kit.grow(el, 'margin-top', -e / 2);
    kit.grow(el, 'padding-top', -e / 2);
  });
  const most = 0.8 * parseFloat(getComputedStyle(b).paddingTop);
  by(most);
  const opens = opensIn(b, col, colAt);
  by(-most);
  return opens ? () => by(most) : null;
}

// Whether brief b opens in column col: its picture or headline, and two lines
// of its text with it (the one its dateline starts, and the next), not only a
// word or two.
function opensIn(b, col, colAt) {
  const top = (b.querySelector('.np-brief-fig:not([hidden])') ?? b.querySelector('.np-brief-title'))?.getClientRects()[0];
  const span = b.querySelector('.np-first .kit-t');
  const lines = span ? [...span.getClientRects()].slice(0, 2) : [];
  return [top, ...lines].every(q => q && colAt(q.left) === col);
}

// How far a column of the flow ends above its foot.
function holeIn(flow, c) {
  const { ends, bottom } = kit.columnsOf(flow);
  return bottom - ends()[c];
}

// How far its columns end above their feet, in all.
function roomIn(flow) {
  const { r, ends, bottom } = kit.columnsOf(flow);
  return ends().reduce((sum, v) => sum + bottom - Math.max(v, r.top), 0);
}

function fitRail(page) {
  const col = page.querySelector('.np-rail-flow');
  if (!col) return;
  kit.dropToFit([...col.querySelectorAll('[data-drop="other"]')], () => kit.overflows(col), { trim: 6 });
}

// Vertical justification: a column that ends early gets its spare space
// spread over its separators (kit.spreadColumns).
function justifyFlow(page) {
  const flow = page.querySelector('.np-flow');
  if (!flow) return;
  kit.spreadColumns(flow, () => {
    const units = [];
    const head = flow.querySelector('.np-flow-head');
    if (head && !head.hidden) units.push({ el: head, apply: e => kit.grow(head, 'margin-top', e) });
    // The briefs with a rule over them (not the first under the head).
    [...flow.querySelectorAll('.np-brief')]
      .filter(el => !el.hidden && parseFloat(getComputedStyle(el).borderTopWidth) > 0)
      .forEach(el => {
        units.push({ el, apply: e => { kit.grow(el, 'margin-top', e / 2); kit.grow(el, 'padding-top', e / 2); } });
      });
    return units;
  }, true);
}

function justifyRail(page) {
  const box = page.querySelector('.np-rail-flow');
  if (!box) return;
  kit.spreadColumns(box, () => {
    const items = [...box.querySelectorAll('[data-drop]')].filter(el => !el.hidden);
    return items.slice(1).map((el, k) => ({
      el, apply: e => { kit.grow(items[k], 'padding-bottom', e / 2); kit.grow(el, 'padding-top', e / 2); },
    }));
  }, true);
}

function cap(s) {
  s = String(s ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
