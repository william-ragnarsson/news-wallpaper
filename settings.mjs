// What the wallpaper shows, picked on the Customize page (/customize/) and
// kept in settings.json next to this file. The wallpaper and the explorer read
// it from /api/settings and hear about changes on /api/settings/events.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SECTIONS, HttpError, PROVIDERS, SECTIONS } from './sources/index.mjs';
import { PRESETS } from './public/presets/index.js';

const FILE = fileURLToPath(new URL('./settings.json', import.meta.url));
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
const FIELDS = {
  preset: v => PRESETS.some(p => p.id === v),
  provider: v => PROVIDERS.some(p => p.id === v),
  liveblogs: v => Array.isArray(v) && v.length <= MAX_LIVEBLOGS
    && v.every(id => typeof id === 'string' && /^\d+$/.test(id)) && new Set(v).size === v.length,
  otherLiveblogs: v => typeof v === 'boolean',
  sections: v => Array.isArray(v) && v.every(id => SECTIONS.some(s => s.id === id)) && new Set(v).size === v.length,
  margin: v => Number.isInteger(v) && v >= 0 && v <= MAX_MARGIN,
};

let current = null;
let saving = Promise.resolve();
const listeners = new Set();

export async function getSettings() {
  current ??= load();
  return current;
}

// Applies a partial update and saves it. Rejects the whole update if any field
// is unknown or invalid. Updates run one at a time, each on top of the last.
export function updateSettings(patch) {
  const run = saving.then(() => apply(patch));
  saving = run.catch(() => {});
  return run;
}

async function apply(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Expected a JSON object');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(FIELDS, key)) throw new HttpError(400, `Unknown setting: ${key}`);
    if (!FIELDS[key](value)) throw new HttpError(400, `Invalid value for ${key}`);
  }
  const next = { ...(await getSettings()), ...patch, updatedAt: new Date().toISOString() };
  // Write to a temp file and rename it over the old one, so a crash never leaves half a file.
  await writeFile(`${FILE}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  await rename(`${FILE}.tmp`, FILE);
  current = Promise.resolve(next);
  listeners.forEach(fn => fn(next));
  return next;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A missing file means the defaults; a field that is no longer valid (a preset
// or section that was removed) falls back to its default on its own.
async function load() {
  let saved = {};
  try {
    saved = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`settings.json unreadable, using defaults: ${err.message}`);
  }
  const settings = { ...DEFAULTS, updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null };
  for (const [key, valid] of Object.entries(FIELDS)) {
    if (saved?.[key] !== undefined && valid(saved[key])) settings[key] = saved[key];
  }
  return settings;
}
