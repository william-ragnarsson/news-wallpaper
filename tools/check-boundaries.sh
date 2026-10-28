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
only_in 'setDesktopImage' WallpaperHeadlines
# Only the app reads its defaults and Application Support; everything else
# gets its paths from Environment.
only_in 'UserDefaults|applicationSupportDirectory' WallpaperHeadlines WallpaperCore
only_in 'Environment\.app\b' WallpaperHeadlines
# Only the fetcher writes the news: NewsStore's commit is @_spi(Writer).
only_in '@_spi\(Writer\) import' NewsFeed
only_in '@_spi\(Writer\)' NewsFeed NewsStore

# M6, the template kit (public/presets/kit.js, kit.css): a design imports the
# kit and nothing of another design, the kit imports no design, and only the
# page loads the kit, never the Swift side.
presets=../../public/presets
for file in "$presets"/*/*.js "$presets"/*/*.css; do
  if grep -E 'import' "$file" | grep -E "['\"(]\.\./" | grep -vqE "\.\./kit\.(js|css)['\")]"; then
    echo "a design imports only ../kit.js and ../kit.css, found another in ${file#../../}" >&2
    status=1
  fi
done
if grep -qE "^[[:space:]]*@?import[[:space:]({*'\"]" "$presets/kit.js" "$presets/kit.css"; then
  echo "the template kit imports nothing, found an import in public/presets/kit.*" >&2
  status=1
fi
for file in $(grep -rlE 'kit\.(js|css)' --include='*.swift' .); do
  echo "only the page loads the template kit, found it in $file" >&2
  status=1
done

[ $status = 0 ] && echo "Boundaries hold."
exit $status
