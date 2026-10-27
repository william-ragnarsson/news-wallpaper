# news-wallpaper

Live VRT NWS news as a macOS desktop wallpaper. A small Node server (no
dependencies, no build step) collects the news from VRT NWS and serves a page
that [Plash](https://sindresorhus.com/plash) shows as the wallpaper. The pages
only collect, format and show what the feeds provide: titles, sections, counts
and times.

## Run

Node 20 or newer.

```sh
npm run dev              # http://localhost:4174, restarts when a file changes
PORT=4175 npm run dev    # another port
```

## Pages

- `/` the wallpaper, in Dutch. Press `?` for the dev controls.
- `/explorer/` the data explorer: outlets, their streams and the normalized items; `?view=health` checks every stream.
- `/customize/` picks what the wallpaper shows: the design, the liveblogs that lead the front page and the sections.

Customize saves to `settings.json` (gitignored), and every open wallpaper
follows a change within a second, without a reload.

## Plash

Add this URL as a website in Plash:

```
http://localhost:4174/?chrome=0&hud=0
```

`chrome=0` drops the simulated menu bar and Dock (Plash shows the real ones)
and `hud=0` the hint for the dev controls. Leave `preset` out so the design
follows Customize; `?preset=<id>` pins one (ids in `public/presets/index.js`).

The API and the data shapes are in `integrations/README.md`; how a design is
built is in `public/presets/README.md`.

## License

MIT, see `LICENSE`. It covers this code, not the news: headlines, text and
photos belong to their publishers.
