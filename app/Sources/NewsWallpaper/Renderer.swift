import AppKit
import WebKit

// Draws the wallpaper page in a web view that is never shown on screen and
// returns it as a PNG at the screen's pixel size. The page stays loaded
// between pictures: each one asks it for the latest news
// (window.wallpaper.refresh, in public/app.js) and waits until it is drawn.
@MainActor
final class Renderer: NSObject, WKNavigationDelegate {
  // The wallpaper page. Point it at the dev server while working on the page:
  // `defaults write io.github.william-ragnarsson.news-wallpaper page 'http://localhost:4174/?chrome=0&hud=0'`
  static var page: URL {
    UserDefaults.standard.string(forKey: "page").flatMap(URL.init(string:))
      ?? URL(string: "?chrome=0&hud=0", relativeTo: Bridge.home)!.absoluteURL
  }

  private let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
  private let webView: WKWebView
  // The page as it is loaded; nil when it has to load (again).
  private var loaded: URL?
  private var navigation: WKNavigation?
  // The one thing render waits for at a time, a load or a refresh.
  private var waiting: (id: Int, continuation: CheckedContinuation<Void, Error>)?
  private var lastID = 0

  override init() {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(Bridge(), forURLScheme: Bridge.scheme)
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    window.isReleasedWhenClosed = false
    window.contentView = webView
    webView.navigationDelegate = self
    // Safari's Develop menu can inspect the page.
    webView.isInspectable = true
  }

  func render(for screen: NSScreen) async throws -> Data {
    // The window sits on the screen it renders for, so the page gets that
    // screen's size and pixel density, but it is never ordered in.
    if window.frame != screen.frame {
      window.setFrame(screen.frame, display: false)
      loaded = nil
    }
    let page = Self.page
    if loaded != page {
      try await wait(seconds: 30) { _ in
        navigation = webView.load(URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData))
      }
      loaded = page
    }

    do {
      try await wait(seconds: 60) { id in
        webView.callAsyncJavaScript(Self.refresh, in: nil, in: .page) { [weak self] result in
          self?.end(id, result.flatMap(Self.outcome))
        }
      }
    } catch {
      // A page that did not answer is loaded again next time; one that says
      // it could not fetch the news is fine as it is.
      if !(error is PageError) { loaded = nil }
      throw error
    }

    let image = try await webView.takeSnapshot(configuration: nil)
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
    else { throw RenderError.noImage }
    NSLog("Rendered \(cgImage.width)×\(cgImage.height) px for a \(Int(screen.frame.width))×\(Int(screen.frame.height)) pt screen at \(screen.backingScaleFactor)x")
    return png
  }

  // Asks the page for the latest news and waits until it is drawn. WebKit can
  // report the page loaded before its modules ran; until then
  // window.wallpaper is the <main id="wallpaper"> element.
  private static let refresh = """
    while (typeof window.wallpaper?.refresh !== 'function') await new Promise(r => setTimeout(r, 50));
    return await window.wallpaper.refresh();
    """

  // What the page's refresh resolved to: {ok, error, fetchedAt}. Not ok means
  // the news could not be fetched, and the picture on the desktop stays.
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

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if navigation == self.navigation { end(nil, .success(())) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if navigation == self.navigation { end(nil, .failure(error)) }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if navigation == self.navigation { end(nil, .failure(error)) }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = nil
    end(nil, .failure(RenderError.pageCrashed))
  }
}

enum RenderError: Error {
  case noImage
  case timedOut
  case pageCrashed
}

// The page could not fetch the news (a site down, no network).
struct PageError: Error, CustomStringConvertible {
  let reason: String
  var description: String { "The page could not fetch the news: \(reason)" }
}
