// Wire: a dark newsroom wire feed. Timestamp first, dense but calm.
//
// The screen is cut into equal columns (more on wider screens). The newest post
// runs as a departures-board row across the feed columns with a photo at its
// end, a 12-hour activity strip separates it from the feed, and the earlier
// posts flow column to column, newest top-left. The right-hand column(s) carry
// the liveblog summary, the other liveblogs and other news.
// layout() pours the items into the columns and drops whatever does not fit.

const HOUR = 3_600_000;
const MIN_COL = 42; // narrowest column, in --u
const GAP = 3.2; // column gap, in --u
const GUTTER = 3.6; // outer margin, in --u

// Must match --u in preset.css.
function unit(height) {
  return Math.min(14, Math.max(9, 0.0062 * height + 3.2));
}

// `sideItems` is how much the side column(s) have to say. Without side content
// (or without a feed, when the side content takes over the feed columns) there
// is no side column; two only on wide grids with plenty to fill them.
function grid(ctx, sideItems) {
  const { width, height } = ctx.screen;
  const u = unit(height);
  const gutter = GUTTER * u;
  const gap = GAP * u;
  const n = Math.max(3, Math.floor((width - 2 * gutter + gap) / (MIN_COL * u + gap)));
  const side = !sideItems ? 0 : n >= 5 && sideItems >= 12 ? 2 : 1;
  const feed = n - side;
  const colW = (width - 2 * gutter - (n - 1) * gap) / n;
  // On the narrowest grid the lead band borrows the side column for its photo.
  // It never runs wider than four columns; feed columns beyond it start at the top.
  const leadCols = n === 3 ? 3 : Math.min(feed, 4);
  return { u, n, side, feed, colW, leadCols };
}

