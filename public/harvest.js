// The fetch (M2) in the page: everything there is to pick from at one
// provider, loaded live once, as the one document the app stores
// (app/Sources/NewsStore):
//   {fetchedAt, provider, ok, errors: [{id, message}], streams: {id: stream}, front, liveblogs: {id: liveblog}}
// provider   the provider fetched (the settings'); only its news is in here
// streams    what catalog.loadStream gives: its front page (VRT: voorpagina,
//            all, live), every section and a liveblog-<id> per liveblog below
// front      what getFront gives: VRT's feed; null for another provider
// liveblogs  what getLiveblog gives, for the liveblogs in the feed; none
//            for another provider
// So any change in Customize but the provider can be drawn from it without
// fetching again (sources/lib/reader.mjs reads it back). The app's Fetcher
// runs this in its script host, after host.js has set the network.

import { frontOf, getFront, getLiveblog, getProvider, loadStream } from '../sources/index.mjs';

// The provider of a stored document; one stored before there were others
// says none, and is VRT NWS's.
export const providerOf = doc => doc?.provider ?? 'vrt-nws';

// `provider`: the settings'. `previous`: the document stored
// last; what fails now is kept from it (when it is the same provider's), and
// listed in errors. Throws, and so stores nothing, when VRT's feed fails, or
// the provider's front page with none from before.
export async function harvest({ provider, previous = null } = {}) {
  const p = getProvider(provider);
  const { top, latest, live } = frontOf(p.id);
  const kept = providerOf(previous) === p.id ? previous : null;
  const fetchedAt = new Date().toISOString();
  const errors = [];
  // VRT's feed first: it says which liveblogs are running.
  const front = p.liveblogs ? await getFront() : null;
  const entries = new Map((front?.liveblogs ?? []).map(e => [e.liveblogId, e]));
  const ids = [...entries.keys()];
  const streamIds = [top, latest, live, ...p.sections.map(s => s.id)].filter(Boolean)
    .concat(ids.map(id => `liveblog-${id}`));

  const [streams, blogs] = await Promise.all([
    settle('streams', streamIds, id => loadStream(p.id, id), kept?.streams, errors),
    settle('liveblogs', ids, id => getLiveblog(id, entries.get(id)), kept?.liveblogs, errors),
  ]);
  const failed = errors.find(e => e.id === `streams.${top}`);
  if (failed && !streams[top]) throw new Error(`The front page failed: ${failed.message}`);
  return { fetchedAt, provider: p.id, ok: errors.length === 0, errors, streams, front, liveblogs: blogs };
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
