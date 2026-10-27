// Broadsheet: the followed liveblog as the front page of a classic newspaper.
//
// Page anatomy (top to bottom):
//   nameplate band   the liveblog topic set as the flag, two ears, a dateline row
//   lead package     newest post: kicker, huge headline, standfirst, justified
//                    columns with a drop cap that run on into the earlier posts
//                    ("14u23 —"), the lead photo with caption, credit and a fact box
//   rail             "Ook live" (the other liveblogs) and "Ander nieuws"
//   folio            page foot, either side of the Dock
//
// The grid is computed from the screen: type scales with the short side
// (cqmin), the number of columns with the width. layout() fits the nameplate and
// headline, then fills the columns exactly, dropping or trimming whole items.

const DAY = 86_400_000;

export default {
  id: 'broadsheet',
  name: 'Broadsheet',
  tone: 'light',

  render(root, data, ctx) {
    const { h } = ctx;
    const focus = data.focus;
    const posts = focus.posts ?? [];
    const leadPost = posts[0] ?? null;
    const photo = pickPhoto(leadPost, focus);
    const geo = geometry(ctx.screen, photo, ctx.safe);
    const live = focus.status === 'live';

    root.setAttribute('lang', 'nl');
    root.dataset.cols = geo.cols;

    const page = h('div', {
      class: `bs-page${live ? ' is-live' : ' is-ended'}`,
      '--cols': geo.cols,
      '--lead-cols': geo.lead,
      '--rail-cols': geo.rail,
      '--photo-cols': geo.photo,
      '--flow-cols': geo.lead - geo.photo,
    },
      masthead(focus, posts, Date.parse(data.generatedAt), ctx),
      h('main', { class: 'bs-body' },
        leadPackage(focus, posts, photo, geo, ctx),
        rail(data, focus, photo, geo, ctx),
      ),
      folio(focus, ctx),
    );

    root.append(h('div', { class: 'bs-paper', 'aria-hidden': 'true' }), page);
  },

  layout(root, ctx) {
    const page = root.querySelector('.bs-page');
    if (!page) return;
    const base = compose(page, ctx, null);
    // The lead story ends a column early, with more room than the pull quote
    // can fill where it stands: set the quote inside the story instead, so the
    // text runs on to the column foot, and keep that if the page ends tighter.
    const tries = base.hole ? pullPlacements(page, base) : [];
    let best = null, score = base.score, current = null;
    for (const opt of tries) {
      const res = compose(page, ctx, opt);
      current = opt;
      if (res.ok && res.score < score - res.line) { best = opt; score = res.score; }
    }
    if (current !== best) compose(page, ctx, best);
  },
};

function compose(page, ctx, pull) {
  reset(page);
  fitNameplate(page);
  fitHeadline(page, ctx);
  fitDeck(page);
  fitPhotoColumn(page);
  if (pull) placePull(page, pull);
  fitFlow(page);
  fitRail(page);
  fillFlow(page, !pull);
  justifyFlow(page);
  justifyRail(page);
  fitFolio(page);
  return measureFlow(page);
}

// ---------------------------------------------------------------------------
// Grid

// Columns fill the width between the margins for the desktop files
// (safe.right), kept on both sides so the page stays centered.
function geometry(screen, photo, safe) {
  const W = screen.width;
  const H = screen.height;
  const u = Math.min(W, H) / 100; // 1cqmin
  const mx = Math.max(28, 2.4 * u + 0.011 * W);
  const gap = 2.2 * u;
  const target = 22 * u;
  const inner = W - 2 * (mx + safe.right);
  const cols = Math.max(5, Math.min(11, Math.floor((inner + gap) / (target + gap))));
  const rail = cols >= 8 ? 2 : 1;
  const lead = cols - rail;
  let photoCols = 0;
  if (photo) photoCols = photo.ratio < 1 ? (lead >= 7 ? 2 : 1) : Math.round(lead * 0.42);
  return { cols, rail, lead, photo: photoCols, u, colW: (inner - (cols - 1) * gap) / cols };
}

// ---------------------------------------------------------------------------
// Masthead

