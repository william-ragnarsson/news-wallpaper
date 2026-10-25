// Minimal, forgiving XML parser for news feeds. Builds a tree of
// { name, attrs, children } elements with decoded text strings as leaves.
// Handles CDATA, comments, processing instructions, DOCTYPE and self-closing
// tags. Real-world feeds contain stray '<' and mismatched closing tags, so
// those are tolerated instead of rejected.

import { decodeEntities } from './html.mjs';

const TOKEN = new RegExp([
  /<!\[CDATA\[([\s\S]*?)\]\]>/.source,                                      // 1: CDATA
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>/.source, // skipped
  /<\/\s*([^\s>]+)\s*>/.source,                                             // 2: closing tag
  /<([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/.source, // 3-5: opening tag
  /([^<]+)/.source,                                                         // 6: text
  /</.source,                                                               // stray '<'
].join('|'), 'g');

const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      const i = stack.findLastIndex(n => n.name === m[2]);
      if (i > 0) stack.length = i;
    } else if (m[3] !== undefined) {
      const el = { name: m[3], attrs: parseAttrs(m[4]), children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
    else if (m[0] === '<') top.children.push('<');
  }
  return root;
}

function parseAttrs(source) {
  const attrs = {};
  for (const [, name, ...values] of source.matchAll(ATTR)) {
    attrs[name] = decodeEntities(values.find(v => v !== undefined) ?? '');
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Tree helpers. Names are matched exactly, prefix included ('media:content').

export function elements(node) {
  return node?.children.filter(c => typeof c === 'object') ?? [];
}

// First child element with any of the given names, tried in order.
export function child(node, ...names) {
  for (const name of names) {
    const found = node?.children.find(c => c.name === name);
    if (found) return found;
  }
  return null;
}

export function childrenNamed(node, ...names) {
  return node?.children.filter(c => names.includes(c.name)) ?? [];
}

// All descendant elements with the given name, depth first.
export function descendants(node, name, out = []) {
  for (const c of elements(node)) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

// Concatenated text content of a node and everything below it.
export function textOf(node) {
  if (!node) return '';
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

// Text of the first matching child, trimmed. '' if absent.
export function childText(node, ...names) {
  return textOf(child(node, ...names)).trim();
}

const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = s => escapeText(s).replace(/"/g, '&quot;');

// Back to markup: for Atom type="xhtml" content and for showing raw items.
export function serialize(node, { inner = false, pretty = false, depth = 0 } = {}) {
  if (typeof node === 'string') return escapeText(node);
  const kids = node.children;
  const pad = pretty ? '\n' + '  '.repeat(depth + 1) : '';
  const simple = kids.every(c => typeof c === 'string');
  const body = kids
    .filter(c => !pretty || typeof c !== 'string' || c.trim() || simple)
    .map(c => (pretty && !simple ? pad : '') + serialize(c, { pretty, depth: depth + 1 }))
    .join('') + (pretty && !simple && kids.length ? '\n' + '  '.repeat(depth) : '');
  if (inner) return body;
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
  return kids.length ? `<${node.name}${attrs}>${body}</${node.name}>` : `<${node.name}${attrs}/>`;
}
