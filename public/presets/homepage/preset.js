// Homepage: the provider's front page set as the homepage of a quality news site.
// White page, black serif headlines, sans labels and times, thin grey rules.
// A template on the kit (../kit.js, presets/README.md "Templates").
//
// Page anatomy, on a 12-column grid (15 on an ultrawide):
//   top bar    wordmark (the nameplate) left, date centre, update time and source
//              right; under it a static row of section labels
//   lead row   the lead story (kicker, headline, summary) with the next top
//              stories as related headlines under it, the lead photo beside it;
//              an ultrawide adds a column with more top stories
//   rail       "Net binnen": the newest stories with their time, full height
//   sections   one block per section, in the order picked on Customize: label,
//              a story (with a thumbnail when there are several pictures),
//              headlines; three, four on an ultrawide
//   footer     a quiet band that the Dock sits on
//
// Type scales with the short side of the screen (cqmin). layout() cuts the
// text to what fits, drops what does not and takes in spares where there is
// room.

import * as kit from '../kit.js';

// What each region shows, in the order they take stories; [a, b] is a at
// density 1 (more headlines) and b at 5 (fewer stories, more text each).
// `more` is the ultrawide's column; `topics` stands in for sections that are
// missing (topicGroups()). The sections come before the rail, which takes the
// newest of what is left.
const REGIONS = {
  lead: { from: 'top', stories: 1, words: [24, 90], points: [0, 3], pictures: 1 },
  related: { from: 'top', stories: [4, 2], spares: 2, words: [0, 30] },
  more: { from: 'top', stories: [6, 3], spares: 2, words: [0, 30], pictures: [0, 1] },
  sections: { from: 'sections', stories: [4, 2], spares: [2, 4], words: [0, 30], pictures: [0, 1] },
  topics: { from: 'top', stories: 24, words: [0, 30], pictures: [0, 1] },
  rail: { from: ['latest', 'top'], newest: true, stories: [16, 9], spares: 4, words: [0, 24] },
};

// Beside its photo the lead story keeps at most this share of the lead's
// height; its related headlines take the rest.
const STORY_SHARE = [0.6, 0.85];

export default {
  id: 'homepage',
  name: 'Homepage',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    kit.page(root, ctx);
    const wide = isWide(ctx);
    const blocks = wide ? 4 : 3;
    const have = (data.sections ?? []).filter(s => s.stories?.length).length;
    const { lead: [lead] = [], related, more = [], rail, sections, topics = [] } = kit.plan(data, ctx, {
      lead: REGIONS.lead,
      related: REGIONS.related,
      ...(wide ? { more: REGIONS.more } : {}),
      sections: { ...REGIONS.sections, groups: blocks },
      ...(have < blocks ? { topics: REGIONS.topics } : {}),
      rail: REGIONS.rail,
    });

    root.classList.toggle('is-wide', wide);
    root.setAttribute('lang', ctx.lang);
    root.append(
      topBar(data, ctx),
      h('main', { class: 'hp-main kit-page' },
        leadPackage(lead, related, more, ctx),
        latestRail(rail, related.filter(i => i.story.live), ctx),
        sectionRow([...sections, ...topicGroups(topics, ctx)].slice(0, blocks), ctx),
      ),
      footer(data, ctx),
    );
  },

  layout(root, ctx) {
    kit.reset(root);
    hyphenateLong(root);

    const box = root.querySelector('.hp-lead-text');
    if (box) {
      const story = box.querySelector('.hp-lead-story');
      const related = [...box.querySelectorAll('.hp-related > li')];
      if (box.closest('.no-photo')) {
        // No photo: the story and its related headlines side by side, the
        // headline growing into the room, up to 1.5 times.
        kit.trimToFit(story, () => kit.overflows(story), 8);
        growTitle(story, 1.5, () => !kit.overflows(story));
        const list = box.querySelector('.hp-related');
        stack(related, () => kit.overflows(list));
        if (list) spread(list, related);
      } else {
        // The photo sets the height: the story keeps its share, its related
        // headlines fit in under it, and what is still over comes off the
        // story. With none of them fitting, the first comes in without its
        // summary and the story makes room for it (makeRoom); only when it
        // cannot has the story it all. The headline grows into what is
        // left, up to 1.3 times.
        const over = () => kit.overflows(box);
        kit.trimToFit(story, () => story.offsetHeight > box.clientHeight * kit.at(ctx, STORY_SHARE), 8);
        stack(related, over);
        if (related.every(li => li.hidden) && !makeRoom(story, related[0], over)) {
          kit.reset(story);
          hyphenateLong(story);
        }
        kit.trimToFit(story, over, 8);
        growTitle(story, 1.3, () => !over());
      }
    }

    for (const block of root.querySelectorAll('.hp-more, .hp-section')) {
      const card = block.querySelector('.hp-card');
      const items = [...block.querySelectorAll('.hp-list > li')];
      stack(items, () => kit.overflows(block), card);
      spread(block, [card, ...items]);
    }
    // The rail, with the live stories the lead had no room for: they keep
    // their place, at their time, and the rail's own stories make room.
    const latest = root.querySelector('.hp-latest');
    if (latest) {
      const off = new Set([...root.querySelectorAll('.hp-related > li[hidden]')].map(li => li.dataset.id));
      const twins = [...latest.children].filter(li => off.has(li.dataset.twin));
      twins.forEach(kit.show);
      stack([...latest.children].filter(li => !li.dataset.twin), () => kit.overflows(latest));
      kit.dropToFit(twins, () => kit.overflows(latest));
      spread(latest, [...latest.children]);
    }
  },
};

