// Evening Edition: the provider's front page set as a newspaper in dark ink.
//
//   date ·············· HET NIEUWS ·············· bijgewerkt · bron
//   ══════════════════════════════════════════════════════════════════
//   lead photo, about half the width   │ secondary story   [thumb]
//                                      │ secondary story   [thumb]
//   lead headline, summary             │ secondary story   [thumb]
//   ──────────────────────────────────────────────────────────────────
//   brief │ brief │ brief │ brief │ brief         (headlines only)
//   ──────────────────────────────────────────────────────────────────
//   LIVE  running liveblogs, one line
//
// Stories keep the front page's order: top[0] is the lead (the first liveblog
// picked on Customize, else VRT's own lead), then the side column, then the
// briefs. Column counts come from the screen (see columns()); type scales
// with cqmin in preset.css. layout() only drops what does not fit.

const SIDE_ROWS = 3;

export default {
  id: 'evening',
  name: 'Evening Edition',
  tone: 'dark',

  render(root, data, ctx) {
    const { h } = ctx;
    const cols = columns(ctx.screen);
    const top = (data.top?.length ? data.top : data.latest ?? []).filter(s => s?.title);
    const [lead, ...rest] = top;
    const side = rest.slice(0, cols.side * SIDE_ROWS);
    const briefs = rest.slice(side.length, side.length + cols.briefs);
    // A liveblog can reach us under two URLs (VRT renames the slug), so match
    // its number (storyKey) and the title too.
    const shown = new Set([lead, ...side, ...briefs].filter(Boolean).flatMap(s => [storyKey(s), s.title]));
    const live = (data.live ?? []).filter(s => s?.title && !shown.has(storyKey(s)) && !shown.has(s.title)).slice(0, cols.live);

    root.append(h('div', { class: `ev-page${cols.side > 1 ? ' is-wide' : ''}`, '--brief-cols': cols.briefs },
      masthead(data, ctx),
      h('main', { class: 'ev-main' },
        lead ? leadStory(lead, ctx, cols) : null,
        side.length ? sideColumn(side, ctx, cols) : null,
      ),
      briefs.length ? h('section', { class: 'ev-briefs' }, briefs.map(s => brief(s, ctx))) : null,
      live.length ? liveLine(live, ctx) : null,
    ));
  },

  layout(root) {
    // Fallback-font metrics would trim too much; the host lays out again once fonts land.
    if (document.fonts?.status === 'loading') return;

    // The lead photo needs real room: give up the summary before the picture.
    const lead = root.querySelector('.ev-lead');
    const photo = lead?.querySelector('.ev-photo');
    if (photo && photo.clientHeight < lead.clientHeight * 0.45) lead.querySelector('.ev-lead-summary')?.remove();

    // Side stories share their column in equal rows: drop summaries, then whole stories.
    for (const stack of root.querySelectorAll('.ev-stack')) {
      for (const story of stack.children) if (overflows(story)) story.querySelector('.ev-summary')?.remove();
      while (stack.children.length > 1 && [...stack.children].some(overflows)) stack.lastElementChild.remove();
    }
  },
};

// --- grid ------------------------------------------------------------------

