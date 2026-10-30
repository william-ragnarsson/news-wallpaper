// Where the wallpaper payloads (getFrontpage, getWallpaper)
// read the news from: live from the sites, the default, or from news the app
// fetched earlier (public/harvest.js) and stored. A reader is the functions
// the payloads are built from:
//   loadStream(outletId, streamId)  as catalog.loadStream
//   getFront()                      as liveblog.getFront
//   getLiveblog(id, feedEntry)      as liveblog.getLiveblog
//   now()                           when the news was loaded, in ms: the
//                                   payloads' generatedAt (optional, default
//                                   Date.now())
// The sources' own loading (catalog, outlets) and harvest.js always go live.

import * as liveblog from '../liveblog.mjs';

// Called through, not copied: liveblog.mjs imports this module, so its
// exports may not exist yet while this one loads. The catalog is imported
// when first used: a static import would close a cycle through the outlets
// (outlets/vrt-nws.mjs imports liveblog.mjs), and loading an outlet module
// first would then fail.
const live = {
  loadStream: async (outletId, streamId) => (await import('../catalog.mjs')).loadStream(outletId, streamId),
  getFront: () => liveblog.getFront(),
  getLiveblog: (id, feedEntry) => liveblog.getLiveblog(id, feedEntry),
};

let reader = live;

// null goes back to live.
export function setReader(next) {
  reader = next ?? live;
}

export const loadStream = (outletId, streamId) => reader.loadStream(outletId, streamId);
export const getFront = () => reader.getFront();
export const getLiveblog = (id, feedEntry) => reader.getLiveblog(id, feedEntry);
export const now = () => reader.now?.() ?? Date.now();
