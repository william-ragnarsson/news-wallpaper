// Local dev server: serves the wallpaper page and the stream explorer from
// public/ and exposes the news integrations as JSON under /api. Zero
// dependencies; run with `npm run dev`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as catalog from './integrations/catalog.mjs';
import * as vrt from './integrations/vrt-nws.mjs';

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

const routes = [
  [/^\/api\/vrt-nws\/wallpaper$/, (_, q) => vrt.getWallpaper({
    follow: q.get('follow') || 'auto',
    maxPosts: clampInt(q.get('posts'), 1, 200, 40),
    maxHeadlines: clampInt(q.get('headlines'), 0, 50, 16),
  })],
  [/^\/api\/vrt-nws\/front$/, () => vrt.getFront()],
  [/^\/api\/vrt-nws\/liveblog\/(\d+)$/, ([, id]) => vrt.getLiveblog(id)],

  // Outlet catalog, for the explorer and anything built on normalized streams.
  [/^\/api\/outlets$/, () => catalog.listOutlets()],
  [/^\/api\/outlets\/([\w-]+)\/streams$/, ([, outlet]) => catalog.listStreams(outlet)],
  [/^\/api\/outlets\/([\w-]+)\/streams\/([\w-]+)$/, ([, outlet, stream], q) =>
    catalog.loadStream(outlet, stream, { raw: q.get('raw') === '1' })],
  [/^\/api\/outlets\/([\w-]+)\/health$/, ([, outlet]) => catalog.checkStreams(outlet)],
  [/^\/api\/health$/, () => catalog.checkStreams()],
];

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([re]) => re.test(url.pathname));
      if (!route) return send(res, 404, { error: 'Not found' });
      const data = await route[1](url.pathname.match(route[0]), url.searchParams);
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

function send(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
