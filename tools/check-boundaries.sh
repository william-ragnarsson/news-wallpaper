#!/bin/sh
# The lines between the app's parts, which the compiler does not draw on its
# own (AGENTS.md has the map). Exits 1 and names the file when one is crossed.
set -u
cd "$(dirname "$0")/../app/Sources"
status=0

# Fails when `pattern` shows up in a Swift file outside the folders allowed.
only_in() {
  pattern=$1
  shift
  for file in $(grep -rlE "$pattern" --include='*.swift' .); do
    allowed=no
    for folder in "$@"; do
      case $file in "./$folder/"*) allowed=yes ;; esac
    done
    if [ $allowed = no ]; then
      echo "$pattern is only for $*, found in $file" >&2
      status=1
    fi
  done
}

# Only the app sets the desktop picture.
only_in 'setDesktopImage' NewsWallpaper
# Only the app reads its defaults and Application Support; everything else
# gets its paths from Environment.
only_in 'UserDefaults|applicationSupportDirectory' NewsWallpaper WallpaperCore
only_in 'Environment\.app\b' NewsWallpaper
# Only the fetcher writes the news: NewsStore's commit is @_spi(Writer).
only_in '@_spi\(Writer\) import' NewsFeed
only_in '@_spi\(Writer\)' NewsFeed NewsStore

[ $status = 0 ] && echo "Boundaries hold."
exit $status