export default {
  id: 'wire',
  name: 'Wire',
  tone: 'dark',

  render(root, data, ctx) {
    const { h } = ctx;
    const focus = data.focus;
    const posts = (focus.posts ?? []).filter(p => p && Number.isFinite(p.timestamp));
    const live = focus.status === 'live';
    const lead = posts[0] ?? null;
    const today = dayKey(ctx.now);
    const nowMs = ctx.now.getTime();
    const blogTime = focus.updatedAt ?? lead?.timestamp ?? focus.startedAt ?? nowMs;
    // When the news was fetched, as opposed to when the liveblog last posted.
    const refreshed = Date.parse(data.generatedAt);

    const stamp = ts => {
      if (!Number.isFinite(ts)) return '';
      if (dayKey(ts) === today) return ctx.time(ts);
      if (dayKey(ts + 24 * HOUR) === today) return `gisteren ${ctx.time(ts)}`;
      return `${ctx.date(ts, 'short')} ${ctx.time(ts)}`;
    };
    const cell = (col, span, row, rowSpan = 1) => ({ gridColumn: `${col} / span ${span}`, gridRow: `${row} / span ${rowSpan}` });

    // Side content first: how much there is decides the grid.
    const points = (focus.summary?.points ?? []).filter(Boolean);
    const others = (data.liveblogs ?? []).filter(b => b && !b.isFocus && b.id !== focus.id);
    const news = (data.headlines ?? []).filter(a => a?.title);
    const noFeed = posts.length <= 1;
    const g = grid(ctx, noFeed ? 0 : points.length + others.length + news.length);

    // layout() sets these again; a fresh render starts from the lean version.
    root.dataset.cols = g.n;
    delete root.dataset.feedRich;
    delete root.dataset.sideRich;

    // --- header strip -------------------------------------------------------
    const count = focus.postCount ?? posts.length;
    const head = h('header', { class: 'w-head' },
      h('div', { class: cls('w-status', live ? 'is-live' : 'is-ended') }, h('i', { class: 'w-dot' }), h('span', null, live ? 'live' : 'afgelopen')),
      h('div', { class: 'w-topic' }, focus.topic || focus.title),
      h('div', { class: 'w-meta' }, h('b', null, String(count)), h('span', null, count === 1 ? 'bericht' : 'berichten')),
      Number.isNaN(refreshed) ? null : h('div', { class: 'w-meta' },
        h('span', null, 'bijgewerkt'),
        timeEl(h, ctx.time(refreshed), 'w-meta-time'),
      ),
      h('div', { class: 'w-fill' }),
      focus.startedAt ? h('div', { class: 'w-meta w-since' }, h('span', null, 'liveblog sinds'), h('b', null, ctx.date(focus.startedAt, 'short'))) : null,
      h('div', { class: 'w-credit' }, 'VRT NWS'),
    );

    const body = h('div', { class: 'w-body', style: { gridTemplateColumns: `repeat(${g.n}, minmax(0, 1fr))` } });

    // --- lead: newest post as a departures-board row --------------------------
    const fig = pickImage(lead, focus);
    const figSpan = fig ? 1 : 0;
    // The headline keeps at most two columns; a third column beside it (wide
    // screens, or no photo) carries the rest of the lead's text as a deck.
    const deckSpan = g.leadCols - figSpan >= 3 ? 1 : 0;
    const leadSpan = g.leadCols - figSpan - deckSpan;
    const leadCopy = lead ? postCopy(lead) : { title: focus.title || focus.topic || '', paras: [focus.intro].filter(Boolean) };
    const leadParas = leadCopy.paras;
    // With a deck, the first paragraph stays under the headline only if the deck still has something to say.
    const underTitle = deckSpan ? (leadParas.length >= 2 ? leadParas[0] : null) : leadParas[0];
    const deckParas = deckSpan ? (underTitle ? leadParas.slice(1) : leadParas) : [];
    const deckIsIntro = deckSpan && !deckParas.length && lead && focus.intro;
    const leadTitle = leadCopy.title;
    const titleSize = leadTitle.length < 56 ? 'is-short' : leadTitle.length > 110 ? 'is-long' : '';
    const leadFresh = lead && ctx.fresh.has(lead.id);

    body.append(h('article', {
      class: cls('w-lead', lead?.highlight && 'is-hl', leadFresh && 'is-fresh'),
      style: cell(1, leadSpan, 1),
    },
      h('div', { class: 'w-lead-stamp' },
        timeEl(h, ctx.time(lead ? lead.timestamp : blogTime), 'w-lead-time'),
        h('div', { class: 'w-lead-kick' },
          h('span', { class: 'w-kick-label' }, lead ? (live ? 'laatste update' : 'laatste bericht') : 'laatste update'),
          h('span', null, ctx.ago(lead ? lead.timestamp : blogTime, nowMs)),
          lead?.author ? h('span', { class: 'w-kick-by' }, `door ${lead.author}`) : null,
        ),
        h('div', { class: 'w-marks' }, lead ? marks(lead, h) : null),
      ),
      h('div', { class: 'w-lead-text' },
        lead?.highlight || leadFresh
          ? h('div', { class: 'w-tags' },
            lead.highlight ? h('span', { class: 'w-tag is-hl' }, 'belangrijk') : null,
            leadFresh ? h('span', { class: 'w-tag is-new' }, 'nieuw') : null)
          : null,
        h('h1', { class: cls('w-lead-title', titleSize) }, leadTitle),
        underTitle ? h('p', { class: 'w-lead-para' }, underTitle) : null,
      ),
    ));

    let col = 1 + leadSpan;
    if (deckSpan) {
      body.append(h('div', { class: 'w-deck', style: cell(col, deckSpan, 1) },
        h('div', { class: 'w-deck-inner' },
          deckIsIntro ? h('h2', { class: 'w-deck-label' }, 'Over deze liveblog') : null,
          (deckIsIntro ? [focus.intro] : deckParas).slice(0, 6).map(p => h('p', null, p)),
        ),
      ));
      col += deckSpan;
    }
    if (fig) {
      const credit = [fig.fromPost ? null : 'liveblogfoto', cleanCredit(fig.image.credit)].filter(Boolean).join(' · ');
      const portrait = isPortrait(fig.image);
      // A portrait photo is shown whole, over a blurred, darkened copy of itself.
      body.append(h('figure', { class: cls('w-fig', portrait && 'is-portrait'), style: cell(col, figSpan, 1) },
        portrait ? h('img', { class: 'w-fig-back', src: ctx.image(fig.image, 320), alt: '' }) : null,
        h('img', { class: 'w-fig-img', src: ctx.image(fig.image, portrait ? g.colW * 0.6 : g.colW * figSpan), alt: fig.image.alt || '' }),
        credit ? h('figcaption', null, credit) : null,
      ));
    }

    // --- 12-hour activity strip --------------------------------------------
    body.append(h('div', { class: 'w-strip', style: cell(1, Math.min(g.leadCols, g.feed), 2) }, strip(focus, posts, live, ctx, h)));

    // --- columns -------------------------------------------------------------
    // Feed columns sit under the strip; those beyond the lead band run full
    // height. Without earlier posts, the side content takes over the feed columns.
    for (let i = 0; i < g.feed; i++) {
      body.append(h('div', {
        class: 'w-col',
        dataset: { col: noFeed ? 'side' : 'feed', o: i },
        style: i < g.leadCols ? cell(i + 1, 1, 3) : cell(i + 1, 1, 1, 3),
      }, noFeed && i === 0 ? h('p', { class: 'w-empty' }, lead ? 'geen eerdere berichten' : 'nog geen berichten') : null));
    }
    const sideRow = g.n === 3 ? 2 : 1;
    for (let i = 0; i < g.side; i++) {
      body.append(h('div', { class: 'w-scol', dataset: { col: 'side', o: 100 + i }, style: cell(g.feed + 1 + i, 1, sideRow, 4 - sideRow) }));
    }

    // Feed items, newest first, with a divider wherever the day changes.
    const pool = h('div', { class: 'w-pool', hidden: true });
    let n = 0;
    let prevDay = lead ? dayKey(lead.timestamp) : today;
    for (const post of posts.slice(1)) {
      const d = dayKey(post.timestamp);
      if (d !== prevDay) {
        pool.append(h('div', { class: 'w-day', dataset: { flow: 'feed', i: n++, glue: '1' } }, h('span', null, dayLabel(post.timestamp, ctx))));
        prevDay = d;
      }
      pool.append(feedItem(post, ctx, n++));
    }

    // Side items: summary, other liveblogs, other news.
    let s = 0;
    const heading = (text, extra) => h('h2', { class: 'w-sh', dataset: { flow: 'side', i: s++, glue: '1' } }, h('span', null, text), extra ? h('em', null, extra) : null);
    if (points.length) {
      pool.append(heading(focus.summary.title || 'Kort samengevat'));
      points.slice(0, g.n <= 4 ? 4 : 6).forEach(p => pool.append(h('p', { class: 'w-sum', dataset: { flow: 'side', i: s++, shrink: '1' } }, p)));
    }
    if (others.length) {
      const liveCount = others.filter(b => b.status === 'live').length;
      pool.append(heading('Andere liveblogs', liveCount ? `${liveCount} live` : null));
      others.forEach(b => pool.append(blogItem(b, ctx, stamp, s++)));
    }
    if (news.length) {
      pool.append(heading('Ander nieuws'));
      news.forEach(a => pool.append(newsItem(a, ctx, stamp, s++)));
    }

    // --- footer (corners beside the Dock) ------------------------------------
    const foot = h('footer', { class: 'w-foot' },
      h('div', null, ctx.date(ctx.now, 'long')),
      h('div', null, 'bron ', h('b', null, 'VRT NWS'), ' · vrtnws.be'),
    );

    root.append(
      h('div', { class: 'w-bg' }),
      h('div', { class: 'w-frame' }, head, body),
      foot,
      pool,
    );
  },

  layout(root) {
    const pool = root.querySelector('.w-pool');
    if (!pool) return;
    // The lead band sets the height of everything below it, so it goes first.
    fitLead(root.querySelector('.w-lead'));
    settle(root, 'feed', pool, 2);
    settle(root, 'side', pool, 2);
    clampDeck(root.querySelector('.w-deck'));
  },
};

