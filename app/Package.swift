// swift-tools-version: 6.0
// The menu bar app that sets the news page as the desktop picture, and
// wallpaper-dev, which runs the same parts from the command line without
// touching the desktop (AGENTS.md). Build the app with ./bundle.sh (Command
// Line Tools only, no Xcode).
//   WallpaperCore    where things are (Environment), the page's host (Bridge), settings
//   NewsStore        the news fetched last, news.json (M1)
//   NewsFeed         fetches the news and stores it, the store's one writer (M2)
//   WallpaperRender  draws the stored news for a RenderRequest and returns a PNG; FileOutput (M3)
//   WallpaperHeadlines    the app: menu bar, Updater, DesktopOutput, Customize (M4, M5)
//   wallpaper-dev    the command line for agents

import PackageDescription

let package = Package(
  name: "WallpaperHeadlines",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "WallpaperHeadlines", targets: ["WallpaperHeadlines"]),
    .executable(name: "wallpaper-dev", targets: ["wallpaper-dev"]),
  ],
  targets: [
    .target(name: "WallpaperCore", path: "Sources/WallpaperCore"),
    .target(name: "NewsStore", dependencies: ["WallpaperCore"], path: "Sources/NewsStore"),
    .target(name: "NewsFeed", dependencies: ["WallpaperCore", "NewsStore"], path: "Sources/NewsFeed"),
    .target(name: "WallpaperRender", dependencies: ["WallpaperCore", "NewsStore"], path: "Sources/WallpaperRender"),
    .executableTarget(
      name: "WallpaperHeadlines", dependencies: ["WallpaperCore", "NewsStore", "NewsFeed", "WallpaperRender"], path: "Sources/WallpaperHeadlines"),
    .executableTarget(
      name: "wallpaper-dev", dependencies: ["WallpaperCore", "NewsStore", "NewsFeed", "WallpaperRender"], path: "Sources/wallpaper-dev"),
  ]
)
