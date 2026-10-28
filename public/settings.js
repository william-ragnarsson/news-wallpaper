// The rules of the settings: what each one may be, what it is when missing,
// and what there is to pick from. One copy for everything that keeps them:
// the app and wallpaper-dev run this module in a web view (ScriptHost.swift,
// SettingsService.swift), and the dev server reads the settings by it
// (settings.mjs). Nothing here reads or writes a file: the callers keep
// settings.json.

import { HttpError, PROVIDERS, getProvider } from '../sources/index.mjs';
import { PRESETS } from './presets/index.js';

export const MAX_MARGIN = 320;

export const DEFAULTS = Object.freeze({
  // The design on the desktop.
  preset: PRESETS[0].id,
  // The news provider the front page comes from, the one the app fetches.
  provider: PROVIDERS[0].id,
  // Whether running live stories (liveblogs, live pages) lead the front page.
  liveFirst: true,
  // Section streams below the front page, in order; the provider's own pick
  // when it changes.
  sections: PROVIDERS[0].defaultSections,
  // Points of blank paper kept at the right edge for the files and folders on
  // the desktop (designs that center the page keep as much on the left).
  margin: 104,
  updatedAt: null,
});

// Each field: is a value valid in settings `s`? Some depend on the provider,
// which comes first: its sections, and its liveblogs (VRT NWS's only) for
// the designs that show one.
export const FIELDS = {
  provider: v => PROVIDERS.some(p => p.id === v),
  preset: (v, s) => PRESETS.some(p => p.id === v && (p.data === 'front' || getProvider(s.provider).liveblogs)),
  liveFirst: v => typeof v === 'boolean',
  sections: (v, s) => Array.isArray(v) && v.every(id => getProvider(s.provider).sections.some(x => x.id === id))
    && new Set(v).size === v.length,
  margin: v => Number.isInteger(v) && v >= 0 && v <= MAX_MARGIN,
};

// The settings from what settings.json holds (anything, or nothing): a field
// that is missing or no longer valid (a preset or section that was removed)
// takes its default, and one no longer kept (liveblogs, otherLiveblogs) is dropped.
export function normalize(saved) {
  const settings = { ...DEFAULTS, updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null };
  for (const [key, valid] of Object.entries(FIELDS)) {
    if (saved?.[key] !== undefined && valid(saved[key], settings)) settings[key] = saved[key];
    else if (key === 'provider') Object.assign(settings, providerDefaults(settings.provider));
  }
  return settings;
}

// `patch` over `current`, stamped `now` (an ISO date). Throws for the whole
// patch if any field in it is unknown or invalid. Another provider brings its
// own sections, and a front-page design if the one in use
// shows a liveblog it has not got, unless the patch says otherwise.
export function apply(current, patch, now) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Expected a JSON object');
  const before = normalize(current);
  const next = { ...before };
  if (patch.provider !== undefined && patch.provider !== before.provider && FIELDS.provider(patch.provider)) {
    Object.assign(next, providerDefaults(patch.provider));
    if (!FIELDS.preset(next.preset, next)) next.preset = DEFAULTS.preset;
  }
  Object.assign(next, patch);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(FIELDS, key)) throw new HttpError(400, `Unknown setting: ${key}`);
    if (!FIELDS[key](value, next)) throw new HttpError(400, `Invalid value for ${key}`);
  }
  return { ...next, updatedAt: now };
}

function providerDefaults(provider) {
  return { provider, sections: getProvider(provider).defaultSections };
}

// What there is to pick from. Async, as the callers await it: picks that
// depend on the news (the liveblogs once) would come from the stored news.
export async function options() {
  return {
    presets: PRESETS,
    providers: PROVIDERS,
    maxMargin: MAX_MARGIN,
  };
}