// ---------------------------------------------------------------------------
// Builders

// "15u40" with a quieter "u", like a departures board. Keeps any day prefix.
function timeEl(h, text, className) {
  const m = String(text).match(/^(.*?)(\d{1,2})u(\d{2})$/);
  if (!m) return h('time', { class: className }, text);
  return h('time', { class: className },
    m[1] ? h('span', { class: 'w-pre' }, m[1]) : null,
    m[2], h('span', { class: 'w-u' }, 'u'), m[3],
  );
}

function feedItem(post, ctx, i) {
  const { h } = ctx;
  const { title, paras } = postCopy(post);
  const text = paras.join(' ');
  const fresh = ctx.fresh.has(post.id);
  return h('article', {
    class: cls('w-item', post.highlight && 'is-hl', fresh && 'is-fresh'),
    dataset: text ? { flow: 'feed', i, shrink: '1' } : { flow: 'feed', i },
  },
    h('div', { class: 'w-item-stamp' },
      timeEl(h, ctx.time(post.timestamp)),
      h('div', { class: 'w-marks' }, marks(post, h)),
    ),
    h('div', { class: 'w-item-body' },
      post.highlight || fresh
        ? h('div', { class: 'w-tags' },
          post.highlight ? h('span', { class: 'w-tag is-hl' }, 'belangrijk') : null,
          fresh ? h('span', { class: 'w-tag is-new' }, 'nieuw') : null)
        : null,
      h('h3', null, title),
      text ? h('p', null, text) : null,
    ),
  );
}

