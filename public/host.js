// The page's one connection to what serves it. Two hosts serve the same paths:
//   - the dev server (server.mjs, `npm run dev`): http://localhost:4174/
//   - the macOS app (app/Sources/WallpaperCore/Bridge.swift): wallpaper://app/
// and answer the same requests:
//   /sources/…          the news sources (sources/), as ES modules
//   /net?url=<url>      a GET to a news site, made by the host on the page's
//                       behalf: CORS keeps the page from fetching VRT itself
//   /api/settings       the Settings
// The dev server also pushes changes (/api/settings/events). The app has no
// push: it asks the page for a new picture (window.wallpaper.refresh) and the
// page reads the settings again then.

import * as sources from '/sources/index.mjs';

export const inApp = location.protocol === 'wallpaper:';

sources.setTransport(viaHost);
export { sources };

// The sources' transport (see setTransport in sources/lib/http.mjs). The host
// sends the user agent, which a page cannot set, from x-user-agent, and says
// with x-net-error that the site did not answer.
async function viaHost(url, { headers = {}, signal } = {}) {
  const { 'user-agent': userAgent, ...rest } = headers;
  const res = await fetch(`/net?url=${encodeURIComponent(url)}`, {
    headers: userAgent ? { ...rest, 'x-user-agent': userAgent } : rest,
    signal,
    cache: 'no-store',
  });
  const unreachable = res.headers.get('x-net-error');
  if (unreachable) throw new Error(unreachable);
  return {
    ok: res.ok,
    status: res.status,
    url: res.headers.get('x-final-url') ?? url,
    headers: res.headers,
    arrayBuffer: () => res.arrayBuffer(),
  };
}

// The Settings, or null when the host has none to give (the page then uses
// the defaults).
export async function loadSettings() {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Settings unavailable, using the defaults:', err);
    return null;
  }
}

// Calls onChange with the Settings on connecting and after every change;
// EventSource reconnects by itself after a server restart. Returns a function
// that stops listening. Does nothing in the app, which has no push.
export function watchSettings(onChange) {
  if (inApp) return () => {};
  const events = new EventSource('/api/settings/events');
  events.addEventListener('settings', e => onChange(JSON.parse(e.data)));
  return () => events.close();
}
