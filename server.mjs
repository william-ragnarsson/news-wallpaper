// Local dev server: serves the wallpaper, the stream explorer and the
// Customize page from public/ and exposes the news integrations and the
// settings as JSON under /api. Zero dependencies; run with `npm run dev`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as catalog from './integrations/catalog.mjs';
import * as vrt from './integrations/vrt-nws.mjs';
import { getFrontpage, liveblogOptions, SECTIONS } from './integrations/frontpage.mjs';
import { HttpError } from './integrations/lib/http.mjs';
import { getSettings, MAX_LIVEBLOGS, subscribe, updateSettings } from './settings.mjs';
import { PRESETS } from './public/presets/index.js';

const PORT = Number(process.env.PORT) || 4174;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

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
  [/^\/api\/vrt-nws\/wallpaper$/, (_, q) => vrt.getWallpaper({
    follow: q.get('follow') || 'auto',
    maxPosts: clampInt(q.get('posts'), 1, 200, 40),
    maxHeadlines: clampInt(q.get('headlines'), 0, 50, 16),
  })],
  [/^\/api\/vrt-nws\/front$/, () => vrt.getFront()],
  [/^\/api\/vrt-nws\/frontpage$/, async () => getFrontpage(await getSettings())],
  [/^\/api\/vrt-nws\/liveblog\/(\d+)$/, ([, id]) => vrt.getLiveblog(id)],

  // Outlet catalog, for the explorer and anything built on normalized streams.
  [/^\/api\/outlets$/, () => catalog.listOutlets()],
  [/^\/api\/outlets\/([\w-]+)\/streams$/, ([, outlet]) => catalog.listStreams(outlet)],
  [/^\/api\/outlets\/([\w-]+)\/streams\/([\w-]+)$/, ([, outlet, stream], q) =>
    catalog.loadStream(outlet, stream, { raw: q.get('raw') === '1' })],
  [/^\/api\/outlets\/([\w-]+)\/health$/, ([, outlet]) => catalog.checkStreams(outlet)],
  [/^\/api\/health$/, () => catalog.checkStreams()],

  // What the wallpaper shows, set on the Customize page.
  [/^\/api\/settings$/, () => getSettings()],
  [/^\/api\/settings$/, (_, __, req) => {
    if (!fromThisMac(req)) throw new HttpError(403, 'The settings can only be changed on this Mac');
    return readJson(req).then(updateSettings);
  }, 'PATCH'],
  [/^\/api\/settings\/options$/, async () => ({
    presets: PRESETS,
    sections: SECTIONS,
    liveblogs: await liveblogOptions((await getSettings()).liveblogs),
    maxLiveblogs: MAX_LIVEBLOGS,
  })],
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
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel.endsWith('/') ? join(rel, 'index.html') : rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
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

function send(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