function blogItem(b, ctx, stamp, i) {
  const { h } = ctx;
  const latest = b.recent?.[0];
  const live = b.status === 'live';
  const meta = live
    ? (b.postsInWindow ? `${b.postsInWindow} ${b.postsInWindow === 1 ? 'bericht' : 'berichten'} in 3 uur` : 'live')
    : 'afgelopen';
  const when = stamp(latest?.timestamp ?? b.updatedAt);
  const title = (latest && postCopy(latest).title) || b.title;
  return h('div', { class: cls('w-blog', live ? 'is-live' : 'is-ended', latest && ctx.fresh.has(latest.id) && 'is-fresh'), dataset: { flow: 'side', i, shrink: '1' } },
    h('div', { class: 'w-blog-head' },
      h('i', { class: 'w-dot' }),
      h('span', { class: 'w-blog-topic' }, b.topic || b.title || 'Liveblog'),
      when ? timeEl(h, when) : null,
    ),
    title ? h('p', { class: 'w-blog-title' }, title) : null,
    h('p', { class: 'w-blog-meta' }, meta),
  );
}

// The summary only shows when the side column has room to spare (data-side-rich).
function newsItem(a, ctx, stamp, i) {
  const { h } = ctx;
  return h('div', { class: 'w-news', dataset: { flow: 'side', i, shrink: '1' } },
    timeEl(h, stamp(a.updatedAt ?? a.publishedAt)),
    h('div', null,
      a.section ? h('span', { class: 'w-news-sec' }, a.section) : null,
      h('p', { class: 'w-news-title' }, a.title),
      a.summary ? h('p', { class: 'w-news-sum' }, a.summary) : null,
    ),
  );
}

// Small typographic markers for what a post carries beyond text.
function marks(post, h) {
  const out = [];
  const blocks = post.blocks ?? [];
  const video = blocks.find(b => b.type === 'video');
  if (post.hasVideo || video) {
    out.push(h('span', { class: 'w-mark is-video' }, h('i'), video?.durationSec ? duration(video.durationSec) : 'video'));
  }
  const photos = blocks.filter(b => b.type === 'image').length;
  if (photos) out.push(h('span', { class: 'w-mark is-photo' }, h('i'), photos > 1 ? `${photos} foto's` : 'foto'));
  if (blocks.some(b => b.type === 'audio')) out.push(h('span', { class: 'w-mark is-audio' }, h('i'), 'audio'));
  return out;
}

// Ticks for every post in the last 12 hours (or the 12 hours before an ended liveblog closed).
function strip(focus, posts, live, ctx, h) {
  const now = ctx.now.getTime();
  const newest = posts[0]?.timestamp ?? now;
  const end = Math.ceil((live ? Math.max(now, newest) : newest + 1) / HOUR) * HOUR;
  const start = end - 12 * HOUR;
  const pos = ts => `${((ts - start) / (end - start)) * 100}%`;
  const inWindow = posts.filter(p => p.timestamp >= start && p.timestamp <= end);
  // We only get the newest posts; if all of them fall inside the window, there may be more.
  const capped = inWindow.length === posts.length && (focus.postCount ?? 0) > posts.length;

  const hours = [];
  for (let t = start; t <= end; t += HOUR) {
    const k = Math.round((t - start) / HOUR);
    const label = k % 2 === 0 && k < 12 ? `${ctx.time(t).split('u')[0]}u` : null;
    hours.push(h('span', { class: cls('w-hour', label && 'has-label'), style: { left: pos(t) } }, label ? h('b', null, label) : null));
  }
  const ticks = inWindow.map(p => h('i', {
    class: cls('w-tick', p.highlight && 'is-hl', p === posts[0] && 'is-latest'),
    style: { left: pos(p.timestamp) },
  }));

  return [
    h('div', { class: 'w-strip-label' },
      h('b', null, `${inWindow.length}${capped ? '+' : ''}`),
      h('span', null, inWindow.length === 1 ? 'bericht' : 'berichten', h('br'), live ? 'laatste 12 uur' : '12 uur voor het einde'),
    ),
    h('div', { class: 'w-strip-track' },
      h('div', { class: 'w-axis' }, hours),
      h('div', { class: 'w-ticks' }, ticks),
      live && now <= end ? h('span', { class: 'w-now', style: { left: pos(now) } }, h('b', null, 'nu')) : null,
    ),
    h('div', { class: 'w-strip-key' }, h('i'), 'belangrijk'),
  ];
}

