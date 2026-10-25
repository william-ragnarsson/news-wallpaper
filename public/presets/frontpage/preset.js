// Front Page: every live liveblog side by side on a strict Swiss grid.
//
// The screen is divided into equal grid units. The focus liveblog spans two
// units, every other live liveblog gets one. How many units fit depends on the
// screen width (a column never gets narrower than MIN_UNIT), so a 3440 px
// ultrawide shows more stories than a 13" laptop; whole columns are dropped,
// never squashed. Ended liveblogs only fill spare units, after every live one,
// and are set in grey with an "Afgelopen" label. Spare units after that become
// a headlines rail. A band of headlines runs along the bottom when it fits.
//
// Every column shares four rows (CSS subgrid), so rules line up across the
// page: heading, activity meter, the newest posts, and a coda (the focus shows
// two more posts there, the others their background and running time).

const WINDOW_MS = 3 * 60 * 60 * 1000;
const MARGIN = 3; // page margin, in --u
const GUTTER = 1.6; // column gap, in --u
const MIN_UNIT = 16; // narrowest column, in --u
const MIN_SCALE = 12; // the activity meter shows at least 12 cells

export default {
  id: 'frontpage',
  name: 'Front Page',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const now = ctx.now.getTime();
    const u = unit(ctx.screen);
    const contentW = ctx.screen.width - 2 * MARGIN * u;
    const units = Math.max(3, Math.floor((contentW + GUTTER * u) / ((MIN_UNIT + GUTTER) * u)));
    const colPx = (contentW - (units - 1) * GUTTER * u) / units;

    // --- what goes on the grid ----------------------------------------------
    const blogs = data.liveblogs ?? [];
    const meta = blogs.find(b => b.id === data.focus.id) ?? {};
    const focus = { ...meta, ...data.focus };
    const posts = data.focus.posts ?? [];
    focus.postsInWindow = meta.postsInWindow ?? posts.filter(p => now - p.timestamp < WINDOW_MS).length;
    const focusLive = focus.status === 'live';

    const others = blogs.filter(b => b.id !== focus.id);
    const live = others.filter(b => b.status === 'live');
    const ended = others.filter(b => b.status !== 'live');

    const headlines = (data.headlines ?? []).filter(a => a.title);
    const bandItems = headlines.slice(0, units - 1);
    const railPool = headlines.slice(bandItems.length);

    // Live liveblogs first; spare units go to ended ones (keeping one for a
    // headlines rail), then rails, then a wider focus.
    let span = 2;
    let free = units - span;
    const liveCols = live.slice(0, free);
    free -= liveCols.length;
    const endedCols = ended.slice(0, free >= 2 ? free - 1 : free);
    free -= endedCols.length;
    let rails = Math.min(2, free);
    free -= rails;
    const grow = Math.min(2, free);
    span += grow;
    rails += free - grow;
    while (rails > 0 && railPool.length < rails * 2) { rails -= 1; span += 1; }

    const liveOff = live.slice(liveCols.length);
    const endedOff = ended.filter(b => !endedCols.includes(b));
    const liveCount = blogs.filter(b => b.status === 'live').length;
    const endedCount = blogs.length - liveCount;
    const scale = Math.max(MIN_SCALE, focus.postsInWindow ?? 0, ...liveCols.map(b => b.postsInWindow ?? 0));

    // --- pieces -------------------------------------------------------------
    const pulseDelay = `${-(now % 6000)}ms`;
    const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
    const dayLabel = ts => {
      const d = new Date(ts);
      const label = ctx.date(ts, 'daymonth');
      return d.getFullYear() === new Date(now).getFullYear() ? label : `${label} ${d.getFullYear()}`;
    };

    const kicker = (index, blog, pulse) => h('p', { class: 'fp-kicker' },
      h('span', { class: 'fp-index' }, String(index).padStart(2, '0')),
      blog.status === 'live'
        ? h('span', { class: 'fp-status fp-status--live' },
          h('i', { class: pulse ? 'fp-dot fp-dot--pulse' : 'fp-dot', style: pulse ? { animationDelay: pulseDelay } : null }),
          'Live')
        : h('span', { class: 'fp-status fp-status--ended' }, h('i', { class: 'fp-dot' }), 'Afgelopen'),
      blog.section ? h('span', { class: 'fp-section' }, blog.section) : null,
    );

    const head = (index, blog, pulse) => h('header', { class: 'fp-head' },
      kicker(index, blog, pulse),
      h('h2', { class: 'fp-topic' }, blog.topic || blog.title),
    );

    // Big number + one cell per update in the last three hours.
    const gauge = (blog, isFocus) => {
      if (blog.status !== 'live') {
        return h('div', { class: 'fp-gauge fp-gauge--ended' },
          h('span', { class: 'fp-count' }, String(blog.postCount ?? 0)),
          h('span', { class: 'fp-count-label' }, blog.postCount === 1 ? 'bericht' : 'berichten', h('br'), 'in totaal'),
        );
      }
      const n = blog.postsInWindow ?? 0;
      return h('div', { class: `fp-gauge${n === 0 ? ' fp-gauge--quiet' : ''}` },
        h('span', { class: 'fp-count' }, String(n)),
        h('span', { class: 'fp-count-label' }, n === 1 ? 'update' : 'updates', h('br'), 'in 3 uur'),
        h('span', { class: 'fp-track', '--scale': scale },
          Array.from({ length: scale }, (_, i) => h('i', { class: i < n ? (isFocus ? 'is-on is-red' : 'is-on') : null }))),
      );
    };

    // Running time of the liveblog, set like the masthead cells.
    const facts = blog => {
      if (blog.status !== 'live') {
        const end = blog.updatedAt;
        return h('p', { class: 'fp-facts' },
          h('b', null, `Afgelopen ${sameDay(end, now) ? ctx.time(end) : dayLabel(end)}`),
          blog.startedAt ? h('span', null, `gestart ${dayLabel(blog.startedAt)}`) : null);
      }
      const start = blog.startedAt;
      const since = !start ? null : sameDay(start, now) ? `Sinds ${ctx.time(start)}` : `Sinds ${dayLabel(start)}`;
      const total = blog.postCount ?? 0;
      return h('p', { class: 'fp-facts' },
        since ? h('b', null, since) : null,
        h('span', null, `${total} ${total === 1 ? 'bericht' : 'berichten'} in totaal`));
    };

    const stamp = (post, isFocus) => h('p', { class: `fp-stamp${isFocus ? ' fp-stamp--focus' : ''}` },
      ctx.fresh.has(post.id) ? h('span', { class: 'fp-new' }, 'Nieuw') : null,
      h('time', null, ctx.time(post.timestamp)),
      h('span', { class: 'fp-ago' }, ctx.ago(post.timestamp, now)),
    );

    const item = (post, rank) => {
      const lead = postLead(post);
      return h('li', {
        class: `fp-item${ctx.fresh.has(post.id) ? ' is-fresh' : ''}`,
        'data-drop': rank,
      },
      h('time', null, ctx.time(post.timestamp)),
      h('span', { class: `fp-item-title${lead.untitled ? ' is-untitled' : ''}` }, lead.title),
      );
    };
    // Posts with nothing to show as a line are left out of the lists.
    const listable = list => (list ?? []).filter(p => postTitle(p));

    const lengthClass = (text, [m, l]) => (text.length > l ? ' is-long' : text.length > m ? ' is-medium' : '');

    // --- focus column -------------------------------------------------------
    const newest = posts[0];
    const focusLead = postLead(newest);
    const focusTitle = focusLead.title || focus.title || focus.topic || '';
    const focusUntitled = Boolean(focusLead.title) && focusLead.untitled;
    // Only a landscape picture survives the wide, shallow crop; portrait
    // phone videos and sensitive images are skipped.
    const photo = [focus.image, ...posts.map(p => p.image)]
      .find(img => usableImage(img) && isLandscape(img)) ?? null;
    const intro = cleanIntro(focus.intro);
    const morePosts = listable(posts.slice(1)).slice(0, span * (photo ? 1 : 4));
    const moreList = morePosts.length
      ? h('ol', { class: 'fp-more' },
        // Without a photo the list fills the body in rows of `span`; rows go
        // from the bottom when space runs out (ranks 0, 1, 3, then 5).
        morePosts.map((p, i) => item(p, photo ? null : [5, 3, 1, 0][Math.floor(i / span)])))
      : null;

    const focusCol = h('article', {
      class: `fp-col fp-col--focus${focusLive ? '' : ' is-ended'}`,
      '--span': span,
    },
    head(1, focus, focusLive),
    h('div', { class: 'fp-meter' }, gauge(focus, true), facts(focus)),
    // Without a photo there is no focus coda, so the posts run on into that row.
    h('div', { class: `fp-body${photo ? '' : ' fp-body--tall'}` },
      newest ? stamp(newest, true) : null,
      h('h3', {
        class: `fp-latest fp-latest--focus${lengthClass(focusTitle, [70, 110])}${focusUntitled ? ' is-untitled' : ''}${newest && ctx.fresh.has(newest.id) ? ' is-fresh' : ''}`,
      }, focusTitle),
      intro ? h('p', { class: 'fp-standfirst', 'data-drop': 2 }, intro) : null,
      photo ? h('figure', { class: 'fp-photo', 'data-drop': 3 },
        h('img', { src: ctx.image(photo, colPx * span + GUTTER * u * (span - 1)), alt: photo.alt || '', decoding: 'async' }),
        photo.caption || photo.credit
          ? h('figcaption', null, [photo.caption, photo.credit].filter(Boolean).join(' '))
          : null,
      ) : moreList,
    ),
    photo ? h('div', { class: 'fp-coda fp-coda--focus' }, moreList) : null,
    );

    // --- other columns ------------------------------------------------------
    const otherCols = [...liveCols, ...endedCols].map((blog, i) => {
      const [latest, ...older] = blog.recent ?? [];
      const lead = postLead(latest);
      const title = lead.title || blog.title || blog.topic || '';
      const untitled = Boolean(lead.title) && lead.untitled;
      const fresh = latest && ctx.fresh.has(latest.id) ? ' is-fresh' : '';
      const rest = listable(older).slice(0, 2);
      const background = cleanIntro(blog.intro);
      const isEnded = blog.status !== 'live';
      return h('article', { class: `fp-col${isEnded ? ' is-ended' : ''}` },
        head(i + 2, blog, false),
        h('div', { class: 'fp-meter' }, gauge(blog, false)),
        h('div', { class: 'fp-body' },
          latest ? stamp(latest, false) : null,
          h('h3', { class: `fp-latest${lengthClass(title, [80, 115])}${untitled ? ' is-untitled' : ''}${fresh}` }, title),
          // The newest post's own text, shown in whatever room is left over
          // (layout() opens it up line by line).
          lead.title && lead.rest ? h('p', { class: `fp-excerpt${fresh}`, hidden: true }, lead.rest) : null,
          rest.length ? h('ol', { class: 'fp-recent' }, rest.map((p, j) => item(p, j === 0 ? 4 : 3))) : null,
        ),
        h('footer', { class: 'fp-coda' },
          facts(blog),
          background ? h('p', { class: 'fp-intro' }, background) : null,
        ),
      );
    });

    // --- headline rails -----------------------------------------------------
    const per = Math.ceil(railPool.length / Math.max(1, rails));
    const railCols = Array.from({ length: rails }, (_, r) => h('aside', { class: 'fp-col fp-rail' },
      h('header', { class: 'fp-head' },
        h('p', { class: 'fp-kicker' }, h('span', { class: 'fp-section' }, r === 0 ? 'Andere artikels' : 'Verder')),
        h('h2', { class: 'fp-topic' }, r === 0 ? 'Meer nieuws' : 'Ook gemeld'),
      ),
      h('ol', { class: 'fp-rail-list' }, railPool.slice(r * per, (r + 1) * per).map(a => headline(h, ctx, a, 'li'))),
    ));

    // --- page ---------------------------------------------------------------
    const [weekday, ...restDate] = ctx.date(now, 'long').split(' ');
    const updated = data.generatedAt ? Date.parse(data.generatedAt) : now;
    const source = data.source?.name ?? 'VRT NWS';

    // The masthead keeps two units for its cells even when the focus is wider.
    const mastSpan = Math.min(span, units - 2);

    root.append(h('div', { class: 'fp-page', '--units': units },
      h('header', { class: 'fp-mast', '--span': mastSpan },
        h('h1', { class: 'fp-mast-title' }, h('i', { class: 'fp-mast-mark' }), focusLive && liveCount ? 'Nu live' : 'Liveblogs'),
        h('p', { class: 'fp-mast-cell', style: { gridColumn: String(mastSpan + 1) } },
          h('b', null, capitalise(weekday)), h('span', null, restDate.join(' '))),
        units - mastSpan >= 3 ? h('p', { class: 'fp-mast-cell', style: { gridColumn: String(mastSpan + 2) } },
          h('b', null, liveCount === 1 ? '1 liveblog live' : `${liveCount} liveblogs live`),
          h('span', null, endedCount ? `${endedCount} afgelopen` : 'geen afgelopen')) : null,
        h('p', { class: 'fp-mast-cell', style: { gridColumn: String(units) } },
          h('b', null, `Bijgewerkt ${ctx.time(updated)}`), h('span', null, `Bron: ${source}`)),
      ),
      h('main', { class: 'fp-grid' }, focusCol, otherCols, railCols),
      bandItems.length ? h('section', { class: 'fp-band' },
        h('h2', { class: 'fp-band-label' }, 'Ook in', h('br'), 'het nieuws'),
        bandItems.map(a => headline(h, ctx, a, 'article')),
      ) : null,
      h('footer', { class: 'fp-footer' },
        offList(h, 'Ook live', liveOff.map(b => [b.topic || b.title]), 'fp-footer-left'),
        offList(h, 'Afgelopen', endedOff.map(b => [b.topic || b.title, sameDay(b.updatedAt, now) ? ctx.time(b.updatedAt) : ctx.date(b.updatedAt, 'short')]), 'fp-footer-right'),
      ),
    ));
  },

  layout(root, ctx) {
    const page = root.querySelector('.fp-page');
    if (!page) return;
    const grid = page.querySelector('.fp-grid');
    const band = page.querySelector('.fp-band');
    const bodies = [...grid.querySelectorAll('.fp-col:not(.fp-rail) .fp-body')];
    const intros = [...grid.querySelectorAll('.fp-intro')];
    const excerpts = [...grid.querySelectorAll('.fp-excerpt')];
    const codas = [...grid.querySelectorAll('.fp-coda')];
    const u = unit(ctx.screen);
    const minPhoto = 7 * u;

    const drop = el => { el.hidden = true; el.dataset.dropped = ''; };
    const overflows = el => el.scrollHeight > el.clientHeight + 1;
    const photoTooSmall = body => {
      const img = body.querySelector('.fp-photo:not([hidden]) img');
      return img ? img.offsetHeight < minPhoto : false;
    };
    const needsRoom = body => overflows(body) || photoTooSmall(body);
    const anyNeedsRoom = () => overflows(grid) || bodies.some(needsRoom);
    const dropRank = rank => {
      for (const body of bodies) {
        if (!needsRoom(body)) continue;
        body.querySelectorAll(`[data-drop="${rank}"]:not([hidden])`).forEach(drop);
      }
    };
    const setLines = (el, n) => { el.style.setProperty('--lines', n); el.dataset.clamped = ''; };
    const reset = () => {
      page.querySelectorAll('[data-dropped]').forEach(el => { el.hidden = false; delete el.dataset.dropped; });
      page.querySelectorAll('[data-clamped]').forEach(el => { el.style.removeProperty('--lines'); delete el.dataset.clamped; });
      excerpts.forEach(el => { el.hidden = true; });
    };

    const fit = withBand => {
      reset();
      if (band && !withBand) drop(band);
      // A fourth row of focus posts only takes room nothing else wants.
      dropRank(0);
      // The coda row is shared by every column, so background intros shrink
      // together (4 lines, then 3, 2) and go together.
      for (let lines = 3; lines >= 2 && intros.length && anyNeedsRoom(); lines -= 1) {
        intros.forEach(el => setLines(el, lines));
      }
      dropRank(1);
      if (anyNeedsRoom()) intros.forEach(drop);
      dropRank(2);
      dropRank(3);
      if (withBand && anyNeedsRoom()) return false;
      dropRank(4);
      dropRank(5);
      if (anyNeedsRoom()) codas.forEach(drop);
      relaxIntros();
      // Last resort: fewer lines for the newest title in a column.
      for (const body of bodies) {
        const title = body.querySelector('.fp-latest');
        if (!title) continue;
        let lines = parseInt(getComputedStyle(title).webkitLineClamp, 10) || 6;
        while (overflows(body) && lines > 2) setLines(title, --lines);
      }
      return true;
    };
    // Drops are greedy, so hand the intros back whatever room they freed:
    // bring them back if they went, then let them grow to their full 4 lines.
    const relaxIntros = () => {
      if (!intros.length || codas.some(el => el.hidden)) return;
      const lines = () => Number(intros[0].style.getPropertyValue('--lines')) || 4;
      if (intros[0].hidden) {
        intros.forEach(el => { el.hidden = false; delete el.dataset.dropped; setLines(el, 2); });
        if (anyNeedsRoom()) { intros.forEach(drop); return; }
      }
      for (let n = lines() + 1; n <= 4; n += 1) {
        intros.forEach(el => setLines(el, n));
        if (anyNeedsRoom()) { intros.forEach(el => setLines(el, n - 1)); return; }
      }
    };
    if (!fit(true)) fit(false);

    // Whatever room a column has left goes to the newest post's own text:
    // two lines at least, then a line at a time while the column still fits.
    for (const el of excerpts) {
      const body = el.parentElement;
      el.hidden = false;
      setLines(el, 2);
      if (overflows(body)) { el.hidden = true; continue; }
      for (let n = 3; n <= 9 && el.scrollHeight > el.clientHeight + 1; n += 1) {
        setLines(el, n);
        if (overflows(body)) { setLines(el, n - 1); break; }
      }
    }

    // Rails: drop whole headlines from the bottom until the list fits.
    for (const list of grid.querySelectorAll('.fp-rail-list')) {
      const items = [...list.children];
      while (overflows(list) && items.length) drop(items.pop());
    }

    // Footer notes sit beside the Dock: drop names from the end, count them.
    // The first name always stays, shortened with an ellipsis if need be.
    for (const note of page.querySelectorAll('.fp-off')) {
      const names = [...note.querySelectorAll('.fp-off-name')];
      const more = note.querySelector('.fp-off-more');
      more.hidden = true;
      note.classList.remove('is-squeezed');
      let hiddenCount = 0;
      while (note.scrollWidth > note.clientWidth + 1 && names.length > 1) {
        drop(names.pop());
        hiddenCount += 1;
        more.textContent = `+${hiddenCount}`;
        more.hidden = false;
      }
      if (note.scrollWidth > note.clientWidth + 1) note.classList.add('is-squeezed');
    }
  },
};

