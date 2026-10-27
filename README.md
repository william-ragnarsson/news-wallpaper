# news-wallpaper

Live VRT NWS news as a macOS desktop wallpaper. A menu bar app draws a news
page every few minutes and sets it as the desktop picture. Everything runs on
the Mac: there is no server to host. The pages only collect, format and show
what the feeds provide: titles, sections, counts and times.

## How it fits together

```
sources/            the news: feeds, liveblogs, the front page (plain JS, no Node or DOM APIs)
  index.mjs           the one module anything else imports
public/             the pages
  host.js             the wallpaper page's connection to its host: loads sources/, routes its network
  app.js              the wallpaper: runs the sources, renders a preset; window.wallpaper for the app
  presets/            the designs
  explorer/, customize/   dev tools, served by the dev server only
server.mjs          host 1: the dev server (http://localhost:4174/), plus a JSON API for the dev tools
settings.mjs        the dev server's settings.json
app/                host 2: the macOS app (wallpaper://app/)
  Updater.swift       when to redraw: every 5 minutes, on wake, unlock and screen changes, from the menu
  Renderer.swift      loads the page offscreen, calls window.wallpaper.refresh(), takes a picture
  Bridge.swift        serves public/ and sources/, /net and /api/settings to that page
  SettingsStore.swift the app's settings.json
  Desktop.swift       sets the picture
  wallpaper-dev       the same parts from the command line, without the desktop (AGENTS.md)
tools/check-feeds.mjs   health check of every stream (`npm run check`)
tools/check-boundaries.sh  which part may do what (only the app sets the desktop picture)
```

The sources are the backend, but they run inside the wallpaper page. The page
cannot fetch VRT itself (CORS), so it sends its requests to its host
(`/net?url=…`), and the host fetches them. Both hosts answer the same paths, so
the page runs the same in a browser and in the app. The contract is in
`sources/README.md` under Hosts.

The app and the page talk through one call: `window.wallpaper.refresh()`
fetches the news, renders it and resolves to `{ ok, error, fetchedAt }` once
fonts and images are in. When it is not ok, the app keeps the picture it has.

## Run

Node 20 or newer.

```sh
npm run dev              # http://localhost:4174, restarts when a file changes
PORT=4175 npm run dev    # another port
```

The app needs the Command Line Tools (not Xcode):

```sh
app/bundle.sh            # builds app/build/NewsWallpaper.app
npm run install-app      # builds it, replaces /Applications/NewsWallpaper.app and opens it
```

To work on the page with the app showing it, point the app at the dev server:
`defaults write io.github.william-ragnarsson.news-wallpaper page 'http://localhost:4174/?chrome=0&hud=0'`
(`defaults delete … page` to go back).

## Pages

- `/` the wallpaper, in Dutch. Press `?` for the dev controls.
- `/explorer/` the data explorer: outlets, their streams and the normalized items; `?view=health` checks every stream.
- `/customize/` picks what the wallpaper shows: the design, the liveblogs that lead the front page and the sections.

Customize saves to `settings.json` (gitignored), and every open wallpaper
follows a change within a second, without a reload.

## Plash

Without the app, [Plash](https://sindresorhus.com/plash) can show the dev
server's page as the wallpaper. Add this URL as a website in Plash:

```
http://localhost:4174/?chrome=0&hud=0
```

`chrome=0` drops the simulated menu bar and Dock (Plash shows the real ones)
and `hud=0` the hint for the dev controls. Leave `preset` out so the design
follows Customize; `?preset=<id>` pins one (ids in `public/presets/index.js`).

The sources, the hosts' contract, the API and the data shapes are in
`sources/README.md`; how a design is built is in `public/presets/README.md`.

## License

MIT, see `LICENSE`. It covers this code, not the news: headlines, text and
photos belong to their publishers.
