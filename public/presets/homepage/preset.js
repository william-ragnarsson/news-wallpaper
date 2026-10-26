// Homepage: VRT NWS's front page set as the homepage of a quality news site.
// White page, black serif headlines, sans labels and times, thin grey rules.
//
// Page anatomy, on a 12-column grid (15 on an ultrawide):
//   top bar    wordmark (NAMEPLATE) left, date centre, update time and source
//              right; under it a static row of section labels
//   lead row   the lead story (kicker, headline, summary) with the next top
//              stories as related headlines under it, the lead photo beside it;
//              an ultrawide adds a column with more top stories
//   rail       "Net binnen": the newest stories with their time, full height
//   sections   one block per section: label, a story with thumbnail, headlines
//   footer     a quiet band that the Dock sits on
//
// Type scales with the short side of the screen (cqmin). layout() hides whole
// stories that do not fit their region; it starts from everything visible each
// time, so it can run again when the web fonts land.

const NAMEPLATE = 'Het Nieuws';

// Section blocks in this order; the screen shows as many as it has columns for.
const SECTION_ORDER = ['binnenland', 'buitenland', 'sport', 'economie', 'politiek', 'cultuur', 'wetenschap'];
const RELATED = 4; // top stories listed under the lead, as many as fit
const MORE = 6; // top stories in the ultrawide column
const LATEST = 12; // most items in "Net binnen"
const PER_SECTION = 4; // one with a thumbnail, then headlines

export default {
  id: 'homepage',
  name: 'Homepage',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const top = data.top ?? [];
    const sections = orderSections(data.sections ?? []);
    const rest = top.slice(1 + RELATED + MORE);
    // The lead already fills the page; do not repeat it in "Net binnen".
    const latest = (data.latest ?? []).filter(s => s.id !== top[0]?.id);

    root.setAttribute('lang', 'nl');
    root.append(
      topBar(data, sections, ctx),
      h('main', { class: 'hp-main' },
        leadPackage(top, ctx),
        latestRail(latest, ctx),
        sectionRow([...sections, ...topicGroups(rest)], ctx),
      ),
      footer(ctx),
    );
  },

  layout(root) {
    for (const region of root.querySelectorAll('.hp-fit')) fit(region);
  },
};

// --- regions ----------------------------------------------------------------

function topBar(data, sections, ctx) {
  const { h } = ctx;
  const updated = Date.parse(data.generatedAt);
  return h('header', { class: 'hp-top' },
    h('div', { class: 'hp-mast' },
      h('div', { class: 'hp-wordmark' }, NAMEPLATE),
      h('div', { class: 'hp-date' }, capitalise(ctx.date(ctx.now, 'long'))),
      h('div', { class: 'hp-meta' },
        Number.isFinite(updated) ? `Bijgewerkt ${ctx.time(updated)} · ` : '',
        `Bron: ${data.source?.name ?? 'VRT NWS'}`,
      ),
    ),
    h('nav', { class: 'hp-nav' },
      h('span', { class: 'is-current' }, 'Voorpagina'),
      sections.map(s => h('span', null, s.name)),
    ),
  );
}

function leadPackage(top, ctx) {
  const { h } = ctx;
  const lead = top[0];
  if (!lead) return h('section', { class: 'hp-lead is-empty' });
  const photo = lead.image ? ctx.image(lead.image, ctx.screen.width * 0.42) : '';

  return h('section', { class: `hp-lead${photo ? '' : ' no-photo'}` },
    h('div', { class: 'hp-lead-text hp-fit' },
      h('article', { class: 'hp-lead-story' },
        kicker(lead, ctx),
        h('h1', { class: 'hp-lead-title', '--k': titleScale(lead.title) }, lead.title),
        lead.summary ? h('p', { class: 'hp-lead-summary hp-drop' }, lead.summary) : null,
      ),
      h('ul', { class: 'hp-related' },
        top.slice(1, 1 + RELATED).map(story =>
          h('li', { class: 'hp-drop' }, kicker(story, ctx), h('h2', { class: 'hp-related-title' }, story.title))),
      ),
    ),
    photo ? h('figure', { class: 'hp-lead-photo' }, h('img', { src: photo, alt: lead.image.alt || '' })) : null,
    moreColumn(top.slice(1 + RELATED, 1 + RELATED + MORE), ctx),
  );
}