// One grid unit in px; mirrors --u in preset.css.
function unit(screen) {
  return Math.min(screen.width / 100, (1.6 * screen.height) / 100);
}

// The feed is ordered by last update, so that is the time shown.
function headline(h, ctx, a, tag) {
  const ts = a.updatedAt ?? a.publishedAt;
  return h(tag, { class: 'fp-hl' },
    ts || a.section ? h('p', { class: 'fp-hl-kicker' },
      ts ? h('time', null, ctx.time(ts)) : null,
      a.section ? h('span', null, a.section) : null) : null,
    h('h3', { class: 'fp-hl-title' }, a.title),
  );
}

// names: [[name, time?]]. The time is kept whole when a long name is shortened.
function offList(h, label, names, cls) {
  if (!names.length) return h('p', { class: cls });
  return h('p', { class: `fp-off ${cls}` },
    h('b', null, label),
    names.map(([name, time], i) => h('span', { class: 'fp-off-name' },
      i ? ', ' : null,
      h('span', { class: 'fp-off-text' }, name),
      time ? h('span', { class: 'fp-off-time' }, time) : null)),
    h('span', { class: 'fp-off-more', hidden: true }),
  );
}

// What a post leads with: its title, else the first sentence of its text, else
// a quote, embed, teaser or caption. `rest` is the text that follows it.
function postLead(post) {
  if (!post) return { title: '', untitled: false, rest: '' };
  const title = clean(post.title);
  const paras = (post.paragraphs ?? []).map(clean).filter(Boolean);
  const other = blockText(post);
  if (title) return { title, untitled: false, rest: joinParas(paras) || other };
  if (paras.length) {
    const first = firstSentence(paras[0]);
    return { title: first, untitled: true, rest: joinParas([paras[0].slice(first.length).trim(), ...paras.slice(1)]) };
  }
  return { title: other, untitled: true, rest: '' };
}

