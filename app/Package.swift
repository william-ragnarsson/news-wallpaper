// swift-tools-version: 6.0
// The menu bar app that sets the news page as the desktop picture. Build it
// with ./bundle.sh (Command Line Tools only, no Xcode).

import PackageDescription

let package = Package(
  name: "NewsWallpaper",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "NewsWallpaper", path: "Sources/NewsWallpaper"),
  ]
)
