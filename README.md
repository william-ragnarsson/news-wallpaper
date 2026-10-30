# wallpaper-headlines

Live news as a macOS desktop wallpaper, from one outlet at a time: VRT NWS
(in Dutch), The New York Times, The Washington Post or Fox News (in English),
picked in Customize. A menu bar app draws a news page every few minutes and
sets it as the desktop picture. Everything runs on
the Mac: there is no server to host. The pages only collect, format and show
what the feeds provide: titles, sections, counts and times.

## Install

```sh
brew install william-ragnarsson/tap/wallpaper-headlines
wallpaper-headlines      # opens the app
```

It builds on your Mac, so it needs macOS 14 or later and the Command Line
Tools (`xcode-select --install`). Update it from the app's Settings, or with
`brew upgrade wallpaper-headlines`. The formula is in
[william-ragnarsson/homebrew-tap](https://github.com/william-ragnarsson/homebrew-tap).

## How it fits together

```
sources/            the news: feeds, liveblogs, the front page (plain JS, no Node or DOM APIs)
  index.mjs           the one module anything else imports
public/             the pages
  host.js             the wallpaper page's connection to its host: loads sources/, routes its network
  app.js              the wallpaper: runs the sources, renders a preset; window.wallpaper for the app
  harvest.js          the app's fetch: all the news there is to pick from, as one document
  presets/            the designs
  explorer/           the data explorer, served by the dev server only
server.mjs          host 1: the dev server (http://localhost:4174/), plus a JSON API for the explorer
settings.mjs        the dev server reads the settings: .dev/settings.json, by the rules in public/settings.js
app/                host 2: the macOS app (wallpaper://app/)
  Updater.swift       when to redraw: every 5 minutes, on wake, unlock and screen changes, from the menu
  Renderer.swift      loads the page offscreen, calls window.wallpaper.refresh(), takes a picture
                      (a RenderRequest: size, scale, settings for once), one render at a time
  Bridge.swift        serves public/ and sources/, /api/news and /api/settings to that page
                      (and /net, but not to the page drawn: only to the fetch)
  SettingsService.swift  the settings: runs public/settings.js, the only writer of settings.json
  NewsStore           the news fetched last: news.json, and news.prev.json before it
  NewsFeed            Fetcher: runs public/harvest.js, the only writer of news.json
  Customize           the window that picks the design, the news provider and sections (menu bar → Customize);
                      its preview is a render, and what it lists comes from the stored news
  DesktopOutput.swift sets the picture
  ArticlesMenu.swift  the menu's Articles ›: the stories on the picture, each opens in the browser
  wallpaper-dev       the same parts from the command line, without the desktop (AGENTS.md)
tools/check-feeds.mjs   health check of every stream (`npm run check`)
tools/check-boundaries.sh  which part may do what (only the app sets the desktop picture)
```

The sources are the backend, but they run inside the wallpaper page. The page
cannot fetch the outlets itself (CORS), so it sends its requests to its host
(`/net?url=…`), and the host fetches them. Both hosts answer the same paths, so
the page runs the same in a browser and in the app. The contract is in
`sources/README.md` under Hosts.

In the app, fetching and drawing are apart. Every 5 minutes, on wake and on
Update news (the menu, Customize), the Fetcher runs the sources (`public/harvest.js`) and stores all the
news there is to pick from in `news.json`; then the page is drawn from that
(`?data=store`: it reads `/api/news`, and has no `/net`). A change in Customize
only draws again, unless it picks another provider (the store holds only the
one picked): that is fetched first. The page's one call is
`window.wallpaper.refresh()`: it renders and resolves to `{ ok, error,
fetchedAt, stories }` once fonts and images are in. When it is not ok, the app keeps the
picture it has. `stories` are the articles the picture shows, the ones the
design marks with `data-story` that fitting left in view (`public/presets/README.md`);
the menu bar lists them under Articles.

## Run

Node 20 or newer.

```sh
npm run dev              # http://localhost:4174, restarts when a file changes
PORT=4175 npm run dev    # another port
```

The app needs the Command Line Tools (not Xcode):

```sh
app/bundle.sh            # builds app/build/WallpaperHeadlines.app
npm run install-app      # builds it, replaces /Applications/WallpaperHeadlines.app and opens it
```

To work on the page with the app showing it, point the app at the dev server:
`defaults write io.github.william-ragnarsson.wallpaper-headlines page 'http://localhost:4174/?chrome=0&hud=0'`
(`defaults delete … page` to go back).

## Pages

- `/` the wallpaper, in the provider's language (Dutch for VRT NWS, English for the others). Press `?` for the dev controls.
- `/explorer/` the data explorer: outlets, their streams and the normalized items; `?view=health` checks every stream.

The dev server's settings are `.dev/settings.json` (gitignored), the file
`wallpaper-dev settings set` changes (AGENTS.md); every open wallpaper follows a
change within a second, without a reload. The app keeps its own settings,
picked in its Customize window. `wallpaper-dev render` draws the page as the
app does, from the stored news, into a PNG.

## Plash

Without the app, [Plash](https://sindresorhus.com/plash) can show the dev
server's page as the wallpaper. Add this URL as a website in Plash:

```
http://localhost:4174/?chrome=0&hud=0
```

`chrome=0` drops the simulated menu bar and Dock (Plash shows the real ones)
and `hud=0` the hint for the dev controls. Leave `preset` out so the design
follows the settings; `?preset=<id>` pins one (ids in `public/presets/index.js`).

The sources, the hosts' contract, the API and the data shapes are in
`sources/README.md`; how a design is built is in `public/presets/README.md`.

## License

MIT, see `LICENSE`. It covers this code, not the news: headlines, text and
photos belong to their publishers.
