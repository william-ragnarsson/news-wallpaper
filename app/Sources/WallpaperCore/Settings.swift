import Foundation

// What the wallpaper shows: settings.json, as the rules in public/settings.js
// make it (SettingsService).
public struct WallpaperSettings: Codable, Equatable, Sendable {
  public var preset: String
  public var provider: String
  public var liveFirst: Bool
  public var sections: [String]
  public var margin: Int
  public var updatedAt: String?
}

// What there is to pick from: options() in public/settings.js.
public struct Options: Codable, Sendable {
  public struct Design: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let data: String?
    public let sections: Bool?
    public let live: Bool?  // lists the other running liveblogs
    public let margin: Bool?
  }

  // A news outlet the front page can come from, with its section feeds, and
  // whether it has liveblogs to follow (VRT NWS only).
  public struct Provider: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let owner: String
    public let language: String
    public let homepage: URL
    public let description: String?
    public let sections: [Section]
    public let liveblogs: Bool?
  }

  public struct Section: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let group: String
  }

  public let presets: [Design]
  public let providers: [Provider]
  public let maxMargin: Int
}
