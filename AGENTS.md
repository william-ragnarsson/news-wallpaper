# Working on news-wallpaper as an agent

Several sessions work on this repo at once, on one Mac. Only one copy of the app
can be installed and only one picture can be on the desktop. So: **never
install, open or run the app itself.** Try changes with `wallpaper-dev`, which
runs the app's parts inside your worktree and touches nothing outside it.

## wallpaper-dev

```sh
swift run --package-path app --build-system native wallpaper-dev help
swift run --package-path app --build-system native wallpaper-dev fetch
swift run --package-path app --build-system native wallpaper-dev news '.streams.voorpagina.items | length'
swift run --package-path app --build-system native wallpaper-dev render --out .dev/front.png
swift run --package-path app --build-system native wallpaper-dev render --out .dev/live.png --preset <id> --size 1512x982 --scale 2
swift run --package-path app --build-system native wallpaper-dev render --out .dev/wide.png --settings '{"margin": 0}'
swift run --package-path app --build-system native wallpaper-dev settings set preset=evening margin=80
swift run --package-path app --build-system native wallpaper-dev options
```

- Each command prints one JSON object. A failure prints `{"error": …}` and exits 1.
- `render` draws the stored news on the wallpaper page as the app does, and
  writes the PNG: `--size` points times `--scale` pixels. It fetches nothing, so
  `fetch` first; with no news stored it fails. Read the PNG to check a change to
  the page or a design. Preset ids are in `public/presets/index.js`.
  `--settings` tries settings for one picture without saving them.
- `fetch` fetches all the news there is to pick from into `.dev/news.json`
  (the one before stays as `news.prev.json`) and prints what it got; `news
  [path]` prints it, or one part (a jq path: keys, indexes, `| length`,
  `| keys`). The page reads it with `?data=store`, from `/api/news`: the
  app and `render` always do, the dev server when you add it to the URL.
- `settings` prints the settings; `settings set <key>=<value>…` checks and saves
  them, as the app's Customize does (the rules are `public/settings.js`).
  `options` lists what there is to pick from.
- Its data (settings.json, news.json) lives in `.dev/` in your worktree (gitignored), or
  in `--data <folder>`. The dev server (`npm run dev`) in your worktree uses the
  same `.dev/settings.json`.

## Never

- `npm run install-app`, `app/install.sh`, or `app/bundle.sh` followed by `open`: they
  replace the installed app. Those are for the user.
- `swift run NewsWallpaper`: it sets the real desktop picture.
- `defaults write io.github.william-ragnarsson.news-wallpaper …`.
- Writing to `~/Library/Application Support/NewsWallpaper`.
- Killing processes by name (`pkill node`, `pkill NewsWallpaper`). The user's dev
  server on port 4174 and the installed app are theirs.

`.dev/` is the only runtime folder you write to.

## Where things are

| Folder | Part |
|---|---|
| `sources/` | the news: feeds, liveblogs, the front page (plain JS) |
| `public/` | the wallpaper page (`app.js`, `host.js`) and its designs (`presets/`) |
| `app/Sources/WallpaperCore` | `Environment` (every path), `Bridge` (the page's host), `SettingsService` (the settings, by `public/settings.js`) |
| `app/Sources/NewsStore` | M1: the news fetched last, `news.json`; `read()`, `meta()`, and `commit` for the fetcher only |
| `app/Sources/NewsFeed` | M2: `Fetcher`, which runs `public/harvest.js` and commits what it gives |
| `app/Sources/WallpaperRender` | `Renderer`: draws the page for a `RenderRequest`, returns a PNG; `PNGOutput`, `FileOutput` |
| `app/Sources/NewsWallpaper` | the app: menu bar, `Updater`, `DesktopOutput`, the Customize window |
| `app/Sources/wallpaper-dev` | the command line above |
| `server.mjs` | the dev server for the explorer (`npm run dev`, port 4174) |

`sh tools/check-boundaries.sh` checks the lines between them, for example that
only the app sets the desktop picture. Run it, and
`swift build --package-path app --build-system native`, before you finish.
