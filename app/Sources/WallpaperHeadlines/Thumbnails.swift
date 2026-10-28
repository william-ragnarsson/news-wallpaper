import AppKit
import NewsStore
import Observation
import WallpaperCore
import WallpaperRender

// Small pictures of the designs, for the Appearance pane's cards: each one the
// page as the desktop picture is drawn, from the stored news, with the
// window's settings and that design. A Renderer of their own draws them one
// at a time, so they never hold up the preview or the desktop picture; the
// drawing is WebKit's, in its own process, and the main thread only waits for
// it. A picture is kept for its Key and drawn again only when that changes:
// another design or setting, other news, another screen.
@MainActor
@Observable
final class Thumbnails {
  private(set) var images: [Key: NSImage] = [:]
  private(set) var failed: Set<Key> = []
  // Made when the first is drawn and let go when the window closes; the
  // pictures stay, for the next time it opens.
  @ObservationIgnored private var renderer: Renderer?

  // What a picture is drawn from: the settings with the design in them, the
  // news it shows, the screen it is laid out for.
  struct Key: Hashable {
    let settings: WallpaperSettings
    let fetchedAt: String?
    let width: Double
    let height: Double

    init(_ design: String, settings: WallpaperSettings, fetchedAt: String?, screen: CGSize) {
      var drawn = settings
      drawn.preset = design
      drawn.updatedAt = nil  // when they were saved does not change the picture
      self.settings = drawn
      self.fetchedAt = fetchedAt
      width = screen.width
      height = screen.height
    }
  }

  // Draws the pictures for `keys` that are not drawn yet, in order. Pictures
  // of older news go first. A new call cancels the one before (the view's
  // .task does), which stops after the picture it is drawing.
  func draw(_ keys: [Key], page: URL, environment: WallpaperCore.Environment) async {
    let news = Set(keys.map(\.fetchedAt))
    images = images.filter { news.contains($0.key.fetchedAt) }
    failed = failed.filter { news.contains($0.fetchedAt) }
    for key in keys where images[key] == nil && !failed.contains(key) {
      guard !Task.isCancelled else { return }
      let renderer = self.renderer ?? Renderer(environment)
      self.renderer = renderer
      // A quarter of the screen's points: the page laid out at the screen's
      // size, so the picture shows what the desktop would.
      let request = RenderRequest(page: page, size: CGSize(width: key.width, height: key.height), scale: 0.25, settings: key.settings)
      let clock = ContinuousClock()
      let start = clock.now
      do {
        let snapshot = try await renderer.render(request)
        NSLog("Thumbnail of \(key.settings.preset) drawn in \(clock.now - start)")
        images[key] = NSImage(data: snapshot.png)
      } catch StoreError.empty {
        return  // no news yet: the cards say so
      } catch {
        NSLog("Thumbnail of \(key.settings.preset) failed: \(error.localizedDescription)")
        failed.insert(key)
      }
    }
  }

  // The window closed: its web view goes, the pictures stay.
  func closed() {
    renderer = nil
  }
}
