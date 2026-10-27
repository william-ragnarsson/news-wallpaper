import Foundation

// settings.json in the environment's data folder. SettingsService alone
// writes it; the page reads it through Bridge's /api/settings and fills in
// the defaults for what is missing.
public struct SettingsStore: Sendable {
  public let folder: URL
  public var file: URL { folder.appending(path: "settings.json") }

  public func load() -> Data {
    (try? Data(contentsOf: file)) ?? Data("{}".utf8)
  }

  // Written to a temp file and renamed over the old one (.atomic).
  func save(_ json: Data) throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try json.write(to: file, options: .atomic)
  }
}
