# Working on news-wallpaper as an agent

Several sessions work on this repo at once, on one Mac. Only one copy of the app
can be installed and only one picture can be on the desktop. So: **never
install, open or run the app itself.** Try changes with `wallpaper-dev`, which
runs the app's parts inside your worktree and touches nothing outside it.

## wallpaper-dev

```sh
swift run --package-path app --build-system native wallpaper-dev help
swift run --package-path app --build-system native wallpaper-dev render --out .dev/front.png
swift run --package-path app --build-system native wallpaper-dev render --out .dev/live.png --preset <id> --size 1512x982
```

- Each command prints one JSON object. A failure prints `{"error": …}` and exits 1.
- `render` draws the wallpaper page as the app does, and writes the PNG. Read
  the PNG to check a change to the page or a design. Preset ids are in
  `public/presets/index.js`.
- Its data (settings.json) lives in `.dev/` in your worktree (gitignored), or
  in `--data <folder>`. Edit `.dev/settings.json` to try settings.

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
| `app/Sources/WallpaperCore` | `Environment` (every path), `Bridge` (the page's host), settings |
| `app/Sources/WallpaperRender` | `Renderer`: draws the page, returns a PNG |
| `app/Sources/NewsWallpaper` | the app: menu bar, `Updater`, `Desktop`, the Customize window |
| `app/Sources/wallpaper-dev` | the command line above |
| `server.mjs` | the dev server for the explorer (`npm run dev`, port 4174) |

`sh tools/check-boundaries.sh` checks the lines between them, for example that
only the app sets the desktop picture. Run it, and
`swift build --package-path app --build-system native`, before you finish.