// Ultrawide only (CSS hides it elsewhere): the front page continues.
function moreColumn(stories, ctx) {
  const { h } = ctx;
  if (!stories.length) return null;
  return h('div', { class: 'hp-more hp-fit' },
    h('h3', { class: 'hp-label' }, 'Meer nieuws'),
    card(stories[0], ctx),
    h('ul', { class: 'hp-list' }, stories.slice(1).map(s => h('li', { class: 'hp-drop' }, headline(s, ctx)))),
  );
}

function latestRail(latest, ctx) {
  const { h } = ctx;
  return h('aside', { class: 'hp-rail' },
    h('h3', { class: 'hp-label' }, 'Net binnen'),
    h('ol', { class: 'hp-latest hp-fit' },
      latest.slice(0, LATEST).map(story =>
        h('li', { class: 'hp-drop' },
          h('time', null, ctx.time(story.time)),
          headline(story, ctx),
        )),
    ),
  );
}

function sectionRow(blocks, ctx) {
  const { h } = ctx;
  return h('div', { class: 'hp-sections' },
    blocks.filter(b => b.stories?.length).map(block =>
      h('section', { class: 'hp-section hp-fit' },
        h('h3', { class: 'hp-label' }, block.name),
        card(block.stories[0], ctx),
        h('ul', { class: 'hp-list' },
          block.stories.slice(1, PER_SECTION).map(s => h('li', { class: 'hp-drop' }, headline(s, ctx)))),
      )),
  );
}

function footer(ctx) {
  const { h } = ctx;
  return h('footer', { class: 'hp-foot' },
    h('span', { class: 'hp-foot-mark' }, NAMEPLATE),
    h('span', { class: 'hp-foot-note' }, 'Alle berichten: VRT NWS'),
  );
}

// --- pieces -----------------------------------------------------------------

// A story with a thumbnail beside its headline. A video gets its play mark on
// the thumbnail instead of in front of the headline.
function card(story, ctx) {
  const { h } = ctx;
  const src = story.image ? ctx.image(story.image, ctx.screen.width * 0.1) : '';
  const video = src && story.kind === 'video';
  return h('article', { class: `hp-card${src ? '' : ' no-photo'}` },
    src ? h('figure', { class: `hp-thumb${video ? ' is-video' : ''}` }, h('img', { src, alt: story.image.alt || '' })) : null,
    h('h4', { class: 'hp-card-title' }, marks(story, ctx, !video), story.title),
  );
}

// Headline with its small marks (Nieuw, LIVE, play) set inline in front.
function headline(story, ctx) {
  return ctx.h('h4', { class: 'hp-headline' }, marks(story, ctx), story.title);
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
    ctx.fresh.has(story.id) ? h('span', { class: 'hp-mark hp-new' }, 'Nieuw') : null,
    story.kind === 'liveblog' && story.live ? h('span', { class: 'hp-mark hp-live' }, 'Live') : null,
    play && story.kind === 'video' ? h('span', { class: 'hp-mark hp-play', 'aria-label': 'Video' }) : null,
  ].filter(Boolean);
}

// --- data helpers -------------------------------------------------------------

function orderSections(sections) {
  const rank = s => (SECTION_ORDER.indexOf(s.id) + 1 || 99);
  return sections.filter(s => s.stories?.length).sort((a, b) => rank(a) - rank(b));
}

// Stand-ins when sections are missing: later top stories grouped by VRT's tag.
function topicGroups(stories) {
  const groups = new Map();
  for (const s of stories) {
    const name = s.section || 'Meer nieuws';
    if (!groups.has(name)) groups.set(name, { name, stories: [] });
    groups.get(name).stories.push(s);
  }
  return [...groups.values()].filter(g => g.stories.length >= 2);
}

// Long headlines (VRT's run to 140 characters) set a size smaller.
function titleScale(title) {
  return title.length > 105 ? 0.8 : title.length > 75 ? 0.9 : 1;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --- fitting ------------------------------------------------------------------

// Show every droppable item again, then hide the last ones until the region fits.
function fit(region) {
  const items = [...region.querySelectorAll('.hp-drop')];
  for (const el of items) el.hidden = false;
  while (items.length && region.scrollHeight > region.clientHeight + 1) items.pop().hidden = true;
}
