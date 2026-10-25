// Generic RSS 2.0 / RSS 1.0 (RDF) / Atom reader. parseFeed() turns any of the
// three into one entry shape, and normalizeEntry() turns an entry into the
// stream item model (integrations/README.md). Outlet-specific fixes (premium
// markers, image templates, sections) run after this, in each outlet module.

import { decodeEntities, firstImageInHtml, htmlToParagraphs, htmlToText } from './html.mjs';
import { child, childrenNamed, childText, descendants, elements, parseXml, serialize, textOf } from './xml.mjs';

export function parseFeed(xml) {
  const root = elements(parseXml(xml))[0];
  if (!root) throw new Error('Empty response, expected a feed');
  const name = root.name.replace(/^.*:/, '');
  if (name === 'feed') return readAtom(root);
  if (name === 'rss') return readRss(child(root, 'channel') ?? root, 'rss2', childrenNamed(child(root, 'channel'), 'item'));
  if (name === 'RDF') return readRss(child(root, 'channel') ?? root, 'rdf', childrenNamed(root, 'item'));
  throw new Error(`Not a feed: the document starts with <${root.name}>`);
}

// ---------------------------------------------------------------------------
// RSS 2.0 and RDF

function readRss(channel, format, items) {
  return {
    format,
    title: htmlToText(childText(channel, 'title')),
    link: childText(channel, 'link'),
    updated: childText(channel, 'lastBuildDate', 'pubDate', 'dc:date'),
    entries: items.map(item => {
      const guid = child(item, 'guid');
      const link = childText(item, 'link') || (guid?.attrs.isPermaLink !== 'false' ? textOf(guid).trim() : '')
        || child(item, 'atom:link')?.attrs.href || '';
      return {
        node: item,
        id: textOf(guid).trim() || item.attrs['rdf:about'] || link,
        title: childText(item, 'title'),
        link,
        summaryHtml: textOf(child(item, 'description', 'dc:description')),
        contentHtml: textOf(child(item, 'content:encoded')),
        published: childText(item, 'pubDate', 'dc:date', 'a10:updated'),
        updated: childText(item, 'atom:updated', 'dcterms:modified', 'a10:updated'),
        authors: [
          ...childrenNamed(item, 'dc:creator').map(textOf),
          ...childrenNamed(item, 'author').map(textOf),
        ],
        categories: [
          ...childrenNamed(item, 'category').map(textOf),
          ...childrenNamed(item, 'dc:subject').map(textOf),
        ],
        media: mediaCandidates(item),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Atom

function readAtom(feed) {
  return {
    format: 'atom',
    title: htmlToText(atomText(child(feed, 'title'))),
    link: atomLink(feed),
    updated: childText(feed, 'updated'),
    entries: childrenNamed(feed, 'entry').map(entry => ({
      node: entry,
      id: childText(entry, 'id'),
      title: atomText(child(entry, 'title')),
      link: atomLink(entry),
      summaryHtml: atomText(child(entry, 'summary')),
      contentHtml: atomText(child(entry, 'content')),
      published: childText(entry, 'published', 'issued', 'updated'),
      updated: childText(entry, 'updated', 'modified'),
      authors: childrenNamed(entry, 'author').map(a => childText(a, 'name') || textOf(a)),
      categories: childrenNamed(entry, 'category').map(c => c.attrs.label || c.attrs.term || textOf(c)),
      media: [
        ...mediaCandidates(entry),
        ...childrenNamed(entry, 'link')
          .filter(l => l.attrs.rel === 'enclosure' && l.attrs.href)
          .map(l => ({ url: l.attrs.href, kind: 'enclosure', type: l.attrs.type ?? '', medium: '', width: null, height: null, alt: '', credit: '' })),
      ],
    })),
  };
}

// Atom text constructs: type="xhtml" holds markup as child elements.
function atomText(node) {
  if (!node) return '';
  return node.attrs.type === 'xhtml' ? serialize(elements(node)[0] ?? node, { inner: true }) : textOf(node);
}

function atomLink(node) {
  const links = childrenNamed(node, 'link');
  const pick = links.find(l => l.attrs.rel === 'alternate' && (!l.attrs.type || l.attrs.type === 'text/html'))
    ?? links.find(l => !l.attrs.rel)
    ?? links.find(l => l.attrs.rel === 'alternate');
  return pick?.attrs.href ?? '';
}

// ---------------------------------------------------------------------------
// Images: Media RSS, enclosures and thumbnails, wherever a feed puts them

function mediaCandidates(item) {
  const out = [];
  const add = (el, kind) => {
    const url = el.attrs.url || el.attrs.href;
    if (!url) return;
    out.push({
      url,
      kind,
      type: el.attrs.type ?? '',
      medium: el.attrs.medium ?? '',
      width: num(el.attrs.width),
      height: num(el.attrs.height),
      alt: htmlToText(childText(el, 'media:description') || childText(el, 'media:title')),
      credit: htmlToText(childText(el, 'media:credit')),
    });
  };
  for (const el of descendants(item, 'media:content')) add(el, 'media:content');
  for (const el of descendants(item, 'media:thumbnail')) add(el, 'media:thumbnail');
  for (const el of childrenNamed(item, 'enclosure')) add(el, 'enclosure');
  for (const el of childrenNamed(item, 'image')) {
    const url = childText(el, 'url') || textOf(el).trim();
    if (/^https?:\/\//.test(url)) out.push({ url, kind: 'image', type: '', medium: '', width: null, height: null, alt: '', credit: '' });
  }
  return out;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

function isImage(m) {
  if (m.medium) return m.medium === 'image';
  if (m.type) return m.type.startsWith('image/');
  return IMAGE_EXT.test(m.url) || m.kind === 'media:thumbnail' || m.kind === 'image';
}

export function pickImage(entry) {
  const images = entry.media.filter(isImage);
  // Full-size media before thumbnails; among the same kind, the widest.
  const best = [...images].sort((a, b) => rank(a) - rank(b) || (b.width ?? 0) - (a.width ?? 0))[0];
  if (best) {
    return {
      url: best.url,
      alt: best.alt || '',
      credit: best.credit || null,
      width: best.width,
      height: best.height,
      source: best.kind,
    };
  }
  const inline = firstImageInHtml(entry.contentHtml) ?? firstImageInHtml(entry.summaryHtml);
  return inline ? { url: decodeEntities(inline.url), alt: inline.alt, credit: null, width: null, height: null, source: 'html' } : null;
}

const rank = m => ['media:content', 'enclosure', 'image', 'media:thumbnail'].indexOf(m.kind);

// ---------------------------------------------------------------------------
// Entry → stream item

// Trailers that CMSes append to summaries; they say nothing about the story.
const SUMMARY_TRAILERS = [
  /\s*The post .{1,300} appeared first on .{1,120}\.?$/i,
  /\s*(Lees (verder|meer)|Lire la suite|Weiterlesen|Read more|Continue reading)\s*(\.\.\.|…|»|›|>)?\s*$/i,
  /\s*\[(…|\.\.\.)\]\s*$/,
];

export function normalizeEntry(entry) {
  const title = htmlToText(entry.title);
  const paragraphs = htmlToParagraphs(entry.contentHtml);
  let summary = htmlToText(entry.summaryHtml);
  for (const re of SUMMARY_TRAILERS) summary = summary.replace(re, '');
  if (!summary && paragraphs.length) summary = paragraphs.slice(0, 2).join(' ');
  if (summary === title) summary = '';

  const publishedAt = parseDate(entry.published);
  const updatedAt = parseDate(entry.updated);
  const url = cleanUrl(entry.link);

  return {
    id: entry.id || url || `${title}|${publishedAt}`,
    kind: 'article',
    url,
    title,
    summary: summary || null,
    publishedAt: publishedAt ?? updatedAt,
    updatedAt: updatedAt && updatedAt !== publishedAt ? updatedAt : null,
    authors: unique(entry.authors.flatMap(cleanAuthor)),
    categories: unique(entry.categories.map(c => htmlToText(c))),
    image: pickImage(entry),
    premium: false,
    paragraphs: paragraphs.length > 1 ? paragraphs : null,
  };
}

const TRACKING_PARAMS = /^(utm_[a-z]+|xtor|at_medium|at_campaign|ns_source|ns_mchannel|ns_campaign|cmpid|ito|ref)$/i;

export function cleanUrl(href) {
  const raw = decodeEntities(String(href ?? '').trim());
  if (!raw) return '';
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    if (/^#?(ref|utm)/i.test(u.hash)) u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

// 'jan@x.be (Jan Peeters)' → 'Jan Peeters'; bare e-mail addresses are dropped.
function cleanAuthor(raw) {
  let s = htmlToText(raw);
  s = s.match(/^\S+@\S+\s*\((.+)\)$/)?.[1] ?? s.replace(/\s*<[^>]*@[^>]*>\s*/, '');
  if (!s || /^\S+@\S+$/.test(s)) return [];
  return [s.replace(/^(door|par|von|by)\s+/i, '').trim()];
}

function unique(list) {
  const seen = new Set();
  return list.filter(s => {
    const key = s.toLowerCase();
    if (!s || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function num(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Dates. RFC 822 with zone names, ISO 8601, and the localized day and month
// names some Belgian CMSes emit ('mar., 21 oct. 2026 14:05:00 +0200').

const ZONES = { UT: '+0000', UTC: '+0000', GMT: '+0000', Z: '+0000', WET: '+0000', WEST: '+0100', BST: '+0100', CET: '+0100', CEST: '+0200', MET: '+0100', MEST: '+0200', EET: '+0200', EEST: '+0300', EST: '-0500', EDT: '-0400', CST: '-0600', CDT: '-0500', PST: '-0800', PDT: '-0700' };
const MONTHS = [
  ['jan', 'janv', 'januari', 'janvier', 'januar', 'january'],
  ['feb', 'févr', 'fevr', 'februari', 'février', 'fevrier', 'februar', 'february'],
  ['mar', 'mrt', 'maart', 'mars', 'märz', 'march'],
  ['apr', 'avr', 'april', 'avril'],
  ['may', 'mei', 'mai'],
  ['jun', 'juin', 'juni', 'june'],
  ['jul', 'juil', 'juli', 'juillet', 'july'],
  ['aug', 'août', 'aout', 'augustus', 'august'],
  ['sep', 'sept', 'september', 'septembre'],
  ['oct', 'okt', 'oktober', 'octobre', 'october'],
  ['nov', 'november', 'novembre'],
  ['dec', 'déc', 'dez', 'december', 'décembre', 'decembre', 'dezember'],
];
const MONTH_BY_NAME = new Map(MONTHS.flatMap((names, i) => names.map(n => [n, MONTHS[i][0]])));

export function parseDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const direct = Date.parse(s);
  if (Number.isFinite(direct) && /\d{4}/.test(s)) return direct;

  const repaired = s
    .replace(/^[^\d,]+,\s*/, '')                                   // weekday, any language
    .replace(/([A-Za-zÀ-ÿ]+)\.?(?=\s+\d{4})/, m => MONTH_BY_NAME.get(m.replace('.', '').toLowerCase()) ?? m)
    .replace(/\b([A-Z]{1,4})$/, z => ZONES[z] ?? z);
  const retry = Date.parse(repaired);
  return Number.isFinite(retry) ? retry : null;
}

// Raw source of one entry for the explorer's "raw" view.
export function rawEntry(entry) {
  return serialize(entry.node, { pretty: true });
}
