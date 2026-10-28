import AppKit
import NewsStore
import WallpaperCore
import WebKit

// Draws the wallpaper page in a web view that is never shown on screen and
// returns it as a PNG (a RenderRequest says at what size). The page stays
// loaded between pictures: each one asks it to draw the news stored last
// (window.wallpaper.refresh, in public/app.js) and waits until it is drawn.
// Its Bridge has no network: a picture shows the stored news (NewsStore) or
// fails, it never fetches.
// Where the PNG goes is up to the caller (PNGOutput): the app puts it on the
// desktop, wallpaper-dev in a file.
@MainActor
public final class Renderer: NSObject, WKNavigationDelegate {
  private let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
  private let webView: WKWebView
  private let bridge: Bridge
  private let store: NewsStore
  // The page as it is loaded; nil when it has to load (again).
  private var loaded: URL?
  private var navigation: WKNavigation?
  // The one thing a render waits for at a time, a load or a refresh.
  private var waiting: (id: Int, continuation: CheckedContinuation<Void, Error>)?
  private var lastID = 0
  // What the page's last refresh said about the news it drew.
  private var fetchedAt: String?
  // Renders run one at a time, in the order asked: this ends after the last.
  private var queue: Task<Void, Never>?
  private var stamps = 0

  public init(_ environment: Environment) {
    bridge = Bridge(environment, network: false)
    store = environment.news
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(bridge, forURLScheme: Bridge.scheme)
    // Nothing kept on disk, so two renderers (the app, an agent's
    // wallpaper-dev) share no state.
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    window.isReleasedWhenClosed = false
    window.contentView = webView
    webView.navigationDelegate = self
    // Safari's Develop menu can inspect the page.
    webView.isInspectable = true
  }

  // Draws the page as `request` asks, after the renders asked for before it.
  public func render(_ request: RenderRequest) async throws -> Snapshot {
    let previous = queue
    let render = Task {
      await previous?.value
      return try await draw(request)
    }
    queue = Task { _ = await render.result }
    return try await render.value
  }

  private func draw(_ request: RenderRequest) async throws -> Snapshot {
    if request.settings != nil, request.page.scheme != Bridge.scheme {
      throw RenderError.settingsNeedBridge(request.page)
    }
    // A page of the Bridge draws the stored news, asked for or not: it has
    // no network to fetch with.
    let page = request.page.scheme == Bridge.scheme ? Self.fromStore(request.page) : request.page
    // On a screen with the scale asked for, if there is one, so the page
    // gets that pixel density; but the window is never ordered in.
    let screen = NSScreen.screens.first { $0.backingScaleFactor == request.scale } ?? NSScreen.screens.first
    let frame = CGRect(origin: screen?.frame.origin ?? .zero, size: request.size)
    if window.frame != frame {
      window.setFrame(frame, display: false)
      loaded = nil
    }

    // The news for this picture: read once, so the page and the snapshot's
    // fetchedAt agree, unless the request brings it. Before the first fetch
    // this throws StoreError.empty. A page from a server reads its own.
    var stored: NewsSnapshot?
    if request.page.scheme == Bridge.scheme {
      let news = try request.news ?? store.read()
      bridge.news = { news.data }
      stored = news
    }

    // The settings for this picture alone, served instead of the saved ones.
    // A stamp of their own, so the page takes them in (it skips settings
    // with the updatedAt it has), and takes the saved ones in again after.
    if var settings = request.settings {
      stamps += 1
      settings.updatedAt = "render \(stamps)"
      bridge.settingsOverride = try JSONEncoder().encode(settings)
    }
    defer { bridge.settingsOverride = nil }

    if loaded != page {
      try await wait(seconds: 30) { _ in
        navigation = webView.load(URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData))
      }
      loaded = page
    }

    do {
      fetchedAt = nil
      try await wait(seconds: 60) { id in
        webView.callAsyncJavaScript(Self.refresh, in: nil, in: .page) { [weak self] result in
          guard let self else { return }
          let answer = try? result.get() as? [String: Any]
          if id == waiting?.id { fetchedAt = answer?["fetchedAt"] as? String }
          end(id, result.flatMap(Self.outcome))
        }
      }
    } catch {
      // A page that did not answer is loaded again next time; one that says
      // it could not fetch the news is fine as it is.
      if !(error is PageError) { loaded = nil }
      throw error
    }

