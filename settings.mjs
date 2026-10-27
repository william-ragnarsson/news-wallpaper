// The dev server's settings, read only: .dev/settings.json in this worktree,
// the file wallpaper-dev keeps and changes (AGENTS.md). The rules are
// public/settings.js, which the app runs too. The wallpaper and the explorer
// read the settings from /api/settings and hear about changes on
// /api/settings/events.

import { mkdirSync, watch } from 'node:fs';
import { link, mkdir, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalize } from './public/settings.js';

const FOLDER = fileURLToPath(new URL('./.dev/', import.meta.url));
const FILE = `${FOLDER}settings.json`;
// Where the settings were before .dev/.
const OLD_FILE = fileURLToPath(new URL('./settings.json', import.meta.url));

const listeners = new Set();
let announced;  // the updatedAt listeners last heard
let watcher;

// Read each time: wallpaper-dev writes the same file.
export async function getSettings() {
  return normalize(await load());
}

export function subscribe(fn) {
  listeners.add(fn);
  watchFile();
  return () => listeners.delete(fn);
}

function announce(settings) {
  if (settings.updatedAt === announced) return;
  announced = settings.updatedAt;
  listeners.forEach(fn => fn(settings));
}

// Changes to the file (wallpaper-dev settings set) reach the listeners. The folder,
// not the file: a save replaces the file.
function watchFile() {
  if (watcher) return;
  mkdirSync(FOLDER, { recursive: true });
  let timer;
  watcher = watch(FOLDER, (_, name) => {
    if (name !== 'settings.json') return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      // A file that is half written or broken by hand: wait for a good one.
      const saved = await read().catch(err => err.code === 'ENOENT' ? {} : null);
      if (saved) announce(normalize(saved));
    }, 100);
  });
  watcher.unref();
}

// What the file holds; nothing when there is no file (the defaults).
async function load() {
  let saved = await held();
  if (saved === undefined) {
    await move();
    saved = await held();
  }
  return saved ?? {};
}

// undefined when there is no file.
async function held() {
  try {
    return await read();
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    console.error(`settings.json unreadable, using defaults: ${err.message}`);
    return {};
  }
}

async function read() {
  return JSON.parse(await readFile(FILE, 'utf8'));
}

// The settings from before .dev/ move in, once, so wallpaper-dev sees them
// too. A link, not a copy: it fails if the file was made meanwhile.
async function move() {
  try {
    await mkdir(FOLDER, { recursive: true });
    await link(OLD_FILE, FILE);
    await unlink(OLD_FILE);
    console.log('Moved settings.json into .dev/, where the settings are kept now.');
  } catch {
    // No old file, or another load moved it first.
  }
}
