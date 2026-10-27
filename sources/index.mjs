// The news sources: the one module everything outside sources/ imports.
//
// Plain JavaScript with no Node or DOM APIs. It runs in two places:
//   - in the wallpaper page (public/app.js), which is how the app and the dev
//     preview both show the news
//   - in the dev server (server.mjs) for the explorer, the Customize page and
//     tools/check-feeds.mjs
// The only thing a host supplies is the network (setTransport); the default
// is the global fetch, which is what Node uses.

// Payloads for the wallpaper designs.
export { getFrontpage, liveblogOptions, SECTIONS, DEFAULT_SECTIONS } from './frontpage.mjs';
export { getWallpaper, getFront, getLiveblog } from './liveblog.mjs';

// The outlet catalog: outlets, their streams and one loader for any stream.
export { GROUPS, listOutlets, listStreams, loadStream, checkStreams, registerOutlet } from './catalog.mjs';

// Feed parsing, for tools that read saved feeds offline.
export { parseFeed, normalizeEntry } from './lib/feed.mjs';

// The network: errors, the user agent the sources identify with, and the hook
// a host uses to route requests.
export { HttpError, USER_AGENT, setTransport } from './lib/http.mjs';
