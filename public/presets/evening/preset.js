// Evening Edition: the provider's front page set as a newspaper in dark ink.
// A template on the kit (../kit.js, presets/README.md "Templates").
//
//   date ·············· HET NIEUWS ·············· bijgewerkt · bron
//   ══════════════════════════════════════════════════════════════════
//   lead photo, about half the width   │ secondary story   [thumb]
//                                      │ secondary story   [thumb]
//   lead headline, summary             │ secondary story   [thumb]
//   ──────────────────────────────────────────────────────────────────
//   brief │ brief │ brief │ brief │ brief
//   ──────────────────────────────────────────────────────────────────
//   LIVE  running liveblogs, one line
//
// Stories keep the front page's order: top[0] is the lead (the newest running
// live story when live stories lead, else the provider's own lead), then the
// side column, then the briefs. Column counts come from the screen (see
// columns()); type scales with cqmin in preset.css. layout() cuts the text to
// what fits and drops what does not: what the side column drops opens the
// briefs, and the live line has the running stories the page does not show.

import * as kit from '../kit.js';

// What each region shows; [a, b] is a at density 1 (more headlines) and b at
// 5 (fewer stories, more text each). `side` is per stack of the side column,
// `briefs` per column: columns() gives the count.
const REGIONS = {
  lead: { from: ['top', 'latest'], stories: 1, words: [20, Infinity], points: [0, 3], pictures: 1 },
  side: { from: ['top', 'latest'], stories: [7, 3], spares: 2, words: [0, 80], pictures: [1, 3] },
  briefs: { from: ['top', 'latest'], stories: 1, words: [0, 36] },
};

// The lead's photo keeps at least this share of the lead's height; its text
// is cut to the rest.
const PHOTO_SHARE = [0.62, 0.42];

export default {
  id: 'evening',
  name: 'Evening Edition',
  tone: 'dark',

  render(root, data, ctx) {
    const { h } = ctx;
    kit.page(root, ctx);
    const cols = columns(ctx.screen, ctx.safe);
    const per = (spec, n) => ({ ...spec, stories: kit.at(ctx, spec.stories) * n, spares: (spec.spares ?? 0) * n });
    const { lead: [lead] = [], side, briefs } = kit.plan(data, ctx, {
      lead: REGIONS.lead,
      side: per(REGIONS.side, cols.side),
      briefs: per(REGIONS.briefs, cols.briefs),
    });
    // The side column's stories wait ahead of the briefs, as briefs, for
    // those it leaves out; layout() picks what the briefs and live line show.
    const words = kit.at(ctx, REGIONS.briefs.words);
    const rest = [...side.map(({ story }) => ({ story, summary: words ? kit.cutWords(story.summary, words) : null, spare: true })), ...briefs];
    const live = (data.live ?? []).filter(s => s.live && s.title && kit.storyKey(s) !== (lead && kit.storyKey(lead.story)));

    root.append(h('div', { class: `ev-page kit-page${cols.side > 1 ? ' is-wide' : ''}`, '--brief-cols': cols.briefs },
      masthead(data, ctx),
      h('main', { class: 'ev-main' },
        lead ? leadStory(lead, ctx, cols) : null,
        side.length ? sideColumn(side, ctx, cols) : null,
      ),
      rest.length ? h('section', { class: 'ev-briefs' }, rest.map(s => brief(s, ctx))) : null,
      live.length ? liveLine(live, ctx) : null,
    ));
  },

  layout(root, ctx) {
    const page = root.querySelector('.ev-page');
    if (!page) return;
    const cols = columns(ctx.screen, ctx.safe);
    // The briefs and the live line take what the main band leaves out, which
    // changes the room it has: it is fitted again, its side column keeping to
    // the stories it showed, until it shows them all.
    let keep = null;
    for (;;) {
      kit.reset(page);
      if (keep) takeRest(page, keep, cols);
      fitMain(page, ctx, keep);
      const shown = new Set([...page.querySelectorAll('.ev-main [data-key]:not([hidden])')].map(el => el.dataset.key));
      if (keep && shown.size >= keep.size) return;
      keep = shown;
    }
  },
};

// --- fitting ---------------------------------------------------------------

