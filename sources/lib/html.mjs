// HTML and entity helpers shared by all sources. Feeds ship titles and
// summaries as entity-encoded HTML fragments of very mixed quality, so
// everything that leaves an integration as plain text goes through here.

// Paragraphs of plain text from an HTML fragment. List items become '• …'.
export function htmlToParagraphs(html) {
  if (!html) return [];
  return html
    .replace(/<(script|style|iframe|figure|figcaption)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|h\d|blockquote|div)>/gi, '\n')
    .split(/\n+/)
    .map(htmlToText)
    .filter(s => s && s !== '•');
}

export function htmlToText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ''))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALLOWED_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'br']);

// Keeps only basic text formatting; attributes are always dropped.
export function sanitizeHtml(html) {
  return html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, (tag, name) => {
      name = name.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      return tag.startsWith('</') ? `</${name}>` : `<${name}>`;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/<p>\s*<\/p>/g, '')
    .trim();
}

// First <img src> in an HTML fragment, skipping 1×1 tracking pixels.
export function firstImageInHtml(html) {
  for (const [tag] of String(html ?? '').matchAll(/<img\b[^>]*>/gi)) {
    const attr = name => decodeEntities(tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find(v => v != null) ?? '');
    const src = attr('src') || attr('data-src');
    if (!/^https?:\/\//.test(src)) continue;
    if (attr('width') === '1' || attr('height') === '1') continue;
    return { url: src, alt: attr('alt') };
  }
  return null;
}

// Latin-1 entities in code point order from U+00A0, plus the punctuation that
// French and Dutch feeds actually use. `nbsp` decodes to a plain space.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring '
  + 'AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times '
  + 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave '
  + 'eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute '
  + 'ucirc uuml yacute thorn yuml').split(' ');

const NAMED_ENTITIES = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', circ: 'ˆ', tilde: '˜',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″',
  lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}
