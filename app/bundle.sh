#!/bin/sh
# Builds build/WallpaperHeadlines.app: swift build, then the bundle layout macOS
# expects with the page and the sources in Resources/web (Bridge.swift serves
# them from there), signed ad hoc so it runs on this Mac. Needs the Command
# Line Tools, not Xcode.
set -eu
cd "$(dirname "$0")"

# The default engine (swiftbuild) stops with "Unknown error parsing property
# list" when only the Command Line Tools are installed; the native one works.
# Only the app: wallpaper-dev is for working on it, not for the bundle.
# Arguments go to swift build: the Homebrew formula passes --disable-sandbox,
# as Homebrew's own sandbox does not let SwiftPM start one inside it.
build="swift build -c release --build-system native --product WallpaperHeadlines $*"
$build
bin="$($build --show-bin-path)/WallpaperHeadlines"

app=build/WallpaperHeadlines.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/"
cp Info.plist "$app/Contents/"
# The app icon, for Finder, the Dock and Cmd+Tab; icon.swift draws it.
cp AppIcon.icns "$app/Contents/Resources/"
# The wallpaper page and what it runs; the explorer stays with the dev server.
web="$app/Contents/Resources/web"
mkdir -p "$web"
rsync -a --exclude explorer --exclude '*.md' ../public/ "$web/public/"
rsync -a --exclude '*.md' ../sources/ "$web/sources/"
# Settings shows it.
cp ../LICENSE "$app/Contents/Resources/"
codesign --force --sign - "$app"
echo "Built $app"