// A list that loses items from the end until it fits, the first one left out
// coming back cut to the words that fit, or with room to spare takes in a spare.
// Room still left takes the next story as its headline alone, the summary
// above (the last shown, or `head` over the list) giving way to it if need be.
function stack(items, over, head) {
  kit.dropToFit(items, over, { trim: 6 });
  kit.fill(items, over, { trim: 6 });
  const i = items.findLastIndex(el => !el.hidden);
  const next = items[i + 1];
  if (!next) return;
  kit.show(next);
  next.querySelectorAll('.hp-summary').forEach(kit.hide);
  const above = items[i] ?? head;
  if (!over() || (above && kit.trimToFit(above, over, 6))) return;
  kit.hide(next);
  if (above) {
    kit.reset(above);
    hyphenateLong(above);
    kit.trimToFit(above, over, 6);
  }
}

// A headline or summary with a word too long for its line is hyphenated; the
// rest is not, so that only such a word breaks. A spare is measured too, shown
// for the while. What resets one does it again.
function hyphenateLong(root) {
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p')) {
    const off = el.closest('[hidden]');
    if (off) off.hidden = false;
    const long = tooLong(el);
    if (off) off.hidden = true;
    if (long) {
      kit.setStyle(el, 'hyphens', 'auto');
      kit.setStyle(el, '-webkit-hyphens', 'auto');
    }
  }
}

// Whether a word of el is wider than its line: el is wider with words kept whole.
function tooLong(el) {
  const width = () => Math.max(el.scrollWidth, el.offsetWidth);
  const fits = width();
  el.style.overflowWrap = 'normal';
  const long = width() > fits + 1;
  el.style.overflowWrap = '';
  return long;
}

// What room a list still has goes between its stories, a line at most each.
function spread(box, items) {
  const line = parseFloat(getComputedStyle(box.querySelector('.hp-headline, .hp-related-title') ?? box).lineHeight);
  kit.spread(box, items, line || 0);
}

// The first related headline back, without its summary: the story's summary
// gives way to it, then the story's headline, down to 0.75 times its size.
// False, and the headline hidden again, if that is not enough.
function makeRoom(story, li, over) {
  if (!li) return false;
  kit.show(li);
  kit.hide(li.querySelector('.hp-summary'));
  kit.trimToFit(story, over, 8);
  const title = story.querySelector('.hp-lead-title');
  const px = parseFloat(getComputedStyle(title).fontSize);
  kit.fitSize(title, px * 0.75, px, () => !over());
  if (!over()) return true;
  kit.hide(li);
  return false;
}

