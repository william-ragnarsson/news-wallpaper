import AppKit

// Puts a rendered PNG on the desktop. macOS derives the menu bar's tint from
// the desktop picture, which is why this is a real picture and not a window.
enum Desktop {
  static let folder = URL.applicationSupportDirectory.appending(path: "NewsWallpaper", directoryHint: .isDirectory)

  static func set(_ png: Data, on screen: NSScreen) throws {
    let files = FileManager.default
    try files.createDirectory(at: folder, withIntermediateDirectories: true)

    // A new name every time: macOS caches the picture by its path.
    let file = folder.appending(path: "wallpaper-\(Int(Date().timeIntervalSince1970)).png")
    try png.write(to: file, options: .atomic)
    try NSWorkspace.shared.setDesktopImageURL(file, for: screen, options: [
      .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue,
      .allowClipping: true,
    ])
    NSLog("Desktop picture: \(file.path)")

    // Keep this one and the one before: another Space may still show that.
    let old = try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("wallpaper-") }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
      .dropFirst(2)
    old.forEach { try? files.removeItem(at: $0) }
  }
}
