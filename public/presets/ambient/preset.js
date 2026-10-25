// Ambient: a calm, mostly empty desktop. The liveblog's lead photo dissolves
// into a dark colour field; one small typographic block in the lower-left
// corner carries the latest update, with a hairline trace of recent activity.

const HOUR = 3_600_000;
// Candidate spans for the activity trace, in hours: the shortest one that
// holds at least MIN_TICKS updates wins.
const SPANS = [3, 6, 12, 24, 48, 72, 168];
const MIN_TICKS = 5;
const MAX_HEADLINE_LINES = 3;
const PULSE_MS = 4_000;

export default {
  id: 'ambient',
  name: 'Ambient',
  tone: 'dark',

  render(root, data, ctx) {
    const { h } = ctx;
    const blog = data?.focus ?? {};
    const posts = [...(blog.posts ?? [])].sort((a, b) => b.timestamp - a.timestamp);
    const latest = posts[0] ?? null;
    const live = blog.status !== 'ended';
    const now = ctx.now.getTime();
    const fresh = Boolean(latest && ctx.fresh.has(latest.id));

    const title = headlineFor(latest, blog);
    const deks = dekCandidates(latest, blog, title).map(smarten);
    const field = pickImage(blog, posts);
    const shortSide = Math.min(ctx.screen.width, ctx.screen.height);

    root.append(h('div', {
      class: `aw ${live ? 'is-live' : 'is-ended'}`,
      '--hue': String(hueOf(blog.topic || blog.title || '')),
      '--blur': `${Math.round(shortSide * 0.11)}px`,
      // Keep the slow pulse continuous across the per-minute re-render.
      '--pulse-delay': `${-((now % PULSE_MS) / 1000).toFixed(2)}s`,
    },
      h('div', { class: 'aw-field', 'aria-hidden': 'true' },
        // Cached + sync decode: the photo paints in the same frame on every
        // re-render, so the colour field never flashes to the fallback.
        field ? h('img', { class: 'aw-photo', src: ctx.image(field, 480), alt: '', decoding: 'sync' }) : null,
        h('div', { class: 'aw-shade' }),
        h('div', { class: 'aw-grain' }),
      ),

      h('section', { class: `aw-block${fresh ? ' is-fresh' : ''}` },
        h('p', { class: 'aw-kicker' },
          h('span', { class: 'aw-state' }, h('i', { class: 'aw-dot' }), live ? 'Live' : 'Afgelopen'),
          h('span', { class: 'aw-topic' }, blog.topic || 'Liveblog'),
          latest ? h('span', { class: 'aw-when' }, stamp(latest.timestamp, ctx)) : null,
        ),
        h('h1', { class: 'aw-headline' }, hang(smarten(title), h)),
        deks.length ? h('p', { class: 'aw-dek', dataset: { options: JSON.stringify(deks) } }, deks[0]) : null,
        footer(blog, posts, live, now, ctx),
      ),
    ));
  },

  layout(root, ctx) {
    const block = root.querySelector('.aw-block');
    if (!block) return;
    // Layout runs more than once (again when fonts land): start clean.
    block.querySelectorAll('[data-dropped]').forEach(el => {
      el.hidden = false;
      delete el.dataset.dropped;
    });

    // Fit the headline to three lines: shrink a little before clamping.
    const hl = block.querySelector('.aw-headline');
    hl.style.fontSize = '';
    hl.classList.add('is-measuring');
    const base = parseFloat(getComputedStyle(hl).fontSize);
    const lines = () => Math.round(hl.offsetHeight / parseFloat(getComputedStyle(hl).lineHeight));
    for (let size = base; lines() > MAX_HEADLINE_LINES && size > base * 0.8;) {
      size -= base * 0.04;
      hl.style.fontSize = `${size}px`;
    }
    hl.classList.remove('is-measuring');

    // One line of supporting text: the first candidate sentence that fits
    // whole, otherwise the first one cut at a word, never mid-word.
    const dek = block.querySelector('.aw-dek');
    if (dek) fitDek(dek, JSON.parse(dek.dataset.options || '[]'));

    // The block grows upward from the bottom; if it would reach the menu bar,
    // drop the quietest parts first. The credit always stays.
    const limit = ctx.safe.top + base * 1.2;
    for (const sel of ['.aw-axis', '.aw-dek', '.aw-note']) {
      if (block.offsetTop >= limit) break;
      const el = block.querySelector(sel);
      if (el) {
        el.hidden = true;
        el.dataset.dropped = '';
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Fitting

function overflows(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width - 0.5;
}

// Words a cut line should not end on.
const DANGLING = new Set('de het een en of van voor in op met aan te om dat die bij naar door als tot uit over hun haar zijn zijn ook nog maar want'.split(' '));

function fitDek(el, options) {
  if (!options.length) {
    el.hidden = true;
    return;
  }
  for (const text of options) {
    el.textContent = text;
    if (!overflows(el)) return;
  }
  // Nothing fits whole: cut the first candidate at a word boundary.
  const words = options[0].split(/\s+/);
  const cut = n => {
    const kept = words.slice(0, n);
    while (kept.length > 1 && DANGLING.has(kept.at(-1).toLowerCase().replace(/[^\p{L}]/gu, ''))) kept.pop();
    return `${kept.join(' ').replace(/[,;:–—-]+$/, '')}…`;
  };
  let lo = 1, hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = cut(mid);
    if (overflows(el)) hi = mid - 1; else lo = mid;
  }
  el.textContent = cut(lo);
  if (overflows(el)) el.hidden = true;
}

// ---------------------------------------------------------------------------
// Content

function headlineFor(post, blog) {
  if (post?.title?.trim()) return post.title.trim();
  // No title: the first sentence stands in, set as a headline (no full stop).
  const sentence = sentencesOf(firstParagraph(post))[0]?.replace(/(?<!\.)\.$/, '');
  if (sentence) return sentence.length > 160 ? `${sentence.slice(0, 157).replace(/\s+\S*$/, '')}…` : sentence;
  return blog.title || blog.topic || 'Liveblog';
}

function firstParagraph(post) {
  return (post?.paragraphs ?? []).map(p => p.replace(/^•\s*/, '').trim()).find(Boolean) ?? '';
}

// Supporting line: sentences from the start of the post that add something
// to the headline. Without posts, the liveblog intro (minus "Volg …").
function dekCandidates(post, blog, title) {
  const paras = post ? (post.paragraphs ?? []) : [blog.intro ?? ''];
  const sentences = paras
    .slice(0, 2)
    .map(p => p.replace(/^•\s*/, '').trim())
    .filter(Boolean)
    .flatMap(sentencesOf);
  const titleWords = new Set(contentWords(title));
  return sentences
    .filter((s, i) => {
      if (/^volg\b|liveblog/i.test(s)) return false;
      // A later sentence that leans on the previous one reads oddly alone.
      if (i > 0 && /^(dat|dit|die|daarbij|daarnaast|daarop|toen|hij|zij|ze)\b/i.test(s)) return false;
      const words = [...new Set(contentWords(s))];
      if (!words.length) return false;
      // Skip a sentence that restates the headline: one that is mostly
      // headline words, or that repeats most of the headline's words.
      const shared = words.filter(w => titleWords.has(w)).length;
      return shared / words.length < 0.6 && shared / Math.max(titleWords.size, 1) < 0.6;
    })
    .slice(0, 2);
}

function sentencesOf(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?…]["”’)]?)\s+(?=["“‘(]?[\p{Lu}\d])/u)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

function contentWords(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(w => w.length >= 4);
}

function pickImage(blog, posts) {
  const ok = img => img && img.url && !img.sensitive;
  if (ok(blog.image)) return blog.image;
  return posts.find(p => ok(p.image))?.image ?? null;
}

// Typographic quotes and dashes for a headline set in a book face.
function smarten(s) {
  return s
    .replace(/\s+-\s+/g, ' – ')
    .replace(/(^|[\s(\[–—])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[–—])'/g, '$1‘')
    .replace(/'/g, '’');
}

// Hang an opening quote into the margin so the text edge stays straight.
function hang(text, h) {
  const m = text.match(/^([“‘])/);
  return m ? [h('span', { class: 'aw-hang' }, m[1]), text.slice(1)] : [text];
}

function stamp(ts, ctx) {
  const d = new Date(ts);
  const today = new Date(ctx.now);
  if (d.toDateString() === today.toDateString()) return ctx.time(ts);
  today.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `gisteren ${ctx.time(ts)}`;
  return `${ctx.date(ts, 'short')} ${ctx.time(ts)}`;
}

function hueOf(str) {
  let x = 0;
  for (const ch of str) x = (x * 31 + ch.codePointAt(0)) % 360;
  return x;
}

// ---------------------------------------------------------------------------
// Footer: a hairline tick per update over a recent span, one quiet caption,
// and the source credit (always present).

function footer(blog, posts, live, now, ctx) {
  const { h } = ctx;
  let axis = null;
  let note = null;

  if (posts.length) {
    const end = live ? now : posts[0].timestamp;
    const want = Math.min(MIN_TICKS, posts.length);
    const hours = SPANS.find(n => posts.filter(p => p.timestamp > end - n * HOUR).length >= want) ?? SPANS.at(-1);
    const ms = hours * HOUR;
    const start = end - ms;
    const inSpan = posts.filter(p => p.timestamp > start && p.timestamp <= end + 60_000);
    // Ticks are 1px wide: pull each back by its share of that pixel so the
    // last one ends on the axis instead of 1px past it.
    const x = ts => {
      const pct = Math.min(100, Math.max(0, ((ts - start) / ms) * 100));
      return `calc(${pct.toFixed(3)}% - ${(pct / 100).toFixed(3)}px)`;
    };

    if (inSpan.length) {
      axis = h('div', { class: 'aw-axis' },
        [...inSpan].reverse().map((p, i, all) => h('i', {
          class: [
            'aw-tick',
            p.highlight && 'is-hl',
            i === all.length - 1 && 'is-latest',
            ctx.fresh.has(p.id) && 'is-fresh',
          ].filter(Boolean).join(' '),
          style: { left: x(p.timestamp) },
        })),
      );
    }

    const spanLabel = hours <= 24 ? `${hours} uur` : hours === 168 ? 'week' : `${hours / 24} dagen`;
    const others = inSpan.length - 1;
    if (!live) {
      note = blog.postCount ? `Liveblog afgesloten na ${blog.postCount} updates` : 'Liveblog afgesloten';
    } else if (others > 0) {
      note = `Nog ${others} ${others === 1 ? 'update' : 'updates'} in de ${hours === 168 ? 'afgelopen' : 'laatste'} ${spanLabel}`;
    } else if (others === 0) {
      note = `Geen andere updates in de ${hours === 168 ? 'afgelopen' : 'laatste'} ${spanLabel}`;
    } else {
      note = 'Geen updates in de afgelopen week';
    }
  } else if (blog.intro) {
    note = live ? 'Nog geen updates' : 'Liveblog afgesloten';
  }

  return h('footer', { class: 'aw-foot' },
    axis,
    h('p', { class: 'aw-caption' },
      note ? h('span', { class: 'aw-note' }, note) : null,
      h('span', { class: 'aw-credit' }, 'VRT NWS'),
    ),
  );
}