// The lead's headline grows into the room, up to `most` times its size, and
// its words fitting their lines whole not so far that one no longer does;
// with too little room for even the headline alone, it shrinks to fit, to
// as little as 0.6 times.
function growTitle(story, most, ok) {
  const title = story.querySelector('.hp-lead-title');
  const px = parseFloat(getComputedStyle(title).fontSize);
  const whole = !tooLong(title);
  kit.fitSize(title, px * 0.6, px * most, () => ok() && !(whole && tooLong(title)));
}

// An ultrawide gets 15 columns, the column of more top stories and a fourth
// section, by the width the margin for the desktop files (safe.right) leaves.
function isWide({ screen, safe }) {
  return (screen.width - 2 * safe.right) / screen.height >= 2;
}

// --- regions ----------------------------------------------------------------

function topBar(data, ctx) {
  const { h } = ctx;
  const updated = Date.parse(data.generatedAt);
  return h('header', { class: 'hp-top kit-page' },
    h('div', { class: 'hp-mast' },
      h('div', { class: 'hp-wordmark' }, ctx.t.nameplate),
      h('div', { class: 'hp-date' }, capitalise(ctx.date(ctx.now, 'long'))),
      h('div', { class: 'hp-meta' },
        Number.isFinite(updated) ? `${ctx.t.updated} ${ctx.time(updated)} · ` : '',
        `${ctx.t.source}: ${data.source?.name ?? 'VRT NWS'}`,
      ),
    ),
    h('nav', { class: 'hp-nav' },
      h('span', { class: 'is-current' }, ctx.t.frontPage),
      (data.sections ?? []).filter(s => s.stories?.length).map(s => h('span', null, s.name)),
    ),
  );
}

function leadPackage(lead, related, more, ctx) {
  const { h } = ctx;
  if (!lead) return h('section', { class: 'hp-lead is-empty' });
  const { story } = lead;
  return h('section', { class: `hp-lead${lead.picture ? '' : ' no-photo'}` },
    h('div', { class: 'hp-lead-text' },
      h('article', { class: 'hp-lead-story' },
        kicker(story, ctx),
        h('h1', { class: 'hp-lead-title', '--k': titleScale(story.title) }, kit.typo(story.title)),
        lead.summary ? kit.prose(ctx, lead.summary, 'hp-lead-summary') : null,
        lead.points.map(p => kit.prose(ctx, p, 'hp-point')),
      ),
      related.length ? h('ul', { class: 'hp-related' },
        related.map(item => kit.spare(h('li', { dataset: { id: item.story.id } },
          kicker(item.story, ctx),
          h('h2', { class: 'hp-related-title' }, kit.typo(item.story.title)),
          item.summary ? kit.prose(ctx, item.summary, 'hp-summary') : null,
        ), item))) : null,
    ),
    lead.picture ? kit.photo(ctx, lead.picture, ctx.screen.width * 0.42, { cls: 'hp-lead-photo' }) : null,
    more.length ? moreColumn(more, ctx) : null,
  );
}

// Ultrawide only: the front page continues.
function moreColumn(items, ctx) {
  const { h } = ctx;
  return h('div', { class: 'hp-more' },
    h('h3', { class: 'hp-label' }, ctx.t.moreNews),
    card(items[0], ctx),
    h('ul', { class: 'hp-list' }, items.slice(1).map(item => listItem(item, ctx))),
  );
}

// `live`: the live stories among the related headlines, in at their time as
// headlines alone, hidden; layout() shows those the lead had no room for, so
// that a running liveblog the lead drops is not lost with it.
function latestRail(items, live, ctx) {
  const { h } = ctx;
  const all = [...items, ...live.map(item => ({ ...item, summary: null, spare: true, twin: item.story.id }))]
    .sort((a, b) => (b.story.time ?? 0) - (a.story.time ?? 0));
  return h('aside', { class: 'hp-rail' },
    h('h3', { class: 'hp-label' }, ctx.t.justIn),
    h('ol', { class: 'hp-latest' },
      all.map(item => kit.spare(h('li', { dataset: item.twin ? { twin: item.twin } : null },
        h('time', null, ctx.time(item.story.time)),
        headline(item.story, ctx),
        item.summary ? kit.prose(ctx, item.summary, 'hp-summary') : null,
      ), item)),
    ),
  );
}

