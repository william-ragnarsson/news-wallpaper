import Foundation

// Where everything is, for the app or for wallpaper-dev. Nothing else decides
// a path: the two never share a file, so an agent trying things in its
// worktree never reaches the app on this Mac.
//   data  settings.json (and the wallpapers, in the app)
//   web   the folder with public/ and sources/, which Bridge serves
//   page  the wallpaper page the renderer loads
public struct Environment: Sendable {
  public enum Mode: Sendable { case app, dev }

  public let mode: Mode
  public let data: URL
  public let web: URL
  public let page: URL

  // The repo this was built from: under `swift run` the page and the sources
  // are read from it, and wallpaper-dev keeps its data in its .dev/.
  public static let repo = URL(filePath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()

  // The installed app: Application Support, the page and sources bundle.sh
  // copies into Resources/web. The page can point at the dev server while
  // working on it:
  // `defaults write io.github.william-ragnarsson.news-wallpaper page 'http://localhost:4174/?chrome=0&hud=0'`
  public static var app: Environment {
    Environment(
      mode: .app,
      data: URL.applicationSupportDirectory.appending(path: "NewsWallpaper", directoryHint: .isDirectory),
      web: Bundle.main.url(forResource: "web", withExtension: nil) ?? repo,
      page: UserDefaults.standard.string(forKey: "page").flatMap(URL.init(string:)) ?? Bridge.page)
  }

  // wallpaper-dev: everything in this worktree, the data in .dev/ (or
  // `data`). No defaults, nothing in Application Support.
  public static func dev(data: URL? = nil) -> Environment {
    Environment(mode: .dev, data: data ?? repo.appending(path: ".dev", directoryHint: .isDirectory), web: repo, page: Bridge.page)
  }

  public var settings: SettingsStore { SettingsStore(folder: data) }
}