// The lead and the side column fitted to the main band, the side column to
// the stories in `keep` (all, without).
function fitMain(page, ctx, keep) {
  // The lead photo keeps its share of the lead: its text gives way first.
  const lead = page.querySelector('.ev-lead');
  const frame = lead?.querySelector('.ev-photo .kit-frame');
  if (frame) kit.trimToFit(lead.querySelector('.ev-lead-text'), () => frame.clientHeight < lead.clientHeight * kit.at(ctx, PHOTO_SHARE), 8);
  else if (lead) {
    kit.trimToFit(lead, () => kit.overflows(lead), 8);
    // Without a photo the headline grows into the room, up to 1.6 times.
    const title = lead.querySelector('.ev-lead-title');
    const text = lead.querySelector('.ev-lead-text');
    const px = parseFloat(getComputedStyle(title).fontSize);
    kit.fitSize(title, px, px * 1.6, () => !kit.overflows(title) && text.offsetHeight <= lead.clientHeight * 0.75);
  }

  // A stack of side stories loses stories from the end until it fits, the
  // first one left out coming back cut to the words that fit, without its
  // thumb if need be, or with room to spare takes in a spare; what room is
  // left goes between the stories.
  for (const stack of page.querySelectorAll('.ev-stack')) {
    const stories = [...stack.children].filter(el => !keep || keep.has(el.dataset.key));
    for (const el of stack.children) if (!stories.includes(el)) kit.hide(el);
    const over = () => kit.overflows(stack);
    kit.dropToFit(stories, over, { trim: 8 });
    const next = stories.find(el => el.hidden && !('kitSpare' in el.dataset));
    const thumb = next?.querySelector('.ev-thumb');
    if (thumb) {
      [next, ...next.querySelectorAll('[data-kit-hidden]')].forEach(kit.show);
      kit.hide(thumb);
      kit.setStyle(next, 'grid-template-columns', 'minmax(0, 1fr)');
      kit.dropToFit([next], over, { trim: 8 });
    }
    kit.fill(stories, over, { trim: 8 });
    kit.spread(stack, stories);
  }
}

// The briefs show the first stories not `onPage`, the live line the running
// ones still not shown; with none, each stays out.
function takeRest(page, onPage, cols) {
  const seen = new Set(onPage);
  let n = cols.briefs;
  for (const el of page.querySelectorAll('.ev-brief')) {
    if (n > 0 && !seen.has(el.dataset.key)) { kit.show(el); seen.add(el.dataset.key); n--; }
    else kit.hide(el);
  }
  const briefs = page.querySelector('.ev-briefs');
  if (briefs && n === cols.briefs) kit.hide(briefs);
  const live = page.querySelector('.ev-live');
  if (!live) return;
  kit.show(live);
  if (!fitLine(live, seen)) kit.hide(live);
}

// The live line's stories not in `seen`, in order, each whole, skipping any
// that would not fit; a first one too long on its own ends in an ellipsis.
// Returns how many it shows.
function fitLine(line, seen) {
  const items = [...line.querySelectorAll('.ev-live-item')];
  items.forEach(kit.hide);
  let shown = 0;
  for (const el of items) {
    if (seen.has(el.dataset.key)) continue;
    seen.add(el.dataset.key);
    kit.show(el);
    if (line.scrollWidth <= line.clientWidth) shown++;
    else if (shown) kit.hide(el);
    else {
      kit.setStyle(el, 'flex-shrink', '1');
      return 1;
    }
  }
  return shown;
}

// --- grid ------------------------------------------------------------------

// Ultrawide screens get a second side column. Type scales with the short side,
// so briefs get a column per ~34% of it (a measure of about 35 characters),
// in the width the margin for the desktop files (safe.right) leaves.
function columns({ width, height }, safe) {
  const inner = width - 2 * safe.right;
  const wide = inner / height >= 2;
  const briefs = Math.min(6, Math.max(3, Math.floor(inner / (Math.min(width, height) * 0.34))));
  return {
    side: wide ? 2 : 1,
    briefs,
    leadPx: Math.round(inner * (wide ? 0.42 : 0.52)),
    thumbPx: Math.round(inner * (wide ? 0.1 : 0.17)),
  };
}

// --- regions ---------------------------------------------------------------

