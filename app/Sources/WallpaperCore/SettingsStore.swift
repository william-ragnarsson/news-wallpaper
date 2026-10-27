import Foundation

// The settings: the JSON the Customize page edits, kept in the environment's
// data folder (settings.mjs keeps the dev server's copy). The app does not
// read them itself: the page does, through Bridge's /api/settings, and fills
// in the defaults for what is missing.
public struct SettingsStore: Sendable {
  public let folder: URL
  public var file: URL { folder.appending(path: "settings.json") }

  public func load() -> Data {
    (try? Data(contentsOf: file)) ?? Data("{}".utf8)
  }

  public func save(_ json: Data) throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try json.write(to: file, options: .atomic)
  }
}
