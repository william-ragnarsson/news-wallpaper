import AppKit
import NewsStore
import Observation
import WallpaperCore
import WallpaperRender

// Small pictures of the designs, for the Appearance pane's cards: each one the
// page as the desktop picture is drawn, from the stored news, with the
// window's settings and that design. A Renderer of their own draws them one
// at a time, so they never hold up the preview or the desktop picture. The
// news is read once for them all, off the main thread; WebKit lays out and
// draws the page in its own process, and the main thread makes each PNG. A
// picture is kept for its Key and drawn again only when that changes:
// another design or a setting it follows, other news, another screen or page.
@MainActor
@Observable
final class Thumbnails {
  private(set) var images: [Key: NSImage] = [:]
  private(set) var failed: Set<Key> = []
  // Each design's picture drawn last, shown while the one for its new Key is
  // drawn, as the preview shows the one before.
  private var latest: [String: NSImage] = [:]
  // Made when the first is drawn and let go when the window closes; the
  // pictures stay, for the next time it opens.
  @ObservationIgnored private var renderer: Renderer?

  // What a picture is drawn from: the settings with the design in them, the
  // news it shows, the screen it is laid out for, the page. Settings the
  // design does not follow are left at one value, so a change to them keeps
  // its picture.
  struct Key: Hashable {
    let settings: WallpaperSettings
    let fetchedAt: String?
    let width: Double
    let height: Double
    let page: URL

    init(_ design: Options.Design, settings: WallpaperSettings, fetchedAt: String?, screen: CGSize, page: URL) {
      var drawn = settings
      drawn.preset = design.id
      drawn.updatedAt = nil  // when they were saved does not change the picture
      if design.margin != true { drawn.margin = 0 }
      if design.pictures != true { drawn.pictures = "one" }
      if design.color != true { drawn.color = false }
      if design.sections != true { drawn.sections = [] }
      // liveFirst orders the top stories, which every front-page design shows.
      if design.data != "front" { drawn.liveFirst = true }
      self.settings = drawn
      self.fetchedAt = fetchedAt
      width = screen.width
      height = screen.height
      self.page = page
    }

    var design: String { settings.preset }
  }

  // The picture for `key`, or the design's one before while it is drawn.
  func image(for key: Key) -> NSImage? {
    images[key] ?? (failed.contains(key) ? nil : latest[key.design])
  }

  // Draws the pictures for `keys` that are not drawn yet, in order, and lets
  // the others go. A new call cancels the one before (the view's .task does),
  // which stops after the picture it is drawing.
  func draw(_ keys: [Key], environment: WallpaperCore.Environment) async {
    let wanted = Set(keys)
    images = images.filter { wanted.contains($0.key) }
    failed = failed.intersection(wanted)
    let designs = Set(keys.map(\.design))
    latest = latest.filter { designs.contains($0.key) }
    let missing = keys.filter { images[$0] == nil && !failed.contains($0) }
    guard !missing.isEmpty else { return }

    // The news, once for the lot and off the main thread.
    let store = environment.news
    let news: NewsSnapshot
    do {
      news = try await Task.detached { try store.read() }.value
    } catch {
      return  // no news yet: the cards say so
    }
    // Keys of other news wait for the window to load it.
    for key in missing where key.fetchedAt == news.meta.fetchedAt {
      guard !Task.isCancelled else { return }
      let renderer = self.renderer ?? Renderer(environment)
      self.renderer = renderer
      // A quarter of the screen's points: the page laid out at the screen's
      // size, so the picture shows what the desktop would.
      let request = RenderRequest(
        page: key.page, size: CGSize(width: key.width, height: key.height), scale: 0.25, settings: key.settings, news: news)
      let clock = ContinuousClock()
      let start = clock.now
      do {
        let snapshot = try await renderer.render(request)
        NSLog("Thumbnail of \(key.design) drawn in \(clock.now - start)")
        let image = NSImage(data: snapshot.png)
        images[key] = image
        latest[key.design] = image
      } catch let error as PageError {
        // The page cannot draw this news: not again for this Key.
        NSLog("Thumbnail of \(key.design) failed: \(error.localizedDescription)")
        failed.insert(key)
      } catch {
        // A timeout or a crash: tried again next time.
        NSLog("Thumbnail of \(key.design) failed: \(error.localizedDescription)")
      }
    }
  }

  // The window closed: its web view goes, the pictures stay. What failed is
  // tried again when it opens.
  func closed() {
    renderer = nil
    failed = []
  }
}