// `refreshed` is when the news was fetched; the ears give the liveblog's own times.
function masthead(focus, posts, refreshed, ctx) {
  const { h } = ctx;
  const live = focus.status === 'live';
  const now = ctx.now.getTime();
  const started = focus.startedAt || null;
  const last = focus.updatedAt || posts[0]?.timestamp || now;
  const day = started ? Math.max(1, Math.floor((startOfDay(now) - startOfDay(started)) / DAY) + 1) : null;
  const newest = posts[0]?.timestamp ?? last;
  const count = focus.postCount ?? posts.length;
  const since = started ? ctx.date(started, 'daymonth') : null;
  const until = ctx.date(last, 'daymonth');

  const leftEar = live
    ? h('div', { class: 'bs-ear bs-ear-left' },
      h('span', { class: 'bs-ear-label is-live' }, h('i', { class: 'bs-livedot' }), 'Live'),
      h('span', { class: 'bs-ear-main' }, day ? `Dag ${day}` : berichten(count)),
      h('span', { class: 'bs-ear-sub' }, day ? `${berichten(count)} sinds ${since}` : 'Doorlopend bijgewerkt'))
    : h('div', { class: 'bs-ear bs-ear-left' },
      h('span', { class: 'bs-ear-label' }, 'Afgelopen'),
      h('span', { class: 'bs-ear-main' }, berichten(count)),
      h('span', { class: 'bs-ear-sub' },
        !since ? `tot ${until}` : since === until ? `op ${since}` : `van ${since} tot ${until}`));

  return h('header', { class: 'bs-mast' },
    h('div', { class: 'bs-flagrow' },
      leftEar,
      h('h1', { class: 'bs-nameplate' }, h('span', null, flagText(focus))),
      h('div', { class: 'bs-ear bs-ear-right' },
        h('span', { class: 'bs-ear-label' }, live ? 'Laatste bericht' : 'Slotbericht'),
        h('span', { class: 'bs-ear-main' }, ctx.time(newest)),
        h('span', { class: 'bs-ear-sub' }, sameDay(newest, now) ? cap(ctx.ago(newest, now)) : cap(ctx.date(newest, 'short'))),
      ),
    ),
    h('div', { class: 'bs-dateline' },
      h('span', { class: 'bs-dateline-date' }, cap(ctx.date(ctx.now, 'long'))),
      h('span', { class: 'bs-dateline-mid' },
        [live ? 'Liveblog' : 'Einde liveblog', Number.isNaN(refreshed) ? null : `bijgewerkt ${ctx.time(refreshed)}`]
          .filter(Boolean).join(' · ')),
      h('span', { class: 'bs-source' }, 'Bron: VRT NWS'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Lead package: kicker, headline, standfirst, flowing columns, photo

function leadPackage(focus, posts, photo, geo, ctx) {
  const { h } = ctx;
  const lead = posts[0] ?? null;
  const live = focus.status === 'live';
  const now = ctx.now.getTime();
  const headline = typo(lead?.title || focus.title);

  // Body of the lead: its own paragraphs, or the liveblog intro when the post
  // is only a video or a picture.
  let paras = prose(lead?.paragraphs);
  const usesIntro = !paras.length;
  if (usesIntro) paras = [typo(stripFollow(focus.intro))].filter(Boolean);

  // A short first paragraph becomes the standfirst under the headline.
  let deck = null;
  if (!usesIntro && paras.length >= 2 && paras[0].length <= 260 && !paras[0].startsWith('• ')) {
    deck = paras[0];
    paras = paras.slice(1);
  }

  const fresh = lead && ctx.fresh.has(lead.id);
  const kicker = h('p', { class: 'bs-kicker' },
    h('span', { class: 'bs-kicker-tag' }, !lead ? (live ? 'Liveblog' : 'Einde liveblog') : live ? 'Laatste update' : 'Laatste bericht'),
    lead ? h('span', { class: 'bs-kicker-time' }, ctx.time(lead.timestamp)) : null,
    lead && sameDay(lead.timestamp, now) ? h('span', null, ctx.ago(lead.timestamp, now)) : null,
    lead && !sameDay(lead.timestamp, now) ? h('span', null, cap(ctx.date(lead.timestamp, 'short'))) : null,
    lead?.author ? h('span', { class: 'bs-kicker-by', dataset: { drop: 'kicker' } }, `Door ${lead.author}`) : null,
    fresh ? h('span', { class: 'bs-new' }, 'Nieuw') : null,
  );

  const briefImages = pickBriefImages(posts.slice(1), photo, geo);

  // A pull quote waits, hidden, at the end of the lead story. layout() sets
  // the longest quotation that fits when the column there would end early.
  const quotes = usesIntro ? [] : pullQuotes(paras);
  let pull = null;
  if (quotes.length) {
    pull = h('blockquote', { class: 'bs-pull', dataset: { quotes: JSON.stringify(quotes), extra: '' } }, h('p', null));
    pull.hidden = true;
  }
  const flow = h('div', { class: 'bs-flow' },
    h('div', { class: `bs-leadtext${fresh ? ' is-fresh' : ''}${deck ? ' has-deck' : ''}` },
      paras.map((p, i) => para(p, ctx, i === 0 ? 'bs-opener' : null)),
      lead && !usesIntro && lead.hasVideo && !photo?.post ? h('p', { class: 'bs-videonote' }, `${videoNote(lead)} bij dit bericht op vrtnws.be`) : null,
    ),
    pull,
    posts.length > 1 ? h('h4', { class: 'bs-flow-head' }, h('span', null, 'Eerder in deze liveblog')) : null,
    posts.slice(1).map(p => brief(p, ctx, briefImages.has(p.id))),
  );

  const figure = photo ? photoColumn(photo, focus, geo, ctx, usesIntro) : null;

  return h('article', { class: `bs-lead${figure ? '' : ' no-photo'}${photo && photo.ratio < 1 ? ' is-portrait' : ''}` },
    kicker,
    h('h2', { class: `bs-headline${fresh ? ' is-fresh' : ''}`, dataset: { len: headline.length } }, headline),
    deck ? h('p', { class: 'bs-deck' }, deck) : null,
    flow,
    figure,
  );
}

function brief(post, ctx, withImage) {
  const { h } = ctx;
  const title = typo(post.title);
  const paras = prose(post.paragraphs);
  const take = post.highlight ? 3 : 2;
  const body = paras.slice(0, take);
  // Further paragraphs wait, hidden, to fill a column that would end early.
  const extra = paras.slice(take, take + 3);
  const fresh = ctx.fresh.has(post.id);
  const today = sameDay(post.timestamp, ctx.now.getTime());
  const dl = today ? ctx.time(post.timestamp) : `${ctx.date(post.timestamp, 'short')} ${ctx.time(post.timestamp)}`;
  const dateline = h('b', { class: 'bs-dl' }, `${dl} — `);

  const children = [];
  if (withImage) {
    const img = post.image;
    const video = videoNote(post);
    children.push(h('figure', { class: 'bs-brief-fig', '--ar': ratioOf(img.ratio) },
      h('div', { class: 'bs-imgwrap' },
        h('img', { src: ctx.image(img, 420), alt: img.alt || '', decoding: 'async' }),
        video ? h('span', { class: 'bs-play' }, h('i'), video) : null,
      ),
      creditFor(img) ? h('figcaption', null, h('span', { class: 'bs-credit' }, creditFor(img))) : null,
    ));
  }
  if (title) {
    children.push(h('h3', { class: 'bs-brief-title' },
      fresh ? h('span', { class: 'bs-new' }, 'Nieuw') : null, title));
  }
  if (body.length) {
    body.forEach((text, i) => children.push(para(text, ctx, i === 0 ? 'bs-first' : null, i === 0 ? dateline : null)));
    extra.forEach(text => {
      const p = para(text, ctx);
      p.hidden = true;
      p.dataset.extra = '';
      children.push(p);
    });
  } else {
    const note = videoNote(post);
    children.push(h('p', { class: 'bs-first' }, dateline, h('i', { class: 'bs-t' }, note ? `${note} op vrtnws.be.` : 'Korte update.')));
  }

  return h('article', {
    class: `bs-brief${post.highlight ? ' is-highlight' : ''}${title.length > 90 ? ' is-long' : ''}${fresh ? ' is-fresh' : ''}`,
    dataset: { drop: 'brief' },
  }, children);
}

// A paragraph. The text sits in its own span so layout() can trim it and put it
// back without touching the run-in dateline.
function para(text, ctx, cls, runIn) {
  const { h } = ctx;
  const li = text.startsWith('• ');
  const classes = [li ? 'bs-li' : null, cls].filter(Boolean).join(' ') || null;
  return h('p', { class: classes }, runIn ?? null, h('span', { class: 'bs-t' }, li ? text.slice(2) : text));
}

function photoColumn(photo, focus, geo, ctx, introUsed) {
  const { h } = ctx;
  const { img, post } = photo;
  const cssW = Math.round(geo.photo * geo.colW * 1.1);
  const caption = captionFor(img, post);
  const credit = creditFor(img);
  const video = post ? videoNote(post) : null;

  const box = photo.ratio >= 1 ? factBox(focus, ctx, introUsed) : null;
  return h('div', { class: 'bs-photocol' },
    h('figure', { class: 'bs-figure', '--ar': photo.ratio },
      h('div', { class: 'bs-imgwrap' },
        h('img', { src: ctx.image(img, cssW), alt: img.alt || '', decoding: 'async' }),
        video ? h('span', { class: 'bs-play' }, h('i'), video) : null,
      ),
      h('figcaption', null,
        caption ? h('span', { class: 'bs-cap' }, typo(caption)) : null,
        !caption && post ? h('span', { class: 'bs-cap' }, `Beeld bij de update van ${ctx.time(post.timestamp)}.`) : null,
        credit ? h('span', { class: 'bs-credit' }, credit) : null,
      ),
    ),
    box,
  );
}

function factBox(focus, ctx, introUsed) {
  const { h } = ctx;
  if (focus.summary?.points?.length) {
    return h('section', { class: 'bs-box', dataset: { box: 'summary' } },
      h('h4', { class: 'bs-box-head' }, 'Kort samengevat'),
      h('ul', null, focus.summary.points.map(p => h('li', { dataset: { drop: 'point' } }, typo(p)))),
    );
  }
  const intro = stripFollow(focus.intro);
  if (!intro || introUsed) return null;
  return h('section', { class: 'bs-box is-intro', dataset: { box: 'intro' } },
    h('h4', { class: 'bs-box-head' }, 'Waar gaat het over?'),
    h('p', null, typo(intro)),
  );
}

// ---------------------------------------------------------------------------
// Rail: other liveblogs and regular headlines

function rail(data, focus, photo, geo, ctx) {
  const { h } = ctx;
  const now = ctx.now.getTime();
  const others = (data.liveblogs ?? []).filter(b => !b.isFocus && b.id !== focus.id)
    .sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1));

  const boxInRail = !photo || photo.ratio < 1;
  const introUsed = !prose(focus.posts?.[0]?.paragraphs).length;
  const box = boxInRail ? factBox(focus, ctx, introUsed) : null;

  const ookLive = others.length ? h('section', { class: 'bs-rail-sec bs-ooklive' },
    h('h4', { class: 'bs-rail-head' }, h('span', null, 'Ook live')),
    others.map(b => {
      const last = b.recent?.[0];
      const isLive = b.status === 'live';
      const ts = last?.timestamp ?? b.updatedAt ?? null;
      const when = !ts ? '' : sameDay(ts, now) ? ctx.time(ts) : `${ctx.date(ts, 'short')} ${ctx.time(ts)}`;
      return h('article', { class: `bs-other${isLive ? '' : ' is-ended'}`, dataset: { drop: 'other' } },
        h('p', { class: 'bs-other-topic' },
          isLive ? h('i', { class: 'bs-livedot' }) : null,
          typo(b.topic) || (isLive ? 'Liveblog' : 'Einde liveblog')),
        h('h5', { class: 'bs-other-title' }, typo(last?.title || b.title)),
        h('p', { class: 'bs-other-meta' },
          (isLive
            ? [when, b.postsInWindow ? `${berichten(b.postsInWindow)} in 3 uur` : '']
            : ['Afgelopen', when]).filter(Boolean).join(' · ')),
      );
    }),
  ) : null;

  const heads = (data.headlines ?? []).slice(0, 14);
  const news = heads.length ? h('section', { class: 'bs-rail-sec bs-news' },
    h('h4', { class: 'bs-rail-head' }, h('span', null, 'Ander nieuws')),
    heads.map(a => h('article', { class: 'bs-headitem', dataset: { drop: 'head' } },
      a.section ? h('p', { class: 'bs-headitem-sec' }, a.section) : null,
      h('h5', null, typo(a.title)),
    )),
  ) : null;

  // One stream of sections, set in as many columns as the rail is wide.
  return h('aside', { class: `bs-rail${geo.rail >= 2 ? ' is-double' : ''}` },
    h('div', { class: 'bs-rail-flow' }, box, ookLive, news));
}

function folio(focus, ctx) {
  const { h } = ctx;
  return h('footer', { class: 'bs-folio' },
    h('span', { class: 'bs-folio-left' },
      h('b', { class: 'bs-folio-no' }, '1'),
      h('span', { class: 'bs-folio-topic' }, typo(focus.topic || 'Liveblog'))),
    h('span', { class: 'bs-folio-right' },
      h('span', { class: 'bs-folio-date' }, cap(ctx.date(ctx.now, 'short'))),
      h('span', null, 'Tekst en beeld: VRT NWS')),
  );
}

// ---------------------------------------------------------------------------
// Layout: fit and fill. Idempotent: it restores everything before measuring,
// because it runs again once web fonts have loaded.

function reset(page) {
  const pull = page.querySelector('.bs-pull');
  const lt = page.querySelector('.bs-leadtext');
  if (pull && lt && pull.parentElement === lt) lt.after(pull);
  page.querySelectorAll('[data-restored]').forEach(el => el.remove());
  page.querySelectorAll('[data-was-opener]').forEach(el => { el.classList.add('bs-opener'); delete el.dataset.wasOpener; });
  page.querySelectorAll('[data-deck-restored]').forEach(el => { el.classList.add('has-deck'); delete el.dataset.deckRestored; });
  page.querySelectorAll('[data-hidden]').forEach(el => { el.hidden = false; delete el.dataset.hidden; });
  page.querySelectorAll('[data-extra]').forEach(el => { el.hidden = true; });
  page.querySelectorAll('[data-full]').forEach(el => { el.textContent = el.dataset.full; delete el.dataset.full; });
  page.querySelectorAll('[data-trimmed]').forEach(el => delete el.dataset.trimmed);
  page.querySelectorAll('.bs-nameplate, .bs-headline, .bs-deck').forEach(el => el.style.removeProperty('font-size'));
  page.querySelectorAll('.bs-imgwrap').forEach(el => el.style.removeProperty('height'));
  page.querySelectorAll('[data-vj]').forEach(el => {
    ['margin-top', 'padding-top', 'padding-bottom'].forEach(k => el.style.removeProperty(k));
    delete el.dataset.vj;
  });
}

function hide(el) {
  el.hidden = true;
  el.dataset.hidden = '';
}

function fitNameplate(page) {
  const plate = page.querySelector('.bs-nameplate');
  const span = plate?.firstElementChild;
  if (!span) return;
  const max = parseFloat(getComputedStyle(plate).fontSize);
  const avail = plate.clientWidth;
  const w = span.getBoundingClientRect().width;
  if (w <= avail) return;
  plate.style.fontSize = `${Math.max(max * 0.4, (max * avail) / w * 0.98)}px`;
  // Still too wide at the smallest size the flag may take: shorten it by
  // whole words, never cut it at the edge.
  const over = () => span.getBoundingClientRect().width > plate.clientWidth;
  if (!over()) return;
  const full = span.textContent;
  span.dataset.full = full;
  const words = full.split(' ');
  for (let n = words.length - 1; n >= 2; n--) {
    span.textContent = cut(words, n);
    if (!over()) return;
  }
  span.textContent = 'Liveblog';
}

function fitHeadline(page, ctx) {
  const el = page.querySelector('.bs-headline');
  const lead = page.querySelector('.bs-lead');
  if (!el || !lead) return;
  const u = Math.min(ctx.screen.width, ctx.screen.height) / 100;
  const len = Number(el.dataset.len) || 80;
  const leadH = lead.clientHeight;
  // Short headlines may run very large; long ones step down until they fit.
  const wide = Math.min(1.3, Math.max(1, Math.sqrt(ctx.screen.width / ctx.screen.height / 1.6)));
  const hi = (len < 45 ? 9.2 * u : len < 80 ? 8 * u : 7 * u) * wide;
  const lo = 3.4 * u;
  const budget = leadH * 0.36;
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

// The standfirst keeps to three lines; it steps down a little, else it goes.
function fitDeck(page) {
  const el = page.querySelector('.bs-deck');
  if (!el) return;
  const size = parseFloat(getComputedStyle(el).fontSize);
  const lines = () => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  for (const f of [1, 0.92, 0.85]) {
    el.style.fontSize = `${size * f}px`;
    if (lines() <= 3) return;
  }
  hide(el);
  // Without a standfirst, its paragraph opens the column text again.
  const lt = page.querySelector('.bs-leadtext');
  if (lt) {
    const p = document.createElement('p');
    p.className = 'bs-opener bs-restored';
    p.dataset.restored = '';
    const t = document.createElement('span');
    t.className = 'bs-t';
    t.textContent = el.textContent;
    p.append(t);
    const old = lt.querySelector('.bs-opener');
    if (old) { old.classList.remove('bs-opener'); old.dataset.wasOpener = ''; }
    lt.classList.remove('has-deck');
    lt.dataset.deckRestored = '';
    lt.prepend(p);
  }
}

// Photo column: the picture keeps its own ratio, cropped at most a little, and
// the fact box takes what is left. Points drop from the end if needed.
function fitPhotoColumn(page) {
  const col = page.querySelector('.bs-photocol');
  if (!col) return;
  const wrap = col.querySelector('.bs-imgwrap');
  const fig = col.querySelector('.bs-figure');
  const box = col.querySelector('.bs-box');
  const ar = Number(getComputedStyle(fig).getPropertyValue('--ar')) || 1.5;
  const w = wrap.clientWidth;
  const H = col.clientHeight;
  const capH = fig.getBoundingClientRect().height - wrap.getBoundingClientRect().height;
  const natural = w / ar;
  const tallest = Math.min(H - capH, w / Math.max(ar * 0.74, 0.6));
  const over = () => col.scrollHeight > col.clientHeight + 1;
  let imgH = Math.min(natural, H - capH);
  wrap.style.height = `${imgH}px`;

  if (box) {
    const points = [...box.querySelectorAll('[data-drop="point"]')];
    while (over() && points.length > 1) hide(points.pop());
    if (over()) {
      // Crop the picture a little before giving up on the box.
      const need = col.scrollHeight - col.clientHeight;
      if (imgH - need >= natural * 0.8) {
        imgH -= need;
        wrap.style.height = `${imgH}px`;
      } else hide(box);
    }
    if (!box.hidden) {
      // Let the picture grow into any space left under the box.
      const used = fig.getBoundingClientRect().height + box.getBoundingClientRect().height + gapOf(col);
      const slack = H - used;
      if (slack > 0) wrap.style.height = `${Math.min(tallest, imgH + slack)}px`;
      return;
    }
  }
  // Alone in its column, the picture may be cropped further to fill it.
  const bare = Math.min(H - capH, w / Math.max(ar * 0.62, 0.6));
  imgH = Math.max(Math.min(natural, H - capH), bare);
  wrap.style.height = `${imgH}px`;
}

function gapOf(el) {
  return parseFloat(getComputedStyle(el).rowGap) || 0;
}

// Columns: drop whole earlier posts from the end, then re-admit the first
// dropped one trimmed by words, so the last column ends on a full line.
function fitFlow(page) {
  const flow = page.querySelector('.bs-flow');
  if (!flow) return;
  const over = () => flow.scrollWidth > flow.clientWidth + 2;
  if (!over()) return;
  const briefs = [...flow.querySelectorAll('[data-drop="brief"]')];
  let i = briefs.length - 1;
  while (i >= 0 && over()) hide(briefs[i--]);
  const head = flow.querySelector('.bs-flow-head');

  const next = briefs[i + 1];
  if (next && !over()) {
    next.hidden = false;
    delete next.dataset.hidden;
    if (!trimTo(next, over, 8)) hide(next);
  }
  if (head && !briefs.some(b => !b.hidden)) hide(head);
  if (over()) {
    // Even the lead text is too long: trim it.
    const leadText = flow.querySelector('.bs-leadtext');
    if (leadText) trimTo(leadText, over, 4);
  }
}

// Trim the text of a container's last paragraph(s) word by word until `over`
// is false. Returns false if not even a minimal version fits.
function trimTo(container, over, minWords) {
  const paras = [...container.querySelectorAll('p')].filter(p => !p.hidden);
  while (paras.length) {
    const p = paras[paras.length - 1];
    const span = p.querySelector('.bs-t');
    if (!span) { hide(p); paras.pop(); if (!over()) return paras.length > 0; continue; }
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
  const col = page.querySelector('.bs-rail-flow');
  if (!col) return;
  const over = () => col.scrollWidth > col.clientWidth + 2 || col.scrollHeight > col.clientHeight + 1;
  if (!over()) return;
  const all = sel => [...col.querySelectorAll(sel)].reverse();
  const heads = all('[data-drop="head"]');
  const others = all('[data-drop="other"]');
  const points = all('[data-drop="point"]');
  // Headlines go first, from the bottom, but two stay while other liveblogs
  // can still give way; then other liveblogs down to two, then the rest.
  const order = [
    ...heads.slice(0, -2),
    ...others.slice(0, -2),
    ...heads.slice(-2),
    ...points.slice(0, -2),
  ];
  for (const el of order) {
    if (!over()) break;
    hide(el);
  }
  if (over()) col.querySelectorAll('.bs-box').forEach(hide);
  for (const el of others) { if (!over()) break; hide(el); }
  col.querySelectorAll('.bs-rail-sec').forEach(sec => {
    if (sec.querySelector('[data-drop]') && !sec.querySelector('[data-drop]:not([hidden])')) hide(sec);
  });
}

// Vertical justification. A column that ends early, because the next item
// would not fit, gets the spare space spread over its separators, as a
// compositor would, so the column bottoms line up. Nothing moves between
// columns; if anything would, the column is left as it was.
function justifyFlow(page) {
  const flow = page.querySelector('.bs-flow');
  if (!flow) return;
  justifyColumns(flow, () => {
    const units = [];
    const head = flow.querySelector('.bs-flow-head');
    if (head && !head.hidden) units.push({ el: head, apply: e => grow(head, 'margin-top', e) });
    flow.querySelectorAll('.bs-brief + .bs-brief').forEach(el => {
      if (el.hidden) return;
      units.push({ el, apply: e => { grow(el, 'margin-top', e / 2); grow(el, 'padding-top', e / 2); } });
    });
    return units;
  });
}

function justifyRail(page) {
  const box = page.querySelector('.bs-rail-flow');
  if (!box) return;
  justifyColumns(box, () => {
    const units = [];
    box.querySelectorAll('.bs-rail-sec').forEach((sec, i) => {
      if (sec.hidden) return;
      if (i > 0 || sec.previousElementSibling) units.push({ el: sec, apply: e => grow(sec, 'margin-top', e) });
      const items = [...sec.querySelectorAll('[data-drop]')].filter(el => !el.hidden);
      items.slice(1).forEach((el, k) => {
        const prev = items[k];
        units.push({ el, apply: e => { grow(prev, 'padding-bottom', e / 2); grow(el, 'margin-top', e / 2); } });
      });
    });
    return units;
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
    box.querySelectorAll('.bs-imgwrap, .bs-box').forEach(el => { for (const q of el.getClientRects()) take(q); });
    return out;
  };
  const line = parseFloat(getComputedStyle(box.querySelector('p') || box).lineHeight) || 20;
  return { n, r, colAt, ends, line, bottom: r.top + box.clientHeight };
}

// A column that ends early after an earlier post gets more of that post's
// text, trimmed to a whole line, as long as nothing else moves.
function fillFlow(page, withPull = true) {
  const flow = page.querySelector('.bs-flow');
  if (!flow) return;
  const cols = columnsOf(flow);
  const { colAt, ends, line, bottom } = cols;
  let before = ends();
  const width = flow.scrollWidth;
  const last = before.findLastIndex(v => v > -Infinity);
  const still = base => {
    if (flow.scrollWidth > width + 1) return false;
    const now = ends();
    const grew = now.map((v, k) => v - base[k]);
    // Only one column may change, and only by filling its own hole.
    const changed = grew.map((d, k) => Math.abs(d) > 1 ? k : -1).filter(k => k >= 0);
    return changed.length <= 1 && now.every(v => v <= bottom + 1);
  };

  // The pull quote, where the lead story ends with room to spare.
  const pull = withPull ? flow.querySelector('.bs-pull') : null;
  if (pull && before.some((v, k) => k < last && bottom - v >= line * 2.6)) {
    pull.hidden = false;
    let ok = false;
    for (const q of quotesOf(pull)) {
      setPull(pull, q);
      if (still(before) && !tooClose(flow, pull, cols)) { ok = true; break; }
    }
    if (!ok) pull.hidden = true;
    before = ends();
  }
  for (let c = 0; c < last; c++) {
    if (bottom - before[c] < line * 1.4) continue;
    const owner = [...flow.querySelectorAll('[data-drop="brief"]')].filter(b => !b.hidden).find(b => {
      const q = lastRect(b);
      return q && colAt(q.left) === c && Math.abs(q.bottom - before[c]) < 2;
    });
    if (!owner) continue;
    const base = before;
    const moved = () => {
      if (flow.scrollWidth > width + 1) return true;
      const now = ends();
      return now.some((v, k) => k !== c && Math.abs(v - base[k]) > 1) || now[c] > bottom + 1;
    };
    for (const extra of owner.querySelectorAll('[data-extra]')) {
      if (!extra.hidden) continue;
      if (bottom - ends()[c] < line * 1.4) break;
      extra.hidden = false;
      if (moved() && !trimTo(owner, moved, 6)) { extra.hidden = true; break; }
      if (extra.hidden) break;
      if (extra.dataset.trimmed !== undefined) break;
    }
    before = ends();
  }
}

function lastRect(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter(q => q.width && q.height);
  return rects[rects.length - 1];
}

function quotesOf(pull) {
  try { return JSON.parse(pull.dataset.quotes || '[]'); } catch { return []; }
}

function setPull(pull, q) {
  pull.querySelector('p').textContent = q;
  pull.classList.toggle('is-plain', !q.startsWith('“'));
}

// Where the words of a pull quote stand in the story itself.
function sourceRects(lt, q) {
  const needle = q.replace(/^“|”$/g, '');
  const out = [];
  for (const span of lt.querySelectorAll('.bs-t')) {
    if (span.closest('.bs-pull') || span.closest('[hidden]')) continue;
    const t = span.firstChild;
    if (!t || t.nodeType !== 3) continue;
    const at = t.data.indexOf(needle);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(t, at);
    range.setEnd(t, at + needle.length);
    out.push(...[...range.getClientRects()].filter(r => r.width && r.height));
  }
  return out;
}

// A pull quote must not stand beside, or just under, the sentence it repeats:
// at least ten lines away in the same column, five in the next one.
function tooClose(flow, pull, cols) {
  const q = pull.querySelector('p').textContent;
  const lt = flow.querySelector('.bs-leadtext');
  const box = pull.getClientRects()[0];
  if (!lt || !box || !q) return false;
  const { colAt, line } = cols;
  const cp = colAt(box.left);
  return sourceRects(lt, q).some(s => {
    const apart = Math.abs(colAt(s.left) - cp);
    const d = Math.max(0, s.top - box.bottom, box.top - s.bottom);
    return (apart === 0 && d < line * 10) || (apart === 1 && d < line * 5);
  });
}

// How ragged the columns end: the largest gap under a column that is not the
// last, and whether that gap follows the end of the lead story.
function measureFlow(page) {
  const flow = page.querySelector('.bs-flow');
  if (!flow) return { score: 0, line: 0, hole: null, ok: true };
  const cols = columnsOf(flow);
  const { colAt, ends, line, bottom } = cols;
  const e = ends();
  const last = e.findLastIndex(v => v > -Infinity);
  const slack = e.map((v, k) => (k < last ? bottom - v : 0));
  const score = Math.max(0, ...slack);
  const lt = flow.querySelector('.bs-leadtext');
  const end = lt && lastRect(lt);
  const c = end ? colAt(end.left) : -1;
  const hole = c >= 0 && c < last && slack[c] >= line * 2.6 && Math.abs(end.bottom - e[c]) < 2
    ? { col: c, slack: slack[c] } : null;
  const pull = flow.querySelector('.bs-pull');
  const ok = !!lt && !lt.querySelector('[data-trimmed], p[data-hidden]') && flow.scrollWidth <= flow.clientWidth + 2
    && !(pull && !pull.hidden && tooClose(flow, pull, cols));
  return { score, line, hole, ok };
}

// Where a pull quote set inside the lead story would close the gap after it:
// quotes taller than the gap, the shortest first, before a paragraph that
// leaves room for the whole quote in its column.
function pullPlacements(page, base) {
  const flow = page.querySelector('.bs-flow');
  const pull = flow?.querySelector('.bs-pull');
  const lt = flow?.querySelector('.bs-leadtext');
  if (!pull || !lt) return [];
  const { r, colAt, line, bottom } = columnsOf(flow);
  const paras = [...lt.querySelectorAll(':scope > p')];
  const starts = paras.map((p, i) => {
    if (i === 0 || p.hidden || p.classList.contains('bs-videonote')) return null;
    const q = p.getClientRects()[0];
    return q ? { i, col: colAt(q.left), top: q.top } : null;
  }).filter(Boolean);
  if (!starts.length) return [];

  const wasHidden = pull.hidden;
  const was = pull.querySelector('p').textContent;
  lt.append(pull);
  pull.hidden = false;
  const cs = getComputedStyle(pull);
  const sized = quotesOf(pull).map(q => {
    setPull(pull, q);
    return { q, h: pull.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom) };
  });
  lt.after(pull);
  setPull(pull, was);
  pull.hidden = wasHidden;

  const gap = base.hole.slack;
  const mid = (r.top + bottom) / 2;
  const out = [];
  sized.filter(s => s.h > gap + line * 0.5).sort((a, b) => a.h - b.h).slice(0, 2).forEach(({ q, h }) => {
    starts
      .filter(s => s.top >= r.top + line * 3 && s.top + h <= bottom - line * 2)
      .sort((a, b) => (b.col === base.hole.col) - (a.col === base.hole.col) || b.col - a.col
        || Math.abs(a.top + h / 2 - mid) - Math.abs(b.top + h / 2 - mid))
      .slice(0, 2)
      .forEach(s => out.push({ quote: q, before: s.i }));
  });
  return out.slice(0, 3);
}

function placePull(page, { quote, before }) {
  const lt = page.querySelector('.bs-leadtext');
  const pull = page.querySelector('.bs-pull');
  const at = lt?.querySelectorAll(':scope > p')[before];
  if (!pull || !at) return;
  setPull(pull, quote);
  pull.hidden = false;
  lt.insertBefore(pull, at);
}

// With `withLast`, the last column is spread too, but only gently: a list of
// items may end level with the page, running text may not.
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
    const cap = c === last ? 0.9 : here.length > 1 ? 2.6 : 1.2;
    const full = Math.min(slack / here.length, line * cap);
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

// The page foot sits either side of the Dock; the running topic goes first if
// it would reach it.
function fitFolio(page) {
  const folio = page.querySelector('.bs-folio');
  if (!folio) return;
  const over = side => {
    const end = side.lastElementChild?.getBoundingClientRect().right ?? 0;
    return end > side.getBoundingClientRect().right + 1 || side.scrollWidth > side.clientWidth + 1;
  };
  for (const side of folio.children) {
    if (!over(side)) continue;
    // The running topic shortens by whole words before it goes.
    const topic = side.querySelector('.bs-folio-topic');
    if (topic) {
      const full = topic.textContent;
      const words = full.split(' ');
      topic.dataset.full = full;
      for (let n = words.length - 1; n >= 2 && over(side); n--) topic.textContent = cut(words, n);
      if (!over(side)) continue;
      topic.textContent = full;
      delete topic.dataset.full;
    }
    const drop = side.querySelector('.bs-folio-topic, .bs-folio-date');
    if (drop) hide(drop);
  }
}

// ---------------------------------------------------------------------------
// Data helpers

function pickPhoto(post, focus) {
  if (post && usable(post.image)) return { img: post.image, post, ratio: ratioOf(post.image.ratio) };
  if (usable(focus.image)) return { img: focus.image, post: null, ratio: ratioOf(focus.image.ratio) };
  return null;
}

// At most one picture among the earlier posts, from a highlighted post or a
// video, and only when the columns are wide enough to carry it.
function pickBriefImages(posts, photo, geo) {
  const ids = new Set();
  if (geo.lead - geo.photo < 3) return ids;
  const max = geo.lead - geo.photo >= 4 ? 2 : 1;
  for (const p of posts.slice(0, 8)) {
    if (ids.size >= max) break;
    if (!usable(p.image) || ratioOf(p.image.ratio) < 1.2) continue;
    if (photo && p.image.url === photo.img.url) continue;
    if (p.highlight || p.hasVideo) ids.add(p.id);
  }
  return ids;
}

// Quotations in the lead text that can stand alone, longest first: whole
// quotes and their sentences.
function pullQuotes(paras) {
  const out = new Set();
  for (const p of paras) {
    for (const m of p.matchAll(/“([^“”]{12,220})”/g)) {
      const q = m[1].trim().replace(/[,;:]$/, '');
      const parts = [q, ...q.split(/(?<=[.!?…])\s+(?=[A-Z“‘])/)];
      for (const part of parts) {
        const t = part.trim();
        if (t.length >= 14 && t.length <= 150 && t.split(' ').length >= 3) out.add(`“${t}”`);
      }
    }
  }
  if (!out.size) {
    // No quotation: a sentence of the story that stands on its own, set as a
    // pull-out without quotation marks.
    const lean = /^(Dat|Die|Dit|Deze|Daar|Daarom|Daarnaast|Daarmee|Hij|Zij|Ze|Er|Maar|En|Ook|Toch|Zo|Wie|Wat|Volgens|Het (gaat|is|was))\b/;
    for (const p of paras) {
      for (const s of p.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
        const t = s.trim();
        if (t.length < 45 || t.length > 120 || !t.endsWith('.') || /[“”‘():;]/.test(t) || lean.test(t)) continue;
        out.add(t);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length).slice(0, 6);
}

// Paragraphs as text, without pointers to a link or an embed the wallpaper
// cannot show ("Lees hier het artikel:").
function prose(list) {
  return (list ?? []).map(typo).filter(p => p && !(p.length < 110 && (
    (p.length < 80 && p.endsWith(':'))
    || /^(Lees|Bekijk|Herbekijk|Kijk|Luister|Volg)\b.*\b(hier|hieronder|artikel|video|beelden|reportage|liveblog|podcast)\b/i.test(p))));
}

function usable(img) {
  return !!(img && img.url && !img.sensitive);
}

function ratioOf(r) {
  const [a, b] = String(r || '16/9').split('/').map(Number);
  return a > 0 && b > 0 ? a / b : 16 / 9;
}

function captionFor(img, post) {
  if (img.caption) return img.caption;
  let alt = (img.alt || '').trim();
  if (!alt) return null;
  alt = alt.replace(/^Foto\s+/i, '');
  if (img.credit) alt = alt.replace(img.credit, '').trim();
  alt = alt.replace(/\s*Foto:.*$/i, '').trim();
  return alt || null;
}

function creditFor(img) {
  if (!img.credit) return null;
  return img.credit.trim().replace(/\.$/, '').replace(/^Foto:\s*/i, 'Foto ');
}

function videoNote(post) {
  if (!post.hasVideo) return null;
  const v = post.blocks?.find(b => b.type === 'video');
  const s = v?.durationSec;
  if (!s) return 'Video';
  return `Video ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function stripFollow(text) {
  return String(text || '')
    .replace(/\s*(Volg|Lees)[^.]*?(liveblog|hier)[^.]*\.?\s*$/i, '')
    .trim();
}

function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function berichten(n) {
  return `${n} ${n === 1 ? 'bericht' : 'berichten'}`;
}

// The flag: the running topic, or a short title; a long title never goes up there.
function flagText(focus) {
  const topic = typo(focus.topic);
  if (topic) return topic;
  const title = typo(focus.title);
  return title && title.length <= 40 ? title : 'Liveblog';
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
    .replace(/([^.])\.\.(?=\s|$)/g, '$1.')
    .replace(/ - /g, ' – ');
}