// ---------------------------------------------------------------------------
// Layout: pour items into columns, newest first, and drop what does not fit.

// Fill a flow, then use any room left over: when everything fits, step up the
// richness (longer paragraphs, headline summaries) as long as everything still
// fits whole, then even out the columns so none is left half empty.
function settle(root, flow, pool, levels) {
  const key = `${flow}Rich`;
  root.dataset[key] = '0';
  if (!pour(root, flow, pool).all) return;
  const cols = columnsOf(root, flow);
  if (!cols.length) return;

  let level = 0;
  for (let l = 1; l <= levels; l++) {
    root.dataset[key] = String(l);
    if (!pour(root, flow, pool, { shrink: false }).all) break;
    level = l;
  }
  root.dataset[key] = String(level);
  if (cols.length < 2 || !pour(root, flow, pool, { shrink: false }).all) {
    pour(root, flow, pool);
    return;
  }
  // The lowest column height that still takes every item whole.
  let lo = 0;
  let hi = Math.max(...cols.map(c => c.clientHeight));
  while (hi - lo > 4) {
    const mid = (lo + hi) / 2;
    if (pour(root, flow, pool, { cap: mid, shrink: false }).all) hi = mid;
    else lo = mid;
  }
  pour(root, flow, pool, { cap: hi, shrink: false });
}

function columnsOf(root, flow) {
  return [...root.querySelectorAll(`[data-col="${flow}"]`)].sort((a, b) => a.dataset.o - b.dataset.o);
}

// Bottom of a column's content, from layout boxes (a fading-in item's
// transform must not count).
function contentBottom(c) {
  const last = c.lastElementChild;
  return last ? last.offsetTop + last.offsetHeight : 0;
}

// Pour items into the flow's columns in order. An item that does not fit is
// first shrunk (if it may be), else it moves to the next column; one too tall
// for an empty column is skipped. `cap` limits the usable column height.
function pour(root, flow, pool, { cap = Infinity, shrink = true } = {}) {
  const cols = columnsOf(root, flow);
  const items = [...root.querySelectorAll(`[data-flow="${flow}"][data-i]`)]
    .sort((a, b) => a.dataset.i - b.dataset.i);
  const total = items.filter(it => !it.dataset.glue).length;
  if (!cols.length) return { all: !total };
  items.forEach(it => it.classList.remove('is-tight', 'is-bare', 'is-first'));
  pool.append(...items);

  const fits = c => c.scrollHeight <= c.clientHeight + 1 && contentBottom(c) <= Math.min(c.clientHeight, cap) + 1;
  let ci = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const c = cols[ci];
    if (!c) break;
    c.append(it);
    if (fits(c)) continue;
    if (shrink && it.dataset.shrink) {
      it.classList.add('is-tight');
      if (fits(c)) continue;
      it.classList.add('is-bare');
      if (fits(c)) continue;
      it.classList.remove('is-tight', 'is-bare');
    }
    const alone = c.firstElementChild === it;
    pool.append(it);
    if (alone) continue; // too tall even for an empty column: skip it
    // Headings and day dividers never end a column: carry them over.
    const carry = [];
    while (c.lastElementChild?.dataset.glue) carry.unshift(c.lastElementChild), pool.append(c.lastElementChild);
    ci++;
    if (!cols[ci]) break;
    cols[ci].append(...carry);
    k--;
  }
  // Remove trailing glue in every column.
  let placed = 0;
  for (const c of cols) {
    while (c.lastElementChild?.dataset.glue) pool.append(c.lastElementChild);
    c.firstElementChild?.classList.add('is-first');
    placed += c.querySelectorAll(`:scope > [data-flow="${flow}"]:not([data-glue])`).length;
  }
  return { all: placed === total };
}