function masthead(data, ctx) {
  const { h } = ctx;
  const updated = Date.parse(data.generatedAt);
  return h('header', { class: 'ev-mast' },
    h('p', { class: 'ev-ear' }, ctx.date(ctx.now, 'long')),
    h('h1', { class: 'ev-nameplate' }, ctx.t.nameplate),
    h('p', { class: 'ev-ear is-right' },
      Number.isFinite(updated) ? h('span', null, `${ctx.t.updated} `, h('span', { class: 'ev-time' }, ctx.time(updated))) : null,
      h('span', null, `${ctx.t.source}: ${data.source?.name ?? 'VRT NWS'}`),
    ),
  );
}

function leadStory(item, ctx, cols) {
  const { h } = ctx;
  const { story } = item;
  return h('article', { class: `ev-lead${item.picture ? '' : ' no-photo'}`, dataset: { key: kit.storyKey(story), story: story.url } },
    item.picture ? kit.photo(ctx, item.picture, cols.leadPx, { cls: 'ev-photo' }) : null,
    h('div', { class: 'ev-lead-text' },
      kicker(story, ctx),
      h('h2', { class: 'ev-lead-title' }, kit.typo(story.title)),
      item.summary ? kit.prose(ctx, item.summary, 'ev-lead-summary') : null,
      item.points.map(p => kit.prose(ctx, p, 'ev-point')),
    ),
  );
}

function sideColumn(items, ctx, cols) {
  const { h } = ctx;
  // Each stack takes its share of the stories, then of the spares.
  const share = (list, k) => {
    const n = Math.ceil(list.length / cols.side);
    return list.slice(k * n, (k + 1) * n);
  };
  const own = items.filter(s => !s.spare);
  const spares = items.filter(s => s.spare);
  const stacks = Array.from({ length: cols.side }, (_, k) => [...share(own, k), ...share(spares, k)]);
  return h('div', { class: 'ev-side' },
    stacks.filter(group => group.length).map(group => h('div', { class: 'ev-stack' }, group.map(s => secondary(s, ctx, cols)))),
  );
}

function secondary(item, ctx, cols) {
  const { h } = ctx;
  const { story } = item;
  return kit.spare(h('article', { class: `ev-second${item.picture ? '' : ' no-photo'}`, dataset: { key: kit.storyKey(story), story: story.url } },
    h('div', { class: 'ev-second-text' },
      kicker(story, ctx),
      h('h3', { class: 'ev-second-title' }, kit.typo(story.title)),
      item.summary ? kit.prose(ctx, item.summary, 'ev-summary') : null,
    ),
    item.picture ? kit.photo(ctx, item.picture, cols.thumbPx, { cls: 'ev-thumb' }) : null,
  ), item);
}

function brief(item, ctx) {
  const { h } = ctx;
  const { story } = item;
  return kit.spare(h('article', { class: 'ev-brief', dataset: { key: kit.storyKey(story), story: story.url } },
    kicker(story, ctx, { time: !story.section }),
    h('h3', { class: 'ev-brief-title' }, kit.typo(story.title)),
    item.summary ? kit.prose(ctx, item.summary, 'ev-brief-summary') : null,
  ), item);
}

// It starts hidden, as a spare: layout() shows it with the running stories
// the page leaves out.
function liveLine(stories, ctx) {
  const { h } = ctx;
  return kit.spare(h('footer', { class: 'ev-live' },
    h('span', { class: 'ev-tag is-live' }, ctx.t.live),
    stories.map(s => h('p', { class: 'ev-live-item', dataset: { key: kit.storyKey(s), story: s.url } },
      s.section ? h('span', { class: 'ev-section' }, s.section) : null,
      kit.typo(s.title),
    )),
  ), { spare: true });
}

// --- pieces ----------------------------------------------------------------

// One line of small labels: state, section, time (briefs: time only without a section).
function kicker(story, ctx, { time = true } = {}) {
  const { h } = ctx;
  const isLive = story.live === true;
  return h('p', { class: 'ev-kicker' },
    isLive ? h('span', { class: 'ev-tag is-live' }, ctx.t.live) : null,
    ctx.fresh.has(story.id) ? h('span', { class: 'ev-tag is-new' }, ctx.t.new) : null,
    story.kind === 'video' ? h('span', { class: 'ev-tag is-video' }, `▶ ${duration(story.durationSec)}`) : null,
    story.section ? h('span', { class: 'ev-section' }, story.section) : null,
    time && story.time && !isLive ? h('span', { class: 'ev-time' }, kit.when(story, ctx)) : null,
  );
}

function duration(sec) {
  if (!sec) return 'Video';
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}