    // The page is laid out at the window's pixel density; a snapshot of
    // another width is drawn again at that size by WebKit, not scaled up.
    let pixels = CGSize(width: (request.size.width * request.scale).rounded(), height: (request.size.height * request.scale).rounded())
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = NSNumber(value: pixels.width / window.backingScaleFactor)
    let image = try await webView.takeSnapshot(configuration: config)
    guard var cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw RenderError.noImage }
    if cgImage.width != Int(pixels.width) || cgImage.height != Int(pixels.height) {
      cgImage = try Self.resized(cgImage, to: pixels)
    }
    guard let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else { throw RenderError.noImage }
    NSLog("Rendered \(cgImage.width)×\(cgImage.height) px for \(Int(request.size.width))×\(Int(request.size.height)) pt")
    return Snapshot(png: png, width: cgImage.width, height: cgImage.height, fetchedAt: fetchedAt ?? stored?.meta.fetchedAt)
  }

  // `page` with data=store.
  private static func fromStore(_ page: URL) -> URL {
    guard var components = URLComponents(url: page, resolvingAgainstBaseURL: false) else { return page }
    components.queryItems = (components.queryItems ?? []).filter { $0.name != "data" } + [URLQueryItem(name: "data", value: "store")]
    return components.url ?? page
  }

  // Exactly `size`: a snapshot can come out a pixel off when the scale does
  // not divide evenly.
  private static func resized(_ image: CGImage, to size: CGSize) throws -> CGImage {
    guard let context = CGContext(
      data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
      space: image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw RenderError.noImage }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(origin: .zero, size: size))
    guard let resized = context.makeImage() else { throw RenderError.noImage }
    return resized
  }

  // Asks the page for the latest news and waits until it is drawn. WebKit can
  // report the page loaded before its modules ran; until then
  // window.wallpaper is the <main id="wallpaper"> element.
  private static let refresh = """
    while (typeof window.wallpaper?.refresh !== 'function') await new Promise(r => setTimeout(r, 50));
    return await window.wallpaper.refresh();
    """

  // What the page's refresh resolved to: {ok, error, fetchedAt}. Not ok means
  // the news could not be loaded, and the picture on the desktop stays.
  private static func outcome(_ value: Any) -> Result<Void, Error> {
    let result = value as? [String: Any]
    if result?["ok"] as? Bool == true { return .success(()) }
    return .failure(PageError(reason: result?["error"] as? String ?? "no result"))
  }

  // Starts something with `begin`, then waits until end is called for it or
  // `seconds` pass.
  private func wait(seconds: Int, _ begin: (Int) -> Void) async throws {
    lastID += 1
    let id = lastID
    try await withCheckedThrowingContinuation { continuation in
      waiting = (id, continuation)
      begin(id)
      Task { [weak self] in
        try? await Task.sleep(for: .seconds(seconds))
        self?.end(id, .failure(RenderError.timedOut))
      }
    }
  }

  // Ends the wait with that id, or whichever is waiting for a nil id.
  private func end(_ id: Int?, _ result: Result<Void, Error>) {
    guard let waiting, id == nil || id == waiting.id else { return }
    self.waiting = nil
    waiting.continuation.resume(with: result)
  }

  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if navigation == self.navigation { end(nil, .success(())) }
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if navigation == self.navigation { end(nil, .failure(error)) }
  }

  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if navigation == self.navigation { end(nil, .failure(error)) }
  }

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = nil
    end(nil, .failure(RenderError.pageCrashed))
  }
}

// What to draw: `page` at `size` points, `scale` pixels to the point, so the
// PNG is size × scale pixels. `settings`, when given, are used for this
// picture instead of the saved ones (and not saved); they need a page the
// Bridge serves (wallpaper://), as a server keeps its own. `news`, when
// given, is drawn instead of the store read again, for a caller that draws
// several pictures of one read; a page from a server ignores it.
public struct RenderRequest: Sendable {
  public var page: URL
  public var size: CGSize
  public var scale: CGFloat
  public var settings: WallpaperSettings?
  public var news: NewsSnapshot?

  public init(page: URL, size: CGSize, scale: CGFloat, settings: WallpaperSettings? = nil, news: NewsSnapshot? = nil) {
    self.page = page
    self.size = size
    self.scale = scale
    self.settings = settings
    self.news = news
  }

  // The whole of `screen`, at its pixel density: a desktop picture.
  @MainActor
  public init(page: URL, for screen: NSScreen, settings: WallpaperSettings? = nil) {
    self.init(page: page, size: screen.frame.size, scale: screen.backingScaleFactor, settings: settings)
  }
}

// A picture of the page: the PNG, its size in pixels, and when the news on it
// was fetched (an ISO date, from the page).
public struct Snapshot: Sendable {
  public let png: Data
  public let width: Int
  public let height: Int
  public let fetchedAt: String?
}

public enum RenderError: Error, LocalizedError, CustomStringConvertible {
  case noImage
  case timedOut
  case pageCrashed
  case settingsNeedBridge(URL)

  public var description: String {
    switch self {
    case .noImage: "The page gave no image"
    case .timedOut: "The page did not answer in time"
    case .pageCrashed: "The page's web view stopped"
    case .settingsNeedBridge(let page): "Settings for one render need a wallpaper:// page, not \(page.absoluteString)"
    }
  }

  public var errorDescription: String? { description }
}

// The page could not load the news: from the store, or from a site when a
// server serves it (a site down, no network).
public struct PageError: Error, LocalizedError, CustomStringConvertible {
  public let reason: String
  public var description: String { "The page could not load the news: \(reason)" }
  public var errorDescription: String? { description }
}
