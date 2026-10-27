// The fetch (M2) in the page: everything there is to pick from, loaded live
// once, as the one document the app stores (app/Sources/NewsStore):
//   {fetchedAt, ok, errors: [{id, message}], streams: {id: stream}, front, liveblogs: {id: liveblog}}
// streams    what catalog.loadStream gives: voorpagina, all, live, every
//            section and a liveblog-<id> per liveblog below
// front      what getFront gives: VRT's feed
// liveblogs  what getLiveblog gives, for the liveblogs in the feed and the
//            ones picked in the settings
// So any change in Customize can be drawn from it without fetching again
// (sources/lib/reader.mjs reads it back). The app's Fetcher runs this in its
// script host, after host.js has set the network.

import { PROVIDERS, SECTIONS, getFront, getLiveblog, loadStream } from '../sources/index.mjs';

// VRT NWS, the one provider so far.
const OUTLET = PROVIDERS[0].id;

// `liveblogs`: the ids picked in the settings. `previous`: the document stored
// last; what fails now is kept from it, and listed in errors. Throws, and so
// stores nothing, when VRT's feed or its front page fails.
export async function harvest({ liveblogs = [], previous = null } = {}) {
  const fetchedAt = new Date().toISOString();
  const errors = [];
  // The feed first: it says which liveblogs are running.
  const front = await getFront();
  const entries = new Map(front.liveblogs.map(e => [e.liveblogId, e]));
  const ids = [...new Set([...entries.keys(), ...liveblogs])];
  const streamIds = ['voorpagina', 'all', 'live', ...SECTIONS.map(s => s.id), ...ids.map(id => `liveblog-${id}`)];

  const [streams, blogs] = await Promise.all([
    settle('streams', streamIds, id => loadStream(OUTLET, id), previous?.streams, errors),
    settle('liveblogs', ids, id => getLiveblog(id, entries.get(id)), previous?.liveblogs, errors),
  ]);
  const failed = errors.find(e => e.id === 'streams.voorpagina');
  if (failed) throw new Error(`The front page failed: ${failed.message}`);
  return { fetchedAt, ok: errors.length === 0, errors, streams, front, liveblogs: blogs };
}

// {id: what load(id) gave}, or for one that failed what `kept` had, if anything.
async function settle(kind, ids, load, kept, errors) {
  const settled = await Promise.allSettled(ids.map(id => load(id)));
  const out = {};
  settled.forEach((r, i) => {
    const id = ids[i];
    if (r.status === 'fulfilled') {
      out[id] = r.value;
      return;
    }
    errors.push({ id: `${kind}.${id}`, message: r.reason?.message ?? String(r.reason) });
    if (kept?.[id]) out[id] = kept[id];
  });
  return out;
}
