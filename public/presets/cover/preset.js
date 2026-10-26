// Cover: a photo-led magazine cover. One full-bleed lead photo, the newest
// update set as the cover line, earlier updates as sell-lines on the right.

const LANDSCAPE = 1.2; // width / height at or above this may run full-bleed
const RAIL_MAX = 6;
const HEADLINE_MAX_LINES = 4;
const RAIL_MIN_SHARE = 0.36; // the sell-lines may always use this much of the screen height

// Deep tones for the no-photo cover, picked per topic so a story keeps its colour.
const TONES = [
  ['#2a0f14', '#6b1d26'], // oxblood
  ['#0c1626', '#1f3a63'], // ink
  ['#0d1f1b', '#1e4a3e'], // forest
  ['#1c1024', '#47264f'], // aubergine
  ['#0f1c22', '#22505b'], // petrol
  ['#231a0e', '#5c3f17'], // umber
];

export default {
  id: 'cover',
  name: 'Cover',
  tone: 'dark',

  render(root, data, ctx) {
    const { h } = ctx;
    const blog = data.focus ?? {};
    const topic = clean(blog.topic) || 'Liveblog';
    const posts = (blog.posts ?? []).filter(p => clean(p.title) || p.paragraphs?.length);
    const lead = posts[0] ?? null;
    const live = blog.status === 'live';
    const photo = pickPhoto(blog, posts);
    const tone = TONES[hash(blog.topic || blog.id) % TONES.length];

    // An untitled update leads with its first sentence, set without the full stop.
    const headlineText = clean(lead?.title) || firstSentence(lead).replace(/(?<!\.)\.$/, '') || clean(blog.title) || topic;
    const dek = lead && clean(lead.title) ? firstParagraph(lead, headlineText) : '';
    const leadTs = lead?.timestamp ?? blog.updatedAt;
    const hasTs = Number.isFinite(leadTs);

    root.setAttribute('lang', 'nl');
    root.classList.toggle('is-photo', !!photo);
    root.classList.toggle('is-ended', !live);
    root.style.setProperty('--tone-a', tone[0]);
    root.style.setProperty('--tone-b', tone[1]);

    // --- background --------------------------------------------------------
    const backdrop = photo
      ? h('img', {
        class: 'cv-photo',
        src: ctx.image(photo.image, ctx.screen.width),
        alt: '',
        '--pos': photo.position,
      })
      : h('div', { class: 'cv-tonal' },
        h('div', { class: 'cv-ghost', 'aria-hidden': 'true' }, typeset(topic)),
      );

    // --- cover line ---------------------------------------------------------
    const kicker = h('p', { class: 'cv-kicker' },
      h('span', { class: 'cv-kicker-rule' }),
      h('span', { class: 'cv-kicker-text' }, topic),
    );

    const scale = startScale(headlineText);
    const headline = h('h1', {
      class: cls('cv-headline', lead && ctx.fresh.has(lead.id) && 'is-fresh', /^[“‘"']/.test(headlineText) && 'is-hung'),
      dataset: { k: String(scale) },
      '--hl-k': String(scale),
    }, richTitle(h, headlineText));

    const status = live
      ? h('span', { class: 'cv-live' }, h('i', { class: 'cv-live-dot' }), 'Live')
      : h('span', { class: 'cv-live is-off' }, h('i', { class: 'cv-live-dot' }), 'Einde liveblog');

    const author = clean(lead?.author);
    const meta = h('p', { class: 'cv-meta' },
      status,
      hasTs ? h('span', { class: 'cv-meta-time' }, `${live ? '' : 'laatste update '}${stamp(leadTs, ctx)}`) : null,
      live && hasTs ? h('span', { class: 'cv-meta-ago' }, ctx.ago(leadTs, ctx.now.getTime())) : null,
      author ? h('span', { class: 'cv-meta-by' }, author) : null,
    );

    const dekText = typeset(dek);
    const main = h('section', { class: 'cv-main' },
      h('div', { class: 'cv-main-inner' },
        kicker,
        headline,
        dekText ? h('p', { class: 'cv-dek', dataset: { full: dekText } }, dekText) : null,
        meta,
      ),
    );

    // --- sell-lines ---------------------------------------------------------
    const earlier = posts.slice(1, 1 + RAIL_MAX);
    const rail = earlier.length
      ? h('aside', { class: 'cv-rail' },
        h('div', { class: 'cv-rail-inner' },
          h('p', { class: 'cv-rail-label' }, live ? 'Eerder in deze liveblog' : 'Eerder in de liveblog'),
          h('ol', { class: 'cv-sells' }, earlier.map(p => {
            const title = clean(p.title);
            const text = typeset(title || firstSentence(p));
            const when = Number.isFinite(p.timestamp) ? stampParts(p.timestamp, ctx) : { time: '', day: '' };
            return h('li', { class: cls('cv-sell', p.highlight && 'is-highlight', ctx.fresh.has(p.id) && 'is-fresh') },
              h('span', { class: 'cv-sell-when' },
                h('span', { class: 'cv-sell-time' }, when.time),
                when.day ? h('span', { class: 'cv-sell-day' }, when.day) : null,
              ),
              h('span', { class: cls('cv-sell-title', !title && 'is-untitled'), dataset: { full: text } }, text),
            );
          })),
        ),
      )
      : null;

    // --- frame --------------------------------------------------------------
    // When the news was fetched; the meta line gives the update's own time.
    const refreshed = Date.parse(data.generatedAt);
    const folio = h('header', { class: 'cv-folio' },
      h('span', { class: 'cv-folio-date' }, ctx.date(ctx.now, 'long')),
      h('span', { class: 'cv-source' },
        Number.isNaN(refreshed) ? null : h('span', { class: 'cv-updated' }, 'Bijgewerkt ', h('span', { class: 'cv-time' }, ctx.time(refreshed))),
        'VRT NWS'),
    );

    const credit = photo ? photoCredit(photo.image) : null;

    root.append(...[
      h('div', { class: 'cv-bg' }, backdrop),
      h('div', { class: 'cv-scrim' }),
      h('div', { class: 'cv-grain' }),
      folio,
      h('div', { class: 'cv-stage' }, main, rail),
      credit?.full ? h('p', { class: 'cv-credit', dataset: { full: credit.full, short: credit.short } }, credit.full) : null,
    ].filter(Boolean));
  },

  // Runs after render and again once the web fonts land, so every step starts
  // by undoing what an earlier pass changed.
  layout(root) {
    const q = s => root.querySelector(s);
    const main = q('.cv-main');
    const inner = q('.cv-main-inner');
    const headline = q('.cv-headline');
    if (!main || !inner || !headline) return;

    root.querySelectorAll('[data-dropped]').forEach(el => { el.hidden = false; delete el.dataset.dropped; });
    root.querySelectorAll('[data-full]').forEach(el => { el.textContent = el.dataset.full; });
    const u = Math.min(root.clientWidth / 100, (root.clientHeight * 1.6) / 100);

    // 1. Standfirst: whole sentences within its two lines.
    const dek = q('.cv-dek');
    if (dek) fitText(dek);

    // 2. Cover line: shrink until it sits in at most four lines with no word
    //    sticking out of the column; if the block is still too tall for its
    //    slot, lose the standfirst first, then shrink further.
    let k = Number(headline.dataset.k) || 1;
    const setK = v => { k = v; headline.style.setProperty('--hl-k', v); };
    const lineCount = () => Math.round(headline.getBoundingClientRect().height / parseFloat(getComputedStyle(headline).lineHeight));
    const fitsWidth = () => lineCount() <= HEADLINE_MAX_LINES && headline.scrollWidth <= headline.clientWidth + 1;
    const fitsHeight = () => inner.offsetHeight <= main.clientHeight;
    setK(k);
    while (!fitsWidth() && k > 0.5) setK(Math.round((k - 0.03) * 100) / 100);
    if (!fitsHeight() && dek) drop(dek);
    while (!fitsHeight() && k > 0.5) setK(Math.round((k - 0.03) * 100) / 100);

    // Byline only while the meta row stays on one line.
    const by = q('.cv-meta-by');
    if (by) {
      const mid = el => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
      if (Math.abs(mid(by) - mid(by.parentElement.firstElementChild)) > 3) drop(by);
    }

    // 3. Sell-lines end on the meta line and may rise as high as the kicker,
    //    or to a floor so a one-line cover line still gets a few. Oldest
    //    items go first. When they fit under the kicker, the leftover space is
    //    shared out between them so the heading lines up with the kicker.
    const rail = q('.cv-rail');
    if (rail) {
      const railInner = q('.cv-rail-inner');
      const floor = root.clientHeight * RAIL_MIN_SHARE;
      const height = Math.min(main.clientHeight, Math.max(inner.offsetHeight, floor));
      rail.style.height = `${height}px`;
      rail.style.setProperty('--sell-extra', '0px');
      const sells = [...root.querySelectorAll('.cv-sell')];
      sells.forEach(li => fitText(li.querySelector('.cv-sell-title')));
      while (sells.length && railInner.offsetHeight > height) drop(sells.pop());
      if (!sells.length) drop(rail);
      else if (railInner.offsetHeight < inner.offsetHeight) {
        const extra = Math.min((inner.offsetHeight - railInner.offsetHeight) / sells.length, 1.8 * u);
        rail.style.setProperty('--sell-extra', `${extra}px`);
      }
    }

    // 4. Photo credit: one clean line along the edge, or the short credit.
    const credit = q('.cv-credit');
    if (credit && overflows(credit)) {
      if (credit.dataset.short) credit.textContent = credit.dataset.short;
      if (!credit.dataset.short || overflows(credit)) drop(credit);
    }

    // 5. The scrim starts just above the highest text, so short cover lines
    //    leave more of the photo untouched.
    const rootTop = root.getBoundingClientRect().top;
    const tops = [inner, rail && !rail.hidden ? q('.cv-rail-inner') : null]
      .filter(el => el?.offsetHeight)
      .map(el => el.getBoundingClientRect().top - rootTop);
    const textTop = Math.min(...tops);
    root.style.setProperty('--text-top', `${textTop}px`);

    // 6. No photo: the ghosted topic fills the band above the text, never
    //    behind it. Shrink it to fit, or leave it out if the band is too thin.
    const ghost = q('.cv-ghost');
    if (ghost) {
      let g = 1;
      const limit = textTop - 3.4 * u; // its descenders hang below the box
      const fitsGhost = () => ghost.getBoundingClientRect().bottom - rootTop <= limit && ghost.scrollWidth <= ghost.clientWidth + 1;
      ghost.style.setProperty('--ghost-k', g);
      while (!fitsGhost() && g > 0.4) {
        g = Math.round((g - 0.04) * 100) / 100;
        ghost.style.setProperty('--ghost-k', g);
      }
      if (!fitsGhost()) drop(ghost);
    }
  },
};

function drop(el) {
  el.hidden = true;
  el.dataset.dropped = '';
}

// A serif's ascenders poke a pixel or two out of a tight line box, so a
// line-clamped block only counts as cut when at least half a line is hidden.
function overflows(el, slack = 1) {
  return el.scrollHeight > el.clientHeight + slack || el.scrollWidth > el.clientWidth + 1;
}

function clamped(el) {
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 0;
  return overflows(el, Math.max(2, lh / 2));
}

// Cut a line-clamped text so it ends cleanly: drop whole sentences first, and
// only if one sentence is still too long, end it on a word with an ellipsis.
function fitText(el) {
  if (!el || !clamped(el)) return;
  const full = el.dataset.full ?? el.textContent;
  const sentences = full.split(/(?<=[.!?…]["”’)]?)\s+(?=[A-ZÀ-Þ“‘"'(0-9])/);
  for (let n = sentences.length - 1; n >= 1; n--) {
    el.textContent = sentences.slice(0, n).join(' ');
    if (!clamped(el)) return;
  }
  const words = sentences[0].split(' ');
  const cut = n => `${words.slice(0, n).join(' ').replace(/[\s,;:–—-]+$/, '')}…`;
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = cut(mid);
    if (clamped(el)) hi = mid - 1;
    else lo = mid;
  }
  el.textContent = cut(lo);
}

// ---------------------------------------------------------------------------
// Photo choice

function pickPhoto(blog, posts) {
  const usable = img => img?.url && !img.sensitive && ratio(img) >= LANDSCAPE;
  if (usable(blog.image)) return { image: blog.image, position: position(blog.image) };
  for (const p of posts.slice(0, 20)) {
    if (usable(p.image)) return { image: p.image, position: position(p.image) };
  }
  return null;
}

function ratio(img) {
  const [w, h] = String(img?.ratio ?? '').split('/').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

// Keep faces and horizons: news photos sit their subject a little above centre.
function position(img) {
  return ratio(img) > 1.6 ? '50% 42%' : '50% 36%';
}

function photoCredit(img) {
  let credit = clean(img.credit).replace(/\.$/, '');
  if (credit) {
    credit = credit.replace(/^(©\s*)?\d{4}\s+/, '');
    if (!/^(foto|beeld|©)/i.test(credit)) credit = `Foto: ${credit}`;
  }
  const caption = typeset(clean(img.caption).replace(/\.$/, ''));
  return { full: [caption, credit].filter(Boolean).join('  ·  '), short: credit };
}

// ---------------------------------------------------------------------------
// Text

function cls(...names) {
  return names.filter(Boolean).join(' ');
}

function clean(s) {
  return String(s ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Typographer's quotes and apostrophes: "x" → “x”, Houthi's → Houthi’s.
function typeset(s) {
  return clean(s)
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/"/g, '”')
    .replace(/(^|[\s(“])'(?!s\b)(?=\S)/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/ - /g, ' – ');
}

// Quotations in a cover line are set in italic.
function richTitle(h, text) {
  return typeset(text)
    .split(/(“[^”]*”)/)
    .filter(Boolean)
    .map(part => (part.startsWith('“') ? h('em', null, part) : part));
}

function firstParagraph(post, title) {
  const para = (post.paragraphs ?? []).map(clean).find(p => p && !p.startsWith('•'));
  if (!para || para === title) return '';
  return para;
}

function firstSentence(post) {
  const para = (post?.paragraphs ?? []).map(clean).find(p => p && !p.startsWith('•'))
    ?? (post?.paragraphs ?? []).map(p => clean(p).replace(/^•\s*/, '')).find(Boolean);
  if (!para) return '';
  const m = para.match(/^.{20,140}?[.!?](?=\s|$)/);
  return m ? m[0] : para.length > 140 ? `${para.slice(0, 140).replace(/\s+\S*$/, '')}…` : para;
}

// Short cover lines go big; long ones start smaller and layout() fits the rest.
function startScale(text) {
  const n = text.length;
  if (n <= 36) return 1.12;
  if (n <= 60) return 1;
  if (n <= 90) return 0.9;
  if (n <= 115) return 0.82;
  return 0.74;
}

// 20u38 today, "gisteren 20u38", otherwise "vr 20u38".
function stamp(ts, ctx) {
  const { time, day } = stampParts(ts, ctx);
  return day ? `${day} ${time}` : time;
}

function stampParts(ts, ctx) {
  const d = new Date(ts);
  const now = ctx.now;
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const time = ctx.time(ts);
  if (diff <= 0) return { time, day: '' };
  if (diff === 1) return { time, day: 'gisteren' };
  return { time, day: ctx.date(ts, 'short').split(' ')[0] };
}

function hash(s) {
  let x = 0;
  for (const c of String(s)) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return x;
}