function postTitle(post) {
  return postLead(post).title;
}

function blockText(post) {
  for (const b of post.blocks ?? []) {
    const text = b.type === 'quote' ? clean(b.text)
      : b.type === 'embed' ? clean(b.title) || clean(b.text)
        : b.type === 'teaser' || b.type === 'audio' ? clean(b.title)
          : b.type === 'image' ? clean(b.image?.caption)
            : '';
    if (!text) continue;
    if (b.type !== 'quote') return text;
    return b.by ? `${clean(b.by)}: “${text}”` : `“${text}”`;
  }
  return clean(post.image?.caption);
}

function clean(text) {
  return String(text ?? '').replace(/^•\s*/, '').replace(/\s+/g, ' ').trim();
}

// List items have no closing stop; keep them apart with a middle dot.
function joinParas(paras) {
  return paras.filter(Boolean).reduce((all, p) => (!all ? p : `${all}${/[.!?…:;"”’')]$/.test(all) ? ' ' : ' · '}${p}`), '');
}

function firstSentence(text) {
  const m = text.match(/^.{24,}?[.!?…]["”’']?(?=\s+["“‘'(]?[A-ZÀ-Þ0-9])/);
  return m ? m[0] : text;
}

function usableImage(img) {
  return img && img.url && !img.sensitive ? img : null;
}

function isLandscape(img) {
  const [w, hgt] = String(img.ratio ?? '16/9').split('/').map(Number);
  return !hgt || w / hgt >= 1.2;
}

// Drop the boilerplate "Volg alle updates in onze liveblog." sentence.
function cleanIntro(text) {
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+["”’']?\s*|[^.!?]+$/g) ?? [text];
  return sentences
    .filter(s => !/^\s*volg\b/i.test(s) && !/\bliveblog\b/i.test(s))
    .join('')
    .trim();
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
