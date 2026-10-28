// The page's one connection to what serves it. Two hosts serve the same paths:
//   - the dev server (server.mjs, `npm run dev`): http://localhost:4174/
//   - the macOS app (app/Sources/WallpaperCore/Bridge.swift): wallpaper://app/
// and answer the same requests:
//   /sources/…          the news sources (sources/), as ES modules
//   /net?url=<url>      a GET to a news site, made by the host on the page's
//                       behalf: CORS keeps the page from fetching VRT itself
//   /api/news           the news the host stored last (the app's NewsStore
//                       document; the dev server's .dev/news.json)
//   /api/settings       the Settings
// The page reads the news live, over /net, or with ?data=store from /api/news
// (loadStoredNews), as the app draws the desktop picture: it has no /net there.
// The dev server also pushes changes (/api/settings/events). The app has no
// push: it asks the page for a new picture (window.wallpaper.refresh) and the
// page reads the settings again then.

import * as sources from '/sources/index.mjs';
import { providerOf } from './harvest.js';

export const inApp = location.protocol === 'wallpaper:';
// Whether the page draws the stored news (see loadStoredNews), not the sites'.
export const fromStore = new URLSearchParams(location.search).get('data') === 'store';

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

// Reads the stored news again and points the sources at it (their reader, see
// sources/lib/reader.mjs), so the payloads are built from it. Returns when it
// was fetched, an ISO date. Throws the host's reason when there is none, such
// as nothing fetched yet.
export async function loadStoredNews() {
  const res = await fetch('/api/news', { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.streams) throw new Error(body?.error ?? `No stored news (HTTP ${res.status})`);
  useStoredNews(body);
  return body.fetchedAt;
}

// Points the sources at `doc`, a stored document, as loadStoredNews does with
// the host's. The app's settings (SettingsService.swift) list the liveblogs
// from it.
export function useStoredNews(doc) {
  sources.setReader(storedReader(doc));
  storedProvider = providerOf(doc);
}

// Whose news is stored, once loadStoredNews has read it: the provider fetched
// last, which a switch to another one has not replaced while its fetch is on
// its way or failed.
export let storedProvider = null;

// The reader for a stored document ({fetchedAt, provider, streams, front,
// liveblogs}, public/harvest.js has it). What it does not have fails, as a
// site that is down would: another provider's streams too.
function storedReader(doc) {
  const fetchedAt = Date.parse(doc.fetchedAt);
  const find = (what, table, id) => {
    if (!table?.[id]) throw new Error(`Not in the stored news: ${what} ${id}`);
    return table[id];
  };
  return {
    loadStream: async (outletId, streamId) => {
      if (outletId !== providerOf(doc)) throw new Error(`Not in the stored news: ${outletId}, it has ${providerOf(doc)}'s`);
      return find('stream', doc.streams, streamId);
    },
    getFront: async () => find('feed', doc, 'front'),
    getLiveblog: async id => find('liveblog', doc.liveblogs, String(id)),
    now: () => fetchedAt,
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