// Ultrawide screens get a second side column. Type scales with the short side,
// so briefs get a column per ~34% of it (a measure of about 35 characters).
function columns({ width, height }) {
  const wide = width / height >= 2;
  const briefs = Math.min(6, Math.max(4, Math.floor(width / (Math.min(width, height) * 0.34))));
  return {
    side: wide ? 2 : 1,
    briefs,
    live: briefs - 1,
    leadPx: Math.round(width * (wide ? 0.42 : 0.52)),
    thumbPx: Math.round(width * (wide ? 0.1 : 0.17)),
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

function leadStory(story, ctx, cols) {
  const { h } = ctx;
  return h('article', { class: `ev-lead${story.image?.url ? '' : ' no-photo'}` },
    story.image?.url ? photo(story, ctx, cols.leadPx, 'ev-photo') : null,
    h('div', { class: 'ev-lead-text' },
      kicker(story, ctx),
      h('h2', { class: 'ev-lead-title' }, smart(story.title)),
      story.summary ? h('p', { class: 'ev-lead-summary' }, smart(story.summary)) : null,
    ),
  );
}

function sideColumn(stories, ctx, cols) {
  const { h } = ctx;
  const stacks = [];
  for (let i = 0; i < stories.length; i += SIDE_ROWS) stacks.push(stories.slice(i, i + SIDE_ROWS));
  return h('div', { class: 'ev-side' },
    stacks.map(group => h('div', { class: 'ev-stack' }, group.map(s => secondary(s, ctx, cols)))),
  );
}

function secondary(story, ctx, cols) {
  const { h } = ctx;
  return h('article', { class: `ev-second${story.image?.url ? '' : ' no-photo'}` },
    h('div', { class: 'ev-second-text' },
      kicker(story, ctx),
      h('h3', { class: 'ev-second-title' }, smart(story.title)),
      story.summary ? h('p', { class: 'ev-summary' }, smart(story.summary)) : null,
    ),
    story.image?.url ? photo(story, ctx, cols.thumbPx, 'ev-thumb') : null,
  );
}

function brief(story, ctx) {
  const { h } = ctx;
  return h('article', { class: 'ev-brief' },
    kicker(story, ctx, { time: !story.section }),
    h('h3', { class: 'ev-brief-title' }, smart(story.title)),
  );
}

function liveLine(stories, ctx) {
  const { h } = ctx;
  return h('footer', { class: 'ev-live' },
    h('span', { class: 'ev-tag is-live' }, ctx.t.live),
    stories.map(s => h('p', { class: 'ev-live-item' },
      s.section ? h('span', { class: 'ev-section' }, s.section) : null,
      smart(s.title),
    )),
  );
}

// --- pieces ----------------------------------------------------------------

function photo(story, ctx, px, cls) {
  const { h } = ctx;
  return h('figure', { class: cls },
    h('img', { src: ctx.image(story.image, px), alt: story.image.alt || '', decoding: 'sync' }),
  );
}

// One line of small labels: state, section, time (briefs: time only without a section).
function kicker(story, ctx, { time = true } = {}) {
  const { h } = ctx;
  const isLive = story.kind === 'liveblog' && story.live;
  return h('p', { class: 'ev-kicker' },
    isLive ? h('span', { class: 'ev-tag is-live' }, ctx.t.live) : null,
    ctx.fresh.has(story.id) ? h('span', { class: 'ev-tag is-new' }, ctx.t.new) : null,
    story.kind === 'video' ? h('span', { class: 'ev-tag is-video' }, `▶ ${duration(story.durationSec)}`) : null,
    story.section ? h('span', { class: 'ev-section' }, story.section) : null,
    time && story.time && !isLive ? h('span', { class: 'ev-time' }, stamp(story.time, ctx)) : null,
  );
}

// The ~number at the end of a story's URL, which stays when the slug changes.
function storyKey(s) {
  return s.id?.match(/~(\d+)\/?$/)?.[1] ?? s.id;
}

// Today: newsroom time (21u12). Older: VRT-style relative date.
function stamp(ts, ctx) {
  return ctx.date(ts, 'short') === ctx.date(ctx.now, 'short') ? ctx.time(ts) : ctx.ago(ts, ctx.now.getTime());
}

function duration(sec) {
  if (!sec) return 'Video';
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

// Typographer's quotes: "x" -> “x”, 'x' -> ‘x’, it's -> it’s.
function smart(text) {
  return String(text)
    .replace(/(^|[\s([—–-])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s([—–-])'/g, '$1‘').replace(/'/g, '’');
}

function overflows(el) {
  return el.scrollHeight > el.clientHeight + 1;
}
