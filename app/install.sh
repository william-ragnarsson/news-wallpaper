#!/bin/sh
# Builds the app and makes it the one on this Mac: quits the running copy,
# puts the new one in /Applications and opens it. For trying a build by hand;
# agents use wallpaper-dev instead (see AGENTS.md), which touches neither the
# installed app nor the desktop picture.
set -eu
cd "$(dirname "$0")"

sh bundle.sh

# Asks the running copy to quit, then waits for it to be gone.
if pgrep -x WallpaperHeadlines >/dev/null; then
  osascript -e 'quit app "WallpaperHeadlines"'
  tries=0
  while pgrep -x WallpaperHeadlines >/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then
      echo "WallpaperHeadlines did not quit; quit it from the menu bar and run this again." >&2
      exit 1
    fi
    sleep 0.1
  done
fi

app=/Applications/WallpaperHeadlines.app
rm -rf "$app"
ditto build/WallpaperHeadlines.app "$app"
open "$app"
echo "Installed and opened $app"