// The deck (lead paragraphs beside the headline) gets whole paragraphs,
// the last one clamped to the lines that are left.
function clampDeck(deck) {
  if (!deck) return;
  const inner = deck.firstElementChild;
  const paras = [...inner.children];
  paras.forEach(p => { p.hidden = false; p.style.webkitLineClamp = ''; p.classList.remove('is-clamped'); });
  const limit = deck.clientHeight;
  for (const p of paras) {
    const top = p.offsetTop;
    if (top >= limit) { p.hidden = true; continue; }
    if (top + p.offsetHeight <= limit) continue;
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 20;
    const lines = Math.floor((limit - top) / lh);
    if (lines < 2) { p.hidden = true; continue; }
    p.classList.add('is-clamped');
    p.style.webkitLineClamp = String(lines);
  }
}

// If the lead paragraph pushes the lead band too tall, clamp it to fewer lines.
function fitLead(lead) {
  const para = lead?.querySelector('.w-lead-para');
  if (!para) return;
  para.classList.remove('is-short');
  const body = lead.parentElement;
  const max = body.clientHeight * 0.36;
  if (lead.offsetHeight > max) para.classList.add('is-short');
}

// ---------------------------------------------------------------------------
// Helpers

function usable(img) {
  return img && img.url && !img.sensitive ? img : null;
}

// The lead's own photo when it is landscape, else the liveblog's lead photo,
// else a portrait post photo. Sensitive images are never shown.
function pickImage(lead, focus) {
  const own = usable(lead?.image);
  const blog = usable(focus.image);
  if (own && !isPortrait(own)) return { image: own, fromPost: true };
  if (blog) return { image: blog, fromPost: false };
  if (own) return { image: own, fromPost: true };
  return null;
}

function cleanCredit(credit) {
  return credit ? credit.replace(/^Foto:\s*/i, 'foto ').replace(/\.$/, '') : null;
}

function isPortrait(img) {
  const [w, hgt] = String(img?.ratio ?? '16/9').split('/').map(Number);
  return w && hgt ? w / hgt < 1 : false;
}

function duration(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts, ctx) {
  return ctx.date(ts, 'long').replace(/\s\d{4}$/, '');
}

// Headline and body text for a post. A post without a title borrows its first
// sentence (taken out of the body, so it is not said twice), else a quote,
// embed, video name, teaser, audio title or photo caption.
function postCopy(post) {
  const paras = (post.paragraphs ?? []).map(squash).filter(Boolean);
  if (post.title?.trim()) return { title: post.title.trim(), paras };
  if (paras.length) {
    const [first, rest] = splitSentence(paras[0].replace(/^•\s*/, ''));
    return { title: first, paras: rest ? [rest, ...paras.slice(1)] : paras.slice(1) };
  }
  const blocks = post.blocks ?? [];
  const find = (type, key) => blocks.find(b => b?.type === type && squash(b[key]));
  const quote = find('quote', 'text');
  if (quote) return { title: `"${squash(quote.text)}"`, paras: [squash(quote.by)].filter(Boolean) };
  const embed = find('embed', 'title') ?? find('embed', 'text');
  if (embed) {
    const [first, rest] = splitSentence(embed.title || embed.text);
    return { title: first, paras: [rest, squash(embed.attribution)].filter(Boolean) };
  }
  const named = find('video', 'name')?.name ?? find('teaser', 'title')?.title ?? find('audio', 'title')?.title
    ?? post.image?.caption ?? post.image?.alt;
  if (squash(named)) return { title: squash(named), paras: [] };
  return { title: post.hasVideo ? 'Video' : post.image ? 'Foto' : 'Update', paras: [] };
}

// First sentence and the rest. Without a clean sentence end the whole text is
// the "sentence"; line clamps shorten it where it is shown.
function splitSentence(text) {
  const t = squash(text);
  const m = t.match(/^.{20,180}?[.!?…]["”’']?(?=\s|$)/);
  if (!m) return [t, ''];
  return [m[0], t.slice(m[0].length).trim()];
}

function squash(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function cls(...names) {
  return names.filter(Boolean).join(' ');
}
