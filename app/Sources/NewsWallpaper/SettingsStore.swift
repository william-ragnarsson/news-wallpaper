import Foundation

// The settings: the JSON the Customize page edits, kept next to the
// wallpapers (settings.mjs keeps the dev server's copy). The app does not read
// them itself: the page does, through Bridge's /api/settings, and fills in the
// defaults for what is missing.
enum SettingsStore {
  static let file = Desktop.folder.appending(path: "settings.json")

  static func load() -> Data {
    (try? Data(contentsOf: file)) ?? Data("{}".utf8)
  }

  static func save(_ json: Data) throws {
    try FileManager.default.createDirectory(at: Desktop.folder, withIntermediateDirectories: true)
    try json.write(to: file, options: .atomic)
  }
}
