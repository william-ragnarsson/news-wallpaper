// The rules of the settings: what each one may be, what it is when missing,
// and what there is to pick from. One copy for everything that keeps them:
// the app and wallpaper-dev run this module in a web view (ScriptHost.swift,
// SettingsService.swift), and the dev server reads the settings by it
// (settings.mjs). Nothing here reads or writes a file: the callers keep
// settings.json.

import { DEFAULT_SECTIONS, HttpError, PROVIDERS, SECTIONS, liveblogOptions } from '../sources/index.mjs';
import { PRESETS } from './presets/index.js';

export const MAX_LIVEBLOGS = 3;
export const MAX_MARGIN = 320;

export const DEFAULTS = Object.freeze({
  // The design on the desktop.
  preset: PRESETS[0].id,
  // The news provider the front page comes from.
  provider: PROVIDERS[0].id,
  // Liveblog ids that lead the front page, in order: the first is the lead story.
  liveblogs: [],
  // Whether the other running liveblogs still show (newsprint's "Nu live" box).
  otherLiveblogs: true,
  // Section streams below the front page, in order.
  sections: DEFAULT_SECTIONS,
  // Points of blank paper kept at the right edge for the files and folders on
  // the desktop (designs that center the page keep as much on the left).
  margin: 104,
  updatedAt: null,
});

// Each field: is a value valid?
export const FIELDS = {
  preset: v => PRESETS.some(p => p.id === v),
  provider: v => PROVIDERS.some(p => p.id === v),
  liveblogs: v => Array.isArray(v) && v.length <= MAX_LIVEBLOGS
    && v.every(id => typeof id === 'string' && /^\d+$/.test(id)) && new Set(v).size === v.length,
  otherLiveblogs: v => typeof v === 'boolean',
  sections: v => Array.isArray(v) && v.every(id => SECTIONS.some(s => s.id === id)) && new Set(v).size === v.length,
  margin: v => Number.isInteger(v) && v >= 0 && v <= MAX_MARGIN,
};

// The settings from what settings.json holds (anything, or nothing): a field
// that is missing or no longer valid (a preset or section that was removed)
// takes its default.
export function normalize(saved) {
  const settings = { ...DEFAULTS, updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null };
  for (const [key, valid] of Object.entries(FIELDS)) {
    if (saved?.[key] !== undefined && valid(saved[key])) settings[key] = saved[key];
  }
  return settings;
}

// `patch` over `current`, stamped `now` (an ISO date). Throws for the whole
// patch if any field in it is unknown or invalid.
export function apply(current, patch, now) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Expected a JSON object');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(FIELDS, key)) throw new HttpError(400, `Unknown setting: ${key}`);
    if (!FIELDS[key](value)) throw new HttpError(400, `Invalid value for ${key}`);
  }
  return { ...normalize(current), ...patch, updatedAt: now };
}

// What there is to pick from. The liveblogs are the running ones, plus those
// in `settings` that ended, so a picked one stays listed. They come from the
// sources' reader: the stored news in the app (host.js useStoredNews), the
// network by default.
export async function options(settings) {
  return {
    presets: PRESETS,
    providers: PROVIDERS,
    sections: SECTIONS,
    liveblogs: await liveblogOptions(normalize(settings).liveblogs),
    maxLiveblogs: MAX_LIVEBLOGS,
    maxMargin: MAX_MARGIN,
  };
}
