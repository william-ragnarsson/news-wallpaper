// Local dev server, zero dependencies; run with `npm run dev`. It is one of the
// two hosts of the wallpaper page (the macOS app is the other, see
// public/host.js) and serves what both serve:
//   /                   public/: the wallpaper, the explorer, Customize
//   /sources/           sources/, which the page runs itself
//   /net?url=<url>      the page's way to VRT (see proxy() below)
//   /api/news           the stored news: .dev/news.json, which wallpaper-dev
//                       fetch writes (the page reads it with ?data=store)
//   /api/settings       the settings (settings.mjs: .dev/settings.json)
// and, for the explorer, Customize and tools, the sources as JSON under /api.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sources from './sources/index.mjs';
import { HttpError, USER_AGENT } from './sources/index.mjs';
import { getSettings, options, subscribe, updateSettings } from './settings.mjs';

const PORT = Number(process.env.PORT) || 4174;
// URL prefix → directory, the first match wins.
const STATIC = [
  ['/sources/', fileURLToPath(new URL('./sources/', import.meta.url))],
  ['/', fileURLToPath(new URL('./public/', import.meta.url))],
];
// What /net may reach: https on VRT's domains, which is all the sources read.
// Bridge.swift allows the same in the app.
const NET_HOSTS = /(^|\.)vrt\.be$/;
const NET_TIMEOUT_MS = 15_000;
// The news wallpaper-dev fetched last in this worktree (app/Sources/NewsStore).
const NEWS_FILE = fileURLToPath(new URL('./.dev/news.json', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

// [path, handler, method]; the method defaults to GET.
const routes = [
  [/^\/api\/vrt-nws\/wallpaper$/, (_, q) => sources.getWallpaper({
    follow: q.get('follow') || 'auto',
    maxPosts: clampInt(q.get('posts'), 1, 200, 40),
    maxHeadlines: clampInt(q.get('headlines'), 0, 50, 16),
  })],
  [/^\/api\/vrt-nws\/front$/, () => sources.getFront()],
  [/^\/api\/vrt-nws\/frontpage$/, async () => sources.getFrontpage(await getSettings())],
  [/^\/api\/vrt-nws\/liveblog\/(\d+)$/, ([, id]) => sources.getLiveblog(id)],

  // Outlet catalog, for the explorer and anything built on normalized streams.
  [/^\/api\/outlets$/, () => sources.listOutlets()],
  [/^\/api\/outlets\/([\w-]+)\/streams$/, ([, outlet]) => sources.listStreams(outlet)],
  [/^\/api\/outlets\/([\w-]+)\/streams\/([\w-]+)$/, ([, outlet, stream], q) =>
    sources.loadStream(outlet, stream, { raw: q.get('raw') === '1' })],
  [/^\/api\/outlets\/([\w-]+)\/health$/, ([, outlet]) => sources.checkStreams(outlet)],
  [/^\/api\/health$/, () => sources.checkStreams()],

  [/^\/api\/news$/, () => storedNews()],

  // What the wallpaper shows, set on the Customize page.
  [/^\/api\/settings$/, () => getSettings()],
  [/^\/api\/settings$/, (_, __, req) => {
    if (!fromThisMac(req)) throw new HttpError(403, 'The settings can only be changed on this Mac');
    return readJson(req).then(updateSettings);
  }, 'PATCH'],
  [/^\/api\/settings\/options$/, async () => options(await getSettings())],
];

createServer(async (req, res) => {
  // A fixed base: a malformed Host header or request target is a 400, not a crash.
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }
  try {
    if (url.pathname === '/net') {
      return req.method === 'GET' ? await proxy(url.searchParams, req, res) : send(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/settings/events') {
      return req.method === 'GET' ? streamSettings(req, res) : send(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname.startsWith('/api/')) {
      const matches = routes.filter(([re]) => re.test(url.pathname));
      const route = matches.find(([, , method = 'GET']) => method === req.method);
      if (!route) return send(res, matches.length ? 405 : 404, { error: matches.length ? 'Method not allowed' : 'Not found' });
      const data = await route[1](url.pathname.match(route[0]), url.searchParams, req);
      return send(res, 200, data);
    }
    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error(`${req.method} ${url.pathname}:`, err.message);
    send(res, err.status ?? 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`News wallpaper running at http://localhost:${PORT}`);
});

async function serveStatic(pathname, res) {
  const [prefix, dir] = STATIC.find(([prefix]) => pathname.startsWith(prefix));
  const rel = normalize(decodeURIComponent(pathname.slice(prefix.length))).replace(/^(\.\.[/\\])+/, '');
  const file = join(dir, rel === '.' || rel.endsWith('/') ? join(rel, 'index.html') : rel);
  if (!file.startsWith(dir)) return send(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch (err) {
    // A directory without its trailing slash: /explorer → /explorer/
    if (err.code === 'EISDIR') {
      res.writeHead(301, { location: `${pathname}/` });
      return res.end();
    }
    send(res, 404, { error: 'Not found' });
  }
}

// GET /net?url=<url>: a request to a news site on the page's behalf, which
// CORS keeps from fetching VRT itself (public/host.js is the other end). Sends
// back the site's status, type and body, the URL it ended at in x-final-url,
// and, when the site did not answer, a 504 with the reason in x-net-error.
// The user agent comes from x-user-agent, which a page can set.
async function proxy(query, req, res) {
  let target = netUrl(query.get('url'));
  const headers = { accept: req.headers.accept ?? '*/*', 'user-agent': req.headers['x-user-agent'] ?? USER_AGENT };
  let upstream;
  try {
    // Redirects by hand, so each hop is checked against NET_HOSTS too.
    for (let hops = 0; ; hops++) {
      upstream = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
      const location = upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location');
      if (!location) break;
      if (hops === 5) throw new HttpError(502, 'Too many redirects');
      target = netUrl(new URL(location, target).href);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const reason = err.name === 'TimeoutError' ? `timed out after ${NET_TIMEOUT_MS / 1000}s` : err.cause?.code ?? err.message;
    res.writeHead(504, { 'x-net-error': String(reason).replace(/[^\x20-\x7e]/g, ''), 'cache-control': 'no-store' });
    return res.end();
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'x-final-url': target,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function netUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Expected ?url=<an https URL>');
  }
  if (url.protocol !== 'https:' || !NET_HOSTS.test(url.hostname)) throw new HttpError(403, `Not a news source: ${url.host}`);
  return url.href;
}

// Server-sent events: the settings now, then again on every change, so open
// wallpapers (Plash too) follow the Customize page without a reload.
function streamSettings(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const push = settings => res.write(`event: settings\ndata: ${JSON.stringify(settings)}\n\n`);
  res.write('retry: 2000\n\n');
  getSettings().then(push);
  const unsubscribe = subscribe(push);
  // A comment now and then, so nothing between closes the stream as idle.
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

// A small JSON body. Only application/json, which a page on another site can
// not send here without the browser asking first (CORS preflight).
async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Expected application/json');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new HttpError(413, 'Body too large');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

// The server listens on every interface, so other machines can read the
// wallpaper; only this Mac may change it. The Host check also stops a site
// that points its own domain at 127.0.0.1 (DNS rebinding): it sends that domain.
function fromThisMac(req) {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  return loopback && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');
}

async function storedNews() {
  try {
    return JSON.parse(await readFile(NEWS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new HttpError(503, `No news stored in ${NEWS_FILE} yet: fetch first (wallpaper-dev fetch)`);
    throw err;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
