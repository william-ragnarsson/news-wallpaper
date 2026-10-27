// Fetching and caching shared by every source. Plain JavaScript with no Node or
// DOM APIs, so it runs the same in Node and in the wallpaper page. The network
// itself is the host's: see setTransport().

export const USER_AGENT = 'news-wallpaper/0.1 (personal prototype)';
// For outlets whose CDN turns away anything that does not look like a browser.
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// How a request reaches the network. Defaults to the global fetch; a host
// that cannot fetch other sites directly (the wallpaper page, which CORS
// stops) passes its own. A transport takes fetch()'s (url, { headers, signal })
// and resolves to { ok, status, url, headers, arrayBuffer() }, where url is
// the final URL after redirects. It rejects when the site could not be reached.
let transport = (url, init) => fetch(url, { ...init, redirect: 'follow' });

export function setTransport(fn) {
  transport = fn;
}

export async function fetchText(url, options) {
  return (await fetchResource(url, options)).text;
}

// GET a text resource and decode it with the right charset. fetch() always
// decodes as UTF-8, which garbles the ISO-8859-1 feeds some outlets still serve.
export async function fetchResource(url, { accept = '*/*', userAgent = USER_AGENT, headers = {}, timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  let res;
  try {
    res = await transport(url, {
      headers: { accept, 'user-agent': userAgent, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : err.cause?.code ?? err.message;
    throw new HttpError(504, `Upstream unreachable (${reason}) for ${url}`);
  }
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `Upstream ${res.status} for ${url}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  return {
    text: decode(bytes, contentType),
    status: res.status,
    contentType,
    bytes: bytes.length,
    ms: Date.now() - started,
    finalUrl: res.url,
  };
}

function decode(bytes, contentType) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  const declared = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
    ?? head.match(/^\s*<\?xml[^>]*encoding=["']([\w-]+)["']/)?.[1]
    ?? 'utf-8';
  let text;
  try {
    text = new TextDecoder(declared).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // A body labelled UTF-8 that is full of replacement characters is really Windows-1252.
  const broken = text.match(/�/g)?.length ?? 0;
  if (broken > 3 && /^utf-?8$/i.test(declared)) text = new TextDecoder('windows-1252').decode(bytes);
  return text;
}

const cache = new Map();

// TTL cache that dedupes concurrent loads and serves the last good value if a
// refresh fails, so an upstream hiccup never blanks the wallpaper.
export function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit?.value && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  if (hit?.pending) return hit.pending;

  const pending = load()
    .then(value => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .catch(err => {
      if (hit?.value) {
        cache.set(key, { value: hit.value, at: hit.at });
        return hit.value;
      }
      cache.delete(key);
      throw err;
    });
  cache.set(key, { ...hit, pending });
  return pending;
}
