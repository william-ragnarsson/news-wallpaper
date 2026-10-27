#!/bin/sh
# Builds build/NewsWallpaper.app: swift build, then the bundle layout macOS
# expects with the page and the sources in Resources/web (Bridge.swift serves
# them from there), signed ad hoc so it runs on this Mac. Needs the Command
# Line Tools, not Xcode.
set -eu
cd "$(dirname "$0")"

# The default engine (swiftbuild) stops with "Unknown error parsing property
# list" when only the Command Line Tools are installed; the native one works.
build="swift build -c release --build-system native"
$build
bin="$($build --show-bin-path)/NewsWallpaper"

app=build/NewsWallpaper.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/"
cp Info.plist "$app/Contents/"
# The wallpaper page and what it runs; the explorer and Customize stay with
# the dev server.
web="$app/Contents/Resources/web"
mkdir -p "$web"
rsync -a --exclude explorer --exclude customize --exclude '*.md' ../public/ "$web/public/"
rsync -a --exclude '*.md' ../sources/ "$web/sources/"
codesign --force --sign - "$app"
echo "Built $app"
