// swift-tools-version: 6.0
// The menu bar app that sets the news page as the desktop picture, and
// wallpaper-dev, which runs the same parts from the command line without
// touching the desktop (AGENTS.md). Build the app with ./bundle.sh (Command
// Line Tools only, no Xcode).
//   WallpaperCore    where things are (Environment), the page's host (Bridge), settings
//   WallpaperRender  draws the page for a RenderRequest and returns a PNG; FileOutput (M3)
//   NewsWallpaper    the app: menu bar, Updater, DesktopOutput, Customize (M4, M5)
//   wallpaper-dev    the command line for agents

import PackageDescription

let package = Package(
  name: "NewsWallpaper",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "NewsWallpaper", targets: ["NewsWallpaper"]),
    .executable(name: "wallpaper-dev", targets: ["wallpaper-dev"]),
  ],
  targets: [
    .target(name: "WallpaperCore", path: "Sources/WallpaperCore"),
    .target(name: "WallpaperRender", dependencies: ["WallpaperCore"], path: "Sources/WallpaperRender"),
    .executableTarget(name: "NewsWallpaper", dependencies: ["WallpaperCore", "WallpaperRender"], path: "Sources/NewsWallpaper"),
    .executableTarget(name: "wallpaper-dev", dependencies: ["WallpaperCore", "WallpaperRender"], path: "Sources/wallpaper-dev"),
  ]
)