function sectionRow(blocks, ctx) {
  const { h } = ctx;
  return h('div', { class: 'hp-sections' },
    blocks.map(block =>
      h('section', { class: 'hp-section' },
        h('h3', { class: 'hp-label' }, block.name),
        card(block.items[0], ctx),
        h('ul', { class: 'hp-list' }, block.items.slice(1).map(item => listItem(item, ctx))),
      )),
  );
}

function footer(data, ctx) {
  const { h } = ctx;
  return h('footer', { class: 'hp-foot kit-page' },
    h('span', { class: 'hp-foot-mark' }, ctx.t.nameplate),
    h('span', { class: 'hp-foot-note' }, `${ctx.t.allStories}: ${data.source?.name ?? 'VRT NWS'}`),
  );
}

// --- pieces -----------------------------------------------------------------

// A story with its thumbnail, if it has a picture, beside its headline. A
// video gets its play mark on the thumbnail instead of in front of the headline.
function card(item, ctx) {
  const { h } = ctx;
  const { story, picture } = item;
  const video = picture && story.kind === 'video';
  return h('article', { class: `hp-card${picture ? '' : ' no-photo'}` },
    picture ? kit.photo(ctx, picture, ctx.screen.width * 0.1, { cls: `hp-thumb${video ? ' is-video' : ''}` }) : null,
    h('h4', { class: 'hp-card-title' }, marks(story, ctx, !video), kit.typo(story.title)),
    item.summary ? kit.prose(ctx, item.summary, 'hp-summary') : null,
  );
}

function listItem(item, ctx) {
  return kit.spare(ctx.h('li', null,
    headline(item.story, ctx),
    item.summary ? kit.prose(ctx, item.summary, 'hp-summary') : null,
  ), item);
}

// Headline with its small marks (Nieuw, LIVE, play) set inline in front.
function headline(story, ctx) {
  return ctx.h('h4', { class: 'hp-headline' }, marks(story, ctx), kit.typo(story.title));
}

// Kicker line over a top story: marks, then VRT's tag ("Europa").
function kicker(story, ctx) {
  const m = marks(story, ctx);
  if (!m.length && !story.section) return null;
  return ctx.h('p', { class: 'hp-kicker' }, m, story.section ? ctx.h('span', null, story.section) : null);
}

function marks(story, ctx, play = true) {
  const { h } = ctx;
  return [
    ctx.fresh.has(story.id) ? h('span', { class: 'hp-mark hp-new' }, ctx.t.new) : null,
    story.live ? h('span', { class: 'hp-mark hp-live' }, ctx.t.live) : null,
    play && story.kind === 'video' ? h('span', { class: 'hp-mark hp-play', 'aria-label': ctx.t.video }) : null,
  ].filter(Boolean);
}

// --- data helpers -------------------------------------------------------------

// Stand-ins when sections are missing: later top stories grouped by their
// section, as many to a group as a section shows.
function topicGroups(items, ctx) {
  const groups = new Map();
  for (const item of items) {
    const name = item.story.section || ctx.t.moreNews;
    if (!groups.has(name)) groups.set(name, { name, items: [] });
    groups.get(name).items.push(item);
  }
  const per = kit.at(ctx, REGIONS.sections.stories);
  return [...groups.values()].filter(g => g.items.length >= 2).map(g => ({ ...g, items: g.items.slice(0, per) }));
}

// Long headlines (VRT's run to 140 characters) set a size smaller.
function titleScale(title) {
  return title.length > 105 ? 0.8 : title.length > 75 ? 0.9 : 1;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
