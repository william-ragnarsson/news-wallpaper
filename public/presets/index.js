// Registry of wallpaper presets. Each id maps to presets/<id>/preset.js + preset.css;
// `data` picks the payload (presets/README.md), default 'wallpaper'. A front-page
// design that shows the sections or the running liveblogs says so (`sections`,
// `live`), one that keeps the margin for the desktop files (`margin`), and one
// that follows the pictures, color and density settings (`pictures`, `color`,
// `density`), for Customize. A template on the kit (presets/kit.js) follows
// them all.
const TEMPLATE = { margin: true, pictures: true, color: true, density: true };

export const PRESETS = [
  { id: 'newsprint', data: 'front', sections: true, ...TEMPLATE, name: 'Newsprint', description: 'A broadsheet front page on warm newsprint: one big story in text columns, the latest news down the side, the sections below.' },
  { id: 'evening', data: 'front', live: true, ...TEMPLATE, name: 'Evening Edition', description: 'The classic front page in dark ink: calm for a desktop.' },
  { id: 'homepage', data: 'front', sections: true, ...TEMPLATE, name: 'Homepage', description: 'A news site front: lead package, sections, latest.' },
  { id: 'headlines', data: 'front', live: true, ...TEMPLATE, name: 'Headlines', description: 'The front page as ranked headlines, type first.' },
  { id: 'broadsheet', margin: true, name: 'Broadsheet', description: 'Classic newspaper front page on warm newsprint.' },
  { id: 'cover', name: 'Cover', description: 'Full-bleed photo with an editorial overlay.' },
  { id: 'wire', name: 'Wire', description: 'Dark newsroom wire feed, timestamp first.' },
  { id: 'frontpage', name: 'Front Page', description: 'Every live story side by side on a Swiss grid.' },
  { id: 'ambient', name: 'Ambient', description: 'Calm and minimal: only the latest update.' },
];
