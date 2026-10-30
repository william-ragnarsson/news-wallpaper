import AppKit
import CustomizeUI
import SwiftUI
import WallpaperCore

// pane sources: Customize's Sources pane as the app shows it, with the
// settings and stored news in the data folder, drawn in a window off screen
// and written as a PNG. Nothing is fetched, saved or shown.
@MainActor
func pane(_ arguments: Arguments, _ environment: WallpaperCore.Environment) async throws -> [String: Any] {
  guard arguments.words.first == "sources" else { throw Failure("pane draws one pane: pane sources --out <file.png>") }
  guard let out = arguments["out"] else { throw Failure("pane needs --out <file.png>") }
  let sizes = (arguments["size"] ?? "560x2400").split(separator: "x").compactMap { Double($0) }
  guard sizes.count == 2, sizes.allSatisfy({ $0 >= 100 }) else { throw Failure("--size is <width>x<height> in points, e.g. 560x2400") }
  let appearance: NSAppearance.Name
  switch arguments["appearance"] ?? "light" {
  case "light": appearance = .aqua
  case "dark": appearance = .darkAqua
  case let other: throw Failure("--appearance is light or dark, not \(other)")
  }

  let service = SettingsService(environment)
  let stored = try? environment.news.read()
  let options = try await service.options(news: stored?.data)
  let settings = try await service.get()
  let form = SourcesForm(
    digest: SourcesDigest(options: options, settings: settings, news: stored?.meta),
    provider: .constant(settings.provider),
    liveFirst: .constant(settings.liveFirst),
    sections: .constant(settings.sections))

  let size = CGSize(width: sizes[0], height: sizes[1])
  let view = NSHostingView(rootView: form.frame(width: size.width, height: size.height))
  let window = NSWindow(contentRect: CGRect(origin: CGPoint(x: -20_000, y: -20_000), size: size), styleMask: .borderless, backing: .buffered, defer: false)
  window.appearance = NSAppearance(named: appearance)
  window.contentView = view
  view.layoutSubtreeIfNeeded()
  // The Form lays out its rows over a few turns of the run loop.
  try await Task.sleep(for: .milliseconds(500))
  view.layoutSubtreeIfNeeded()
  guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw Failure("Could not draw the pane") }
  view.cacheDisplay(in: view.bounds, to: bitmap)
  guard let png = bitmap.representation(using: .png, properties: [:]) else { throw Failure("Could not make a PNG") }
  let file = URL(filePath: out)
  try png.write(to: file)
  window.close()
  var result: [String: Any] = ["path": file.path(percentEncoded: false), "width": bitmap.pixelsWide, "height": bitmap.pixelsHigh, "provider": settings.provider]
  result["fetchedAt"] = stored?.meta.fetchedAt
  return result
}
