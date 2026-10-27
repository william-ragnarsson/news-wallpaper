import Foundation

// Where a rendered picture goes: a file here (wallpaper-dev), the desktop in
// the app (DesktopOutput, the only one that sets the desktop picture).
@MainActor
public protocol PNGOutput {
  // Puts the picture there and returns the file it is in.
  func put(_ snapshot: Snapshot) throws -> URL
}

// The PNG in `file`, written whole or not at all.
public struct FileOutput: PNGOutput {
  public let file: URL

  public init(_ file: URL) { self.file = file }

  public func put(_ snapshot: Snapshot) throws -> URL {
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try snapshot.png.write(to: file, options: .atomic)
    return file
  }
}
