#!/usr/bin/env node
// Loads every stream in the outlet catalog and prints what came back: item
// counts, freshness, field coverage and warnings. Exits non-zero when a stream
// fails, so it can gate changes to outlet modules.
//   npm run check                       all outlets
//   npm run check -- vrt-nws hln        some outlets
//   npm run check -- --strict           warnings fail too
//   npm run check -- --json             the raw report
//   npm run check -- --module <file>    try a module not yet in outlets/index.mjs
//   npm run check -- --fixtures <dir>   parse saved feed files offline instead

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkStreams, registerOutlet } from '../integrations/catalog.mjs';
import { normalizeEntry, parseFeed } from '../integrations/lib/feed.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const valuesOf = name => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const fixturesDir = valuesOf('fixtures')[0] ?? null;
const outletIds = args.filter((a, i) => !a.startsWith('--') && !['--fixtures', '--module'].includes(args[i - 1]));

// Modules under test are registered for this run only, and checked even when no ids are given.
for (const file of valuesOf('module')) {
  const outlet = (await import(pathToFileURL(resolve(file)).href)).default;
  registerOutlet(outlet);
  outletIds.push(outlet.id);
}

const tty = process.stdout.isTTY;
const paint = code => s => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = paint(31), yellow = paint(33), green = paint(32), dim = paint(2), bold = paint(1);

process.exitCode = fixturesDir ? await checkFixtures(fixturesDir) : await checkLive(outletIds);

// ---------------------------------------------------------------------------
// Live check

async function checkLive(ids) {
  const reports = ids.length ? await Promise.all(ids.map(id => checkStreams(id))) : [await checkStreams()];
  const streams = reports.flatMap(r => r.streams);
  if (flag('json')) {
    console.log(JSON.stringify(streams, null, 2));
  } else {
    for (const [outletId, rows] of groupBy(streams, s => s.outletId)) {
      console.log(`\n${bold(outletId)}`);
      printTable(rows.map(liveRow), ['', 'stream', 'group', 'items', 'newest', 'img', 'sum', 'auth', 'ms', 'notes']);
    }
  }

  const failed = streams.filter(s => !s.ok);
  const warned = streams.filter(s => s.ok && s.warnings.length);
  console.log(`\n${streams.length} streams: ${green(`${streams.length - failed.length - warned.length} ok`)}, `
    + `${yellow(`${warned.length} with warnings`)}, ${red(`${failed.length} failed`)}`);
  return failed.length || (flag('strict') && warned.length) ? 1 : 0;
}

function liveRow(s) {
  if (!s.ok) return [red('✗'), s.streamId, s.group, '', '', '', '', '', '', red(`${s.status} ${s.error}`)];
  const c = s.stats.coverage;
  return [
    s.warnings.length ? yellow('!') : green('✓'),
    s.streamId,
    s.group,
    s.stats.count,
    s.stats.newestAt ? ago(s.stats.newestAt) : dim('no dates'),
    pct(c.image),
    pct(c.summary),
    pct(c.author),
    s.upstream?.ms ?? '',
    s.warnings.join('; '),
  ];
}

// ---------------------------------------------------------------------------
// Offline check: run the generic reader over saved feeds (no outlet hooks)

async function checkFixtures(dir) {
  const files = (await readdir(dir)).filter(f => /\.(xml|rss|atom)$/i.test(f)).sort();
  let failures = 0;
  const rows = [];
  for (const file of files) {
    try {
      const feed = parseFeed(await readFile(join(dir, file), 'utf8'));
      const items = feed.entries.map(normalizeEntry);
      const share = pred => (items.length ? items.filter(pred).length / items.length : 0);
      const empty = !items.length;
      if (empty) failures++;
      rows.push([empty ? red('✗') : green('✓'), file, feed.format, items.length,
        pct(share(i => i.publishedAt)), pct(share(i => i.image)), pct(share(i => i.summary)), pct(share(i => i.authors.length)),
        empty ? red('no entries') : dim(items[0].title.slice(0, 60))]);
    } catch (err) {
      failures++;
      rows.push([red('✗'), file, '', '', '', '', '', '', red(err.message)]);
    }
  }
  printTable(rows, ['', 'file', 'format', 'items', 'date', 'img', 'sum', 'auth', 'first title']);
  console.log(`\n${files.length} files, ${failures ? red(`${failures} failed`) : green('all parsed')}`);
  return failures ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Formatting

function printTable(rows, head) {
  const plain = s => String(s).replace(/\x1b\[\d+m/g, '');
  const widths = head.map((h, i) => Math.max(plain(h).length, ...rows.map(r => plain(r[i]).length)));
  const line = cells => cells.map((c, i) => (i === cells.length - 1 ? c : String(c) + ' '.repeat(widths[i] - plain(c).length))).join('  ');
  console.log(dim(line(head)));
  for (const r of rows) console.log(line(r));
}

function groupBy(list, key) {
  const map = new Map();
  for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
  return map;
}

function pct(share) {
  return `${Math.round(share * 100)}%`;
}

function ago(t) {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}
