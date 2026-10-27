#!/bin/sh
# Builds build/NewsWallpaper.app: swift build, then the bundle layout macOS
# expects, signed ad hoc so it runs on this Mac. Needs the Command Line Tools,
# not Xcode.
set -eu
cd "$(dirname "$0")"

# The default engine (swiftbuild) stops with "Unknown error parsing property
# list" when only the Command Line Tools are installed; the native one works.
build="swift build -c release --build-system native"
$build
bin="$($build --show-bin-path)/NewsWallpaper"

app=build/NewsWallpaper.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/"
cp Info.plist "$app/Contents/"
# Settings shows it.
cp ../LICENSE "$app/Contents/Resources/"
codesign --force --sign - "$app"
echo "Built $app"
