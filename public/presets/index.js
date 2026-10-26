// Registry of wallpaper presets. Each id maps to presets/<id>/preset.js + preset.css;
// `data` picks the payload (presets/README.md), default 'wallpaper'.
export const PRESETS = [
  { id: 'newsprint', data: 'front', name: 'Newsprint', description: 'Classic broadsheet front page on warm newsprint.' },
  { id: 'evening', data: 'front', name: 'Evening Edition', description: 'The classic front page in dark ink: calm for a desktop.' },
  { id: 'homepage', data: 'front', name: 'Homepage', description: 'A news site front: lead package, sections, latest.' },
  { id: 'headlines', data: 'front', name: 'Headlines', description: 'Type only: the front page as ranked headlines.' },
  { id: 'broadsheet', name: 'Broadsheet', description: 'Classic newspaper front page on warm newsprint.' },
  { id: 'cover', name: 'Cover', description: 'Full-bleed photo with an editorial overlay.' },
  { id: 'wire', name: 'Wire', description: 'Dark newsroom wire feed, timestamp first.' },
  { id: 'frontpage', name: 'Front Page', description: 'Every live story side by side on a Swiss grid.' },
  { id: 'ambient', name: 'Ambient', description: 'Calm and minimal: only the latest update.' },
];
